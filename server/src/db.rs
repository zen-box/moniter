use rusqlite::{Connection, Result};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub type DbPool = Arc<Mutex<Connection>>;

pub fn default_monitor_targets() -> Vec<(String, String, i64, String, String)> {
    const PROVINCES: [(&str, &str); 31] = [
        ("河北", "he"),
        ("山西", "sx"),
        ("辽宁", "ln"),
        ("吉林", "jl"),
        ("黑龙江", "hl"),
        ("江苏", "js"),
        ("浙江", "zj"),
        ("安徽", "ah"),
        ("福建", "fj"),
        ("江西", "jx"),
        ("山东", "sd"),
        ("河南", "ha"),
        ("湖北", "hb"),
        ("湖南", "hn"),
        ("广东", "gd"),
        ("海南", "hi"),
        ("四川", "sc"),
        ("贵州", "gz"),
        ("云南", "yn"),
        ("陕西", "sn"),
        ("甘肃", "gs"),
        ("青海", "qh"),
        ("内蒙古", "nm"),
        ("广西", "gx"),
        ("西藏", "xz"),
        ("宁夏", "nx"),
        ("新疆", "xj"),
        ("北京", "bj"),
        ("天津", "tj"),
        ("上海", "sh"),
        ("重庆", "cq"),
    ];
    const CARRIERS: [(&str, &str); 3] = [("电信", "ct"), ("联通", "cu"), ("移动", "cm")];

    PROVINCES
        .iter()
        .flat_map(|(province, code)| {
            CARRIERS.iter().map(move |(carrier_name, carrier_code)| {
                (
                    format!("{}{}", province, carrier_name),
                    format!("{}-{}-v4.ip.zstaticcdn.com", code, carrier_code),
                    80,
                    (*carrier_code).to_string(),
                    (*province).to_string(),
                )
            })
        })
        .collect()
}

/// 给已存在的表补列。SQLite 没有 `ADD COLUMN IF NOT EXISTS`，
/// 所以先查 PRAGMA 再决定要不要 ALTER —— 老库升级就靠这个。
fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) {
    let exists = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .and_then(|mut stmt| {
            let names: Vec<String> = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .flatten()
                .collect();
            Ok(names.iter().any(|n| n == column))
        })
        .unwrap_or(false);

    if !exists {
        let _ = conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl),
            [],
        );
    }
}

#[derive(Debug, Clone)]
pub struct BootstrapAdminCredentials {
    pub username: String,
    pub password: String,
}

fn initialize_password_change_state(conn: &Connection) -> Result<()> {
    // Older installations can prove a completed password change through the
    // existing audit record. Otherwise recommend a change without resetting it.
    conn.execute(
        "INSERT OR IGNORE INTO settings(key,value)
         SELECT 'admin_password_changed', CASE WHEN EXISTS(
             SELECT 1 FROM audit_logs WHERE action='管理员修改登录密码'
         ) THEN '1' ELSE '0' END",
        [],
    )?;
    Ok(())
}

pub fn set_password_changed(conn: &Connection, changed: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key,value) VALUES('admin_password_changed',?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [if changed { "1" } else { "0" }],
    )?;
    Ok(())
}

pub fn password_change_recommended(conn: &Connection) -> Result<bool> {
    conn.query_row(
        "SELECT value!='1' FROM settings WHERE key='admin_password_changed'",
        [], |row| row.get(0),
    )
}

#[cfg(test)]
pub fn init_db(db_path: &str) -> Result<DbPool> {
    init_db_with_bootstrap(db_path).map(|(pool, _)| pool)
}

