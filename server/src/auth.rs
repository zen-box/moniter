#![allow(dead_code)]
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::{distributions::Alphanumeric, seq::SliceRandom, Rng};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 会话持久化并绑定登录时的网络；退出或改密时失效。

/// 同一 IP 连续失败多少次后锁定，以及锁定时长。
const MAX_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(15 * 60);
const SESSION_TTL: i64 = 30 * 24 * 60 * 60;
const SESSION_REFRESH_WINDOW: i64 = 7 * 24 * 60 * 60;

#[derive(Clone)]
pub struct SecurityManager {
    // 内存 IP 爆破防护: (尝试次数, 最后失败时间)
    ip_attempts: Arc<Mutex<HashMap<String, (u32, Instant)>>>,
}

impl SecurityManager {
    pub fn new() -> Self {
        Self {
            ip_attempts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // 检查 IP 是否被封禁
    pub fn is_ip_blocked(&self, ip: &str) -> bool {
        let mut map = self.ip_attempts.lock().unwrap();
        if let Some((fails, last_time)) = map.get(ip) {
            if *fails >= MAX_FAILURES {
                if last_time.elapsed() < LOCKOUT {
                    return true;
                } else {
                    // 锁定期已过，清掉记录让用户可以重试
                    map.remove(ip);
                }
            }
        }
        false
    }

    // 距离解锁还剩多少秒（用于给前端展示更准确的提示）
    pub fn remaining_lockout_secs(&self, ip: &str) -> u64 {
        let map = self.ip_attempts.lock().unwrap();
        if let Some((fails, last_time)) = map.get(ip) {
            if *fails >= MAX_FAILURES {
                let elapsed = last_time.elapsed();
                if elapsed < LOCKOUT {
                    return (LOCKOUT - elapsed).as_secs();
                }
            }
        }
        0
    }

    // 记录一次失败
    pub fn record_failure(&self, ip: &str) {
        let mut map = self.ip_attempts.lock().unwrap();
        map.retain(|_, (_, last)| last.elapsed() < LOCKOUT);
        if map.len() >= 4096 && !map.contains_key(ip) {
            return;
        }
        let entry = map.entry(ip.to_string()).or_insert((0, Instant::now()));
        entry.0 += 1;
        entry.1 = Instant::now();
    }

    // 登录成功清除记录
    pub fn clear_failures(&self, ip: &str) {
        let mut map = self.ip_attempts.lock().unwrap();
        map.remove(ip);
    }
}

/// How strictly a session is tied to the address it signed in from
/// (`AEGIS_SESSION_IP_BINDING`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IpBinding {
    /// Exactly the sign-in address.
    Strict,
    /// The sign-in network: IPv4 /24 or IPv6 /64. DHCP renewals and IPv6
    /// privacy addresses can rotate inside it. Other networks are refused.
    Network,
    /// Any address. For clients that alternate between IPv4 and IPv6.
    Off,
}

impl IpBinding {
    pub fn from_env() -> Self {
        match std::env::var("AEGIS_SESSION_IP_BINDING").unwrap_or_default().trim().to_ascii_lowercase().as_str() {
            "strict" => Self::Strict,
            "off" | "none" | "0" | "false" => Self::Off,
            _ => Self::Network,
        }
    }

    fn accepts(self, bound: &str, current: &str) -> bool {
        match self {
            Self::Off => true,
            Self::Strict => bound == current,
            Self::Network => bound == current || same_network(bound, current),
        }
    }
}

fn same_network(a: &str, b: &str) -> bool {
    use std::net::IpAddr;
    let (Ok(a), Ok(b)) = (a.parse::<IpAddr>(), b.parse::<IpAddr>()) else {
        return false;
    };
    match (a.to_canonical(), b.to_canonical()) {
        (IpAddr::V4(a), IpAddr::V4(b)) => a.octets()[..3] == b.octets()[..3],
        (IpAddr::V6(a), IpAddr::V6(b)) => a.segments()[..4] == b.segments()[..4],
        _ => false,
    }
}

#[derive(Clone)]
/// Persistent, independently revocable administrator sessions.
pub struct SessionStore {
    db: Arc<Mutex<Connection>>,
    binding: IpBinding,
    // (token hash, address) pairs already written to the audit log, so a stale
    // tab retrying from another network does not flood it.
    reported: Arc<Mutex<HashMap<(String, String), Instant>>>,
}

impl SessionStore {
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self::with_binding(db, IpBinding::from_env())
    }

