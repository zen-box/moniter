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

/// 会话持久化并绑定来源 IP；退出、改密或来源 IP 变化时失效。

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

/// 管理员会话表。
///
/// 之前这里只有一个 `Arc<Mutex<Option<String>>>` 单槽，既无法区分多个浏览器，
/// 也从来没被任何接口校验过。改成 token -> 过期时间 的映射后，
/// 每个登录会话独立、可单独吊销，且由中间件统一强制校验。
#[derive(Clone)]
pub struct SessionStore {
    db: Arc<Mutex<Connection>>,
}

impl SessionStore {
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        // Convert legacy permanent sessions without signing out active devices.
        let now = unix_now();
        let _ = db.lock().unwrap().execute(
            "UPDATE admin_sessions SET expires_at = ?1 WHERE expires_at = ?2",
            rusqlite::params![now + SESSION_TTL, i64::MAX],
        );
        Self { db }
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
            Some((ip, exp)) if exp > now && ip == source_ip => {
                if exp - now < SESSION_TTL - SESSION_REFRESH_WINDOW {
                    let _ = conn.execute(
                        "UPDATE admin_sessions SET expires_at = ?1 WHERE token_hash = ?2",
                        rusqlite::params![now + SESSION_TTL, token_hash(token)],
                    );
                }
                true
            }
            Some(_) => {
                let _ = conn.execute(
                    "DELETE FROM admin_sessions WHERE token_hash = ?1",
                    [token_hash(token)],
                );
                false
            }
            None => false,
        }
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
    use super::SessionStore;

    #[test]
    fn session_survives_store_recreation_but_is_bound_to_ip() {
        let db = crate::db::init_db(":memory:").expect("test database");
        let first = SessionStore::new(db.clone());
        let token = first.issue("192.0.2.10").unwrap();
        let restarted = SessionStore::new(db);

        assert!(restarted.verify(&token, "192.0.2.10"));
        assert!(!restarted.verify(&token, "192.0.2.11"));
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