pub fn init_db_with_bootstrap(
    db_path: &str,
) -> Result<(DbPool, Option<BootstrapAdminCredentials>)> {
    let conn = Connection::open(db_path)?;

    // WAL 模式：读写并发时不会互相阻塞，探针场景心跳写入很频繁
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");

    // 创建服务器节点表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY,
            token TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            region TEXT NOT NULL,
            region_name TEXT NOT NULL,
            provider TEXT NOT NULL,
            billing_price REAL NOT NULL DEFAULT 1.0,
            billing_currency TEXT NOT NULL DEFAULT '$',
            billing_cycle TEXT NOT NULL DEFAULT 'monthly',
            renewal_date TEXT NOT NULL DEFAULT '',
            traffic_limit_gb REAL NOT NULL DEFAULT 1000.0,
            ipv4 TEXT NOT NULL DEFAULT '',
            ipv6 TEXT NOT NULL DEFAULT '',
            agent_version TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // 创建管理员安全表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS admin (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            totp_secret TEXT DEFAULT '',
            totp_enabled INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // 创建配置表 (支持动态激活主题等)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // 创建安全审计日志表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            ip TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash TEXT PRIMARY KEY,
            source_ip TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )",
        [],
    )?;

    // 指标时序归档表：每秒心跳都写库太浪费，服务端按 60 秒节流后落这里，
    // 前台图表和后续的"每天/每小时聚合"都从这里读，不再靠前端写死数组。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id TEXT NOT NULL,
            ts INTEGER NOT NULL,
            cpu REAL NOT NULL DEFAULT 0,
            mem_used_mb INTEGER NOT NULL DEFAULT 0,
            mem_total_mb INTEGER NOT NULL DEFAULT 0,
            net_in_kb INTEGER NOT NULL DEFAULT 0,
            net_out_kb INTEGER NOT NULL DEFAULT 0,
            latency_ct INTEGER NOT NULL DEFAULT 0,
            latency_cu INTEGER NOT NULL DEFAULT 0,
            latency_cm INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_metrics_server_ts ON metrics(server_id, ts)",
        [],
    )?;

    ensure_column(&conn,"metrics","latency_source","TEXT NOT NULL DEFAULT ''");

    // 指标表补列（老库升级）：连接数、进程数、负载、Swap、磁盘历史
    ensure_column(&conn, "metrics", "tcp_conns", "INTEGER NOT NULL DEFAULT 0");
    ensure_column(&conn, "metrics", "udp_conns", "INTEGER NOT NULL DEFAULT 0");
    ensure_column(&conn, "metrics", "processes", "INTEGER NOT NULL DEFAULT 0");
    ensure_column(&conn, "metrics", "load1", "REAL NOT NULL DEFAULT 0");
    ensure_column(&conn, "metrics", "load5", "REAL NOT NULL DEFAULT 0");
    ensure_column(&conn, "metrics", "load15", "REAL NOT NULL DEFAULT 0");
    ensure_column(
        &conn,
        "metrics",
        "swap_used_mb",
        "INTEGER NOT NULL DEFAULT 0",
    );
    ensure_column(
        &conn,
        "metrics",
        "swap_total_mb",
        "INTEGER NOT NULL DEFAULT 0",
    );
    ensure_column(
        &conn,
        "metrics",
        "disk_used_bytes",
        "INTEGER NOT NULL DEFAULT 0",
    );
    ensure_column(
        &conn,
        "metrics",
        "disk_total_bytes",
        "INTEGER NOT NULL DEFAULT 0",
    );

    // 节点表补配置列：流量口径、重置日、手动校准、监控开关等
    ensure_column(
        &conn,
        "servers",
        "region_name_en",
        "TEXT NOT NULL DEFAULT ''",
    );
    ensure_column(
        &conn,
        "servers",
        "billing_currency_code",
        "TEXT NOT NULL DEFAULT ''",
    );
    let _ = conn.execute(
        "UPDATE servers SET billing_currency_code = CASE billing_currency
            WHEN '$' THEN 'USD' WHEN '€' THEN 'EUR' WHEN '¥' THEN 'CNY' WHEN '£' THEN 'GBP'
            WHEN 'HK$' THEN 'HKD' WHEN 'S$' THEN 'SGD' WHEN 'A$' THEN 'AUD' WHEN 'C$' THEN 'CAD'
            WHEN '₽' THEN 'RUB' ELSE 'USD' END
         WHERE billing_currency_code = ''",
        [],
    );
    ensure_column(
        &conn,
        "servers",
        "traffic_type",
        "TEXT NOT NULL DEFAULT 'outbound'",
    );
    ensure_column(
        &conn,
        "servers",
        "traffic_reset_day",
        "INTEGER NOT NULL DEFAULT 1",
    );
    // 手动校准的已用流量（GB）+ 校准时刻，之后的用量从网卡差值累加
    ensure_column(
        &conn,
        "servers",
        "traffic_base_gb",
        "REAL NOT NULL DEFAULT 0",
    );
    ensure_column(
        &conn,
        "servers",
        "traffic_base_at",
        "INTEGER NOT NULL DEFAULT 0",
    );
    ensure_column(
        &conn,
        "servers",
        "traffic_base_rx",
        "INTEGER NOT NULL DEFAULT 0",
    );
    ensure_column(
        &conn,
        "servers",
        "traffic_base_tx",
        "INTEGER NOT NULL DEFAULT 0",
    );
    ensure_column(&conn, "servers", "last_seen", "INTEGER NOT NULL DEFAULT 0");
    conn.execute("CREATE TABLE IF NOT EXISTS traffic_usage (
        server_id TEXT PRIMARY KEY, period INTEGER NOT NULL, base INTEGER NOT NULL DEFAULT 0,
        rx INTEGER NOT NULL DEFAULT 0, tx INTEGER NOT NULL DEFAULT 0,
        last_rx INTEGER NOT NULL DEFAULT 0, last_tx INTEGER NOT NULL DEFAULT 0,
        pending INTEGER NOT NULL DEFAULT 1)", [])?;
    ensure_column(&conn, "servers", "detected_ipv4", "TEXT NOT NULL DEFAULT ''");
    ensure_column(&conn, "servers", "detected_ipv6", "TEXT NOT NULL DEFAULT ''");
    ensure_column(&conn, "servers", "public_ip", "INTEGER NOT NULL DEFAULT 0");
    ensure_column(&conn, "servers", "ipv4", "TEXT NOT NULL DEFAULT ''");
    ensure_column(&conn, "servers", "ipv6", "TEXT NOT NULL DEFAULT ''");
    ensure_column(
        &conn,
        "servers",
        "agent_version",
        "TEXT NOT NULL DEFAULT ''",
    );
    ensure_column(&conn, "servers", "tags", "TEXT NOT NULL DEFAULT ''");
    let _ = conn.execute(
        "UPDATE servers
         SET last_seen = COALESCE((
             SELECT MAX(ts) * 1000 FROM metrics WHERE metrics.server_id = servers.id
         ), 0)
         WHERE last_seen = 0",
        [],
    );
    // 新节点默认不主动探测，避免刚接入就产生大量 TCP/traceroute 流量。
    ensure_column(
        &conn,
        "servers",
        "monitor_enabled",
        "INTEGER NOT NULL DEFAULT 0",
    );
    // all = 全部目标，selected = 只用 monitor_targets 里列出的 id
    ensure_column(
        &conn,
        "servers",
        "monitor_mode",
        "TEXT NOT NULL DEFAULT 'all'",
    );
    ensure_column(
        &conn,
        "servers",
        "monitor_targets",
        "TEXT NOT NULL DEFAULT ''",
    );
    ensure_column(
        &conn,
        "servers",
        "route_enabled",
        "INTEGER NOT NULL DEFAULT 0",
    );
    // 告警是节点级开关：全局渠道配置好后，仍需明确选择哪些节点接收哪些事件。
    // Existing nodes keep the old global-alert behavior until an admin opts them out.
    ensure_column(
        &conn,
        "servers",
        "alert_enabled",
        "INTEGER NOT NULL DEFAULT 1",
    );
    ensure_column(
        &conn,
        "servers",
        "alert_offline",
        "INTEGER NOT NULL DEFAULT 1",
    );
    ensure_column(&conn, "servers", "alert_cpu", "INTEGER NOT NULL DEFAULT 1");
    ensure_column(&conn, "servers", "alert_rules", "TEXT NOT NULL DEFAULT '{}'");
    ensure_column(
        &conn,
        "servers",
        "alert_traffic",
        "INTEGER NOT NULL DEFAULT 1",
    );

    // 延迟监控目标：由管理员配置「要探测哪个 IP」，Agent 拉取后逐个 TCP 探测。
    // 和 servers 表里写死的三网方向不同，这张表可以自由增删改，
    // 比如给洛杉矶的节点加上北京电信/上海联通/广州移动这些具体落点。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS monitor_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 53,
            carrier TEXT NOT NULL DEFAULT '',
            region TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // 监控目标的历史时序。和 metrics 一样按 60 秒节流落库，
    // 前端据此画每个目标的延迟趋势。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS target_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id TEXT NOT NULL,
            target_id INTEGER NOT NULL,
            ts INTEGER NOT NULL,
            ms INTEGER NOT NULL DEFAULT 999
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_target_metrics ON target_metrics(server_id, target_id, ts)",
        [],
    )?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_target_metrics_server_ts ON target_metrics(server_id, ts)", [])?;

    // 告警状态必须跨主控重启保留：冷却窗口、CPU 连续超阈值次数以及事件审计。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS alert_state (
            key TEXT PRIMARY KEY,
            streak INTEGER NOT NULL DEFAULT 0,
            last_notified INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS alert_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_alert_events_server_ts ON alert_events(server_id, created_at)",
        [],
    )?;

    // 超过 30 天的原始采样会进入按天聚合表，供长期趋势查询。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS metrics_daily (
            server_id TEXT NOT NULL,
            day INTEGER NOT NULL,
            samples INTEGER NOT NULL DEFAULT 0,
            data TEXT NOT NULL,
            PRIMARY KEY (server_id, day)
        )",
        [],
    )?;
    // 指标和延迟历史统一保留最近 30 天；启动时先清理旧版本留下的长期归档。
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        - 30 * 86400;
    let _ = conn.execute("DELETE FROM metrics WHERE ts < ?1", [cutoff]);
    let _ = conn.execute("DELETE FROM target_metrics WHERE ts < ?1", [cutoff]);
    let _ = conn.execute("DELETE FROM metrics_daily WHERE day < ?1", [cutoff]);

    // 默认主题设置
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('active_theme', 'default')",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('site_name', 'Moniter')",
        [],
    )?;
    // Upgrade the previous built-in brand once; custom names remain untouched.
    let _ = conn.execute(
        "UPDATE settings SET value = 'Moniter' WHERE key = 'site_name' AND value IN ('AegisProbe', 'Antox')",
        [],
    );

    // 首次启动创建管理员。没有外部指定密码时生成一次高强度口令，
    // 并由启动入口显示一次；后续启动绝不重复打印或重置。
    let mut bootstrap_credentials = None;
    initialize_password_change_state(&conn)?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM admin WHERE id = 1",
        [],
        |r| r.get(0),
    )?;
    if count == 0 {
        let (password, generated) = match std::env::var("AEGIS_ADMIN_PASSWORD") {
            Ok(p) if p.chars().count() >= 12 => (p, false),
            _ => (crate::auth::generate_admin_password(), true),
        };

        let hash = crate::auth::hash_password(&password);
        conn.execute(
            "INSERT INTO admin (id, username, password_hash, totp_secret, totp_enabled) VALUES (1, 'admin', ?1, '', 0)",
            [&hash],
        )?;
        set_password_changed(&conn, false)?;
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES ('初始化管理员账号 admin', 'system')",
            [],
        );

        if generated {
            bootstrap_credentials = Some(BootstrapAdminCredentials {
                username: "admin".to_string(),
                password,
            });
        }
    } else {
        // 老版本可能仍在使用 admin123。首次发现时立刻轮换成随机口令，
        // 并把新凭据交给启动入口只显示一次。
        let (username, hash): (String, String) = conn
            .query_row(
                "SELECT username, password_hash FROM admin WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
        if crate::auth::verify_password("admin123", &hash) {
            let password = crate::auth::generate_admin_password();
            let new_hash = crate::auth::hash_password(&password);
            conn.execute(
                "UPDATE admin SET password_hash = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                [&new_hash],
            )?;
            conn.execute("DELETE FROM admin_sessions", [])?;
            set_password_changed(&conn, false)?;
            bootstrap_credentials = Some(BootstrapAdminCredentials {
                username, password,
            });
        }
    }

    // Empty installations stay empty. Retain legacy nodes, but revoke the
    // publicly known example credential; a fresh token is available in admin.
    let rotated = conn.execute("UPDATE servers SET token = ?1 WHERE token = 'node_local_default_token_0001'",
        [crate::auth::generate_node_token()])?;
    if rotated > 0 {
        conn.execute("INSERT INTO audit_logs (action, ip) VALUES ('安全升级：已轮换旧示例节点令牌，请更新 Agent 配置', 'system')", [])?;
    }

    // 默认监控目标：各省三大运营商落点。管理员可以删除，也可在后台一键恢复。
    let tgt_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM monitor_targets", [], |r| r.get(0))?;
    if tgt_count == 0 && count == 0 {
        for t in default_monitor_targets() {
            let _ = conn.execute(
                "INSERT INTO monitor_targets (name, host, port, carrier, region, enabled) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                rusqlite::params![t.0, t.1, t.2, t.3, t.4],
            );
        }
    }

    Ok((Arc::new(Mutex::new(conn)), bootstrap_credentials))
}