    pub fn with_binding(db: Arc<Mutex<Connection>>, binding: IpBinding) -> Self {
        // Convert legacy permanent sessions without signing out active devices.
        let now = unix_now();
        let _ = db.lock().unwrap().execute(
            "UPDATE admin_sessions SET expires_at = ?1 WHERE expires_at = ?2",
            rusqlite::params![now + SESSION_TTL, i64::MAX],
        );
        Self { db, binding, reported: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// 签发一个新会话令牌，顺带清理已过期的旧令牌防止内存无限增长。
    pub fn issue(&self, source_ip: &str) -> rusqlite::Result<String> {
        let token = generate_token();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let expires = now + SESSION_TTL;
        let hash = token_hash(&token);
        let conn = self.db.lock().unwrap();
        let _ = conn.execute("DELETE FROM admin_sessions WHERE expires_at <= ?1", [now]);
        conn.execute(
            "INSERT INTO admin_sessions (token_hash, source_ip, expires_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![hash, source_ip, expires],
        )?;
        Ok(token)
    }

    /// 校验令牌是否有效。顺手清理过期项。
    pub fn verify(&self, token: &str, source_ip: &str) -> bool {
        if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return false;
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let conn = self.db.lock().unwrap();
        let found: Option<(String, i64)> = conn
            .query_row(
                "SELECT source_ip, expires_at FROM admin_sessions WHERE token_hash = ?1",
                [token_hash(token)],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        match found {
            Some((_, exp)) if exp <= now => {
                let _ = conn.execute(
                    "DELETE FROM admin_sessions WHERE token_hash = ?1",
                    [token_hash(token)],
                );
                false
            }
            // A different network is refused but the session survives, so the
            // device that signed in keeps working when it returns.
            Some((bound, _)) if !self.binding.accepts(&bound, source_ip) => {
                self.report_rejection(&conn, token, &bound, source_ip);
                false
            }
            Some((_, exp)) => {
                if exp - now < SESSION_TTL - SESSION_REFRESH_WINDOW {
                    let _ = conn.execute(
                        "UPDATE admin_sessions SET expires_at = ?1 WHERE token_hash = ?2",
                        rusqlite::params![now + SESSION_TTL, token_hash(token)],
                    );
                }
                true
            }
            None => false,
        }
    }

    fn report_rejection(&self, conn: &Connection, token: &str, bound: &str, source_ip: &str) {
        let mut reported = self.reported.lock().unwrap();
        reported.retain(|_, at| at.elapsed() < Duration::from_secs(3600));
        let key = (token_hash(token), source_ip.to_string());
        if reported.contains_key(&key) || reported.len() >= 1024 {
            return;
        }
        reported.insert(key, Instant::now());
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
            rusqlite::params![format!("拒绝来自其他网络的管理会话（登录网络 {bound}）"), source_ip],
        );
    }

    pub fn revoke(&self, token: &str) {
        let conn = self.db.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM admin_sessions WHERE token_hash = ?1",
            [token_hash(token)],
        );
    }

    /// 修改密码等敏感操作后，踢掉所有已登录会话。
    pub fn revoke_all(&self) {
        let conn = self.db.lock().unwrap();
        let _ = conn.execute("DELETE FROM admin_sessions", []);
    }
}

fn unix_now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

// 密码哈希生成 (Argon2id)
pub fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .expect("密码哈希失败")
        .to_string()
}

// 密码校验
pub fn verify_password(password: &str, hash_str: &str) -> bool {
    if let Ok(parsed_hash) = PasswordHash::new(hash_str) {
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok()
    } else {
        false
    }
}

// 生成节点专属安全 Token
pub fn generate_node_token() -> String {
    generate_token()
}

pub fn generate_admin_password() -> String {
    const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
    const DIGITS: &[u8] = b"23456789";
    const SYMBOLS: &[u8] = b"!@#$%^&*-_=+";

    let mut rng = rand::thread_rng();
    let mut password = vec![
        UPPER[rng.gen_range(0..UPPER.len())],
        LOWER[rng.gen_range(0..LOWER.len())],
        DIGITS[rng.gen_range(0..DIGITS.len())],
        SYMBOLS[rng.gen_range(0..SYMBOLS.len())],
    ];
    password.extend(
        (&mut rng)
            .sample_iter(&Alphanumeric)
            .take(28)
            .map(|byte| byte),
    );
    password.shuffle(&mut rng);
    String::from_utf8(password).expect("generated password is ASCII")
}