#[cfg(test)]
mod tests {
    use super::{default_monitor_targets, initialize_password_change_state, password_change_recommended, set_password_changed};
    use std::collections::HashSet;

    #[test]
    fn renamed_administrator_survives_database_reopening_without_bootstrap() {
        let path = std::env::temp_dir().join(format!("moniter-renamed-admin-{}.db", rand::random::<u64>()));
        let path_str = path.to_str().unwrap();
        let (pool, _) = super::init_db_with_bootstrap(path_str).unwrap();
        let hash = crate::auth::hash_password("Fixture-private-password-42!");
        {
            let conn = pool.lock().unwrap();
            conn.execute("UPDATE admin SET username='owner',password_hash=?1,totp_enabled=1,totp_secret='preserved' WHERE id=1", [&hash]).unwrap();
            conn.execute("DELETE FROM monitor_targets", []).unwrap();
            set_password_changed(&conn, true).unwrap();
        }
        drop(pool);
        let (pool, credentials) = super::init_db_with_bootstrap(path_str).unwrap();
        assert!(credentials.is_none());
        {
            let conn = pool.lock().unwrap();
            let account: (String,String,i64,String) = conn.query_row(
                "SELECT username,password_hash,totp_enabled,totp_secret FROM admin WHERE id=1", [],
                |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
            ).unwrap();
            assert_eq!(account, ("owner".into(),hash,1,"preserved".into()));
            assert!(!password_change_recommended(&conn).unwrap());
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM admin", [], |row| row.get::<_,i64>(0)).unwrap(), 1);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM monitor_targets", [], |row| row.get::<_,i64>(0)).unwrap(), 0);
        }
        drop(pool);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn password_reminder_migrates_audit_history_and_preserves_saved_state() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE audit_logs(action TEXT NOT NULL);").unwrap();
        initialize_password_change_state(&conn).unwrap();
        assert!(password_change_recommended(&conn).unwrap());
        set_password_changed(&conn, true).unwrap();
        initialize_password_change_state(&conn).unwrap();
        assert!(!password_change_recommended(&conn).unwrap());
        conn.execute("DELETE FROM settings", []).unwrap();
        conn.execute("INSERT INTO audit_logs(action) VALUES('管理员修改登录密码')", []).unwrap();
        initialize_password_change_state(&conn).unwrap();
        assert!(!password_change_recommended(&conn).unwrap());
        // A subsequently rotated initial password still needs changing even
        // when a previous password change exists in the audit history.
        set_password_changed(&conn, false).unwrap();
        initialize_password_change_state(&conn).unwrap();
        assert!(password_change_recommended(&conn).unwrap());
    }

    #[test]
    fn default_monitor_targets_have_93_unique_entries() {
        let targets = default_monitor_targets();
        let unique: HashSet<_> = targets
            .iter()
            .map(|target| (&target.0, &target.1, target.2, &target.3, &target.4))
            .collect();

        assert_eq!(targets.len(), 93);
        assert_eq!(unique.len(), 93);
        assert!(targets.iter().all(|target| target.2 == 80));
        assert!(targets
            .iter()
            .all(|target| target.1.ends_with(".ip.zstaticcdn.com")));
    }
}