fn generate_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{IpBinding, SessionStore};

    #[test]
    fn session_survives_store_recreation_but_is_bound_to_network() {
        let db = crate::db::init_db(":memory:").expect("test database");
        let first = SessionStore::with_binding(db.clone(), IpBinding::Network);
        let token = first.issue("192.0.2.10").unwrap();
        let restarted = SessionStore::with_binding(db, IpBinding::Network);

        assert!(restarted.verify(&token, "192.0.2.10"));
        assert!(restarted.verify(&token, "192.0.2.77"), "same /24 is the same network");
        assert!(!restarted.verify(&token, "198.51.100.10"));
        assert!(restarted.verify(&token, "192.0.2.10"), "a refused network must not revoke the session");
        assert!(!restarted.verify(&token, "2001:db8::1"), "address family changes are a different network");
    }

    #[test]
    fn binding_modes_match_their_documented_scope() {
        assert!(IpBinding::Network.accepts("2001:db8:1:2::a", "2001:db8:1:2:ffff::9"));
        assert!(!IpBinding::Network.accepts("2001:db8:1:2::a", "2001:db8:1:3::a"));
        assert!(IpBinding::Network.accepts("::ffff:192.0.2.1", "192.0.2.200"));
        assert!(!IpBinding::Strict.accepts("192.0.2.10", "192.0.2.11"));
        assert!(IpBinding::Off.accepts("192.0.2.10", "2001:db8::1"));
        assert!(!IpBinding::Network.accepts("unknown", "192.0.2.1"));
    }

    #[test]
    fn rejected_networks_are_audited_once() {
        let db = crate::db::init_db(":memory:").unwrap();
        let sessions = SessionStore::with_binding(db.clone(), IpBinding::Network);
        let token = sessions.issue("192.0.2.10").unwrap();
        for _ in 0..3 {
            assert!(!sessions.verify(&token, "203.0.113.5"));
        }
        let count: i64 = db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM audit_logs WHERE ip = '203.0.113.5'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn network_changes_do_not_extend_expiry_or_bypass_revocation() {
        let db = crate::db::init_db(":memory:").unwrap();
        let sessions = SessionStore::with_binding(db.clone(), IpBinding::Network);
        let token = sessions.issue("192.0.2.10").unwrap();
        let expires = super::unix_now() + 60;
        db.lock().unwrap().execute(
            "UPDATE admin_sessions SET expires_at=?1", [expires],
        ).unwrap();
        assert!(!sessions.verify(&token, "198.51.100.10"));
        let stored: i64 = db.lock().unwrap().query_row(
            "SELECT expires_at FROM admin_sessions", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(stored, expires);
        assert!(sessions.verify(&token, "192.0.2.11"));
        sessions.revoke(&token);
        assert!(!sessions.verify(&token, "192.0.2.10"));
        assert!(!sessions.verify(&token, "192.0.2.11"));

        let token = sessions.issue("2001:db8:1:2::1").unwrap();
        assert!(sessions.verify(&token, "2001:db8:1:2::ffff"));
        sessions.revoke_all();
        assert!(!sessions.verify(&token, "2001:db8:1:2::1"));
    }

    #[test]
    fn sessions_expire_refresh_and_migrate_without_losing_devices() {
        let db = crate::db::init_db(":memory:").unwrap();
        let sessions = SessionStore::new(db.clone());
        let token = sessions.issue("192.0.2.10").unwrap();
        let hash = super::token_hash(&token);
        let now = super::unix_now();
        db.lock().unwrap().execute("UPDATE admin_sessions SET expires_at = ?1", [now + 60]).unwrap();
        assert!(sessions.verify(&token, "192.0.2.10"));
        let expires: i64 = db.lock().unwrap().query_row("SELECT expires_at FROM admin_sessions WHERE token_hash = ?1", [&hash], |r| r.get(0)).unwrap();
        assert!(expires >= now + super::SESSION_TTL);
        db.lock().unwrap().execute("UPDATE admin_sessions SET expires_at = ?1", [i64::MAX]).unwrap();
        let restarted = SessionStore::new(db.clone());
        assert!(restarted.verify(&token, "192.0.2.10"));
        db.lock().unwrap().execute("UPDATE admin_sessions SET expires_at = ?1", [now - 1]).unwrap();
        assert!(!restarted.verify(&token, "192.0.2.10"));
        assert!(!restarted.verify("invalid", "192.0.2.10"));
    }
}
