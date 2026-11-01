mod alert_dispatch;
mod alert_rules;
mod alerts_api;
mod auth;
mod db;
mod history;
mod notify;
mod security;
mod theme;
mod traffic;
mod targets;
mod updates;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, Multipart, Path as AxumPath, Query, Request, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use totp_rs::{Algorithm, Secret, TOTP};

/// 节点心跳超时阈值：超过这个时间没收到心跳就判离线。
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);
/// 指标落库节流：每个节点最多每 60 秒写一条时序记录。
const METRICS_PERSIST_INTERVAL: Duration = Duration::from_secs(60);

fn heartbeat_expired(elapsed: Duration) -> bool {
    elapsed > HEARTBEAT_TIMEOUT
}

fn advance_cpu_streak(current: u32, over_threshold: bool) -> (u32, bool) {
    if !over_threshold {
        return (0, false);
    }
    let next = current + 1;
    if next >= 3 {
        (0, true)
    } else {
        (next, false)
    }
}

// 全局服务器状态缓存
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServerStateItem {
    pub id: String,
    /// 节点安装令牌。绝不能出现在任何序列化结果里 —— `/api/v1/servers`
    /// 和 `/ws/client` 都是公开的，泄露 token 等于让任何人都能冒充该节点。
    #[serde(skip_serializing)]
    pub token: String,
    pub name: String,
    pub region: String,
    pub region_name: String,
    pub region_name_en: String,
    pub provider: String,
    pub ipv4: String,
    pub ipv6: String,
    pub public_ip: bool,
    #[serde(skip_serializing)]
    pub detected_ipv4: String,
    #[serde(skip_serializing)]
    pub detected_ipv6: String,
    #[serde(skip_serializing)]
    pub manual_ipv4: bool,
    #[serde(skip_serializing)]
    pub manual_ipv6: bool,
    pub agent_version: String,
    pub tags: String,
    pub status: String, // online, offline
    pub last_seen: u64, // 毫秒时间戳
    // 账单信息（来自数据库，后台配置即生效）
    pub billing_price: f64,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub renewal_date: String,
    pub traffic_limit_gb: f64,
    /// outbound（单向计出）或 both（双向计费）
    pub traffic_type: String,
    pub traffic_reset_day: i64,
    /// 服务端算好的已用量（含手动校准基线），字节
    pub traffic_used_bytes: u64,
    // 实时指标
    pub current_cpu: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub swap_used_mb: u64,
    pub swap_total_mb: u64,
    pub net_in_speed_kb: u64,
    pub net_out_speed_kb: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
    pub uptime_secs: u64,
    pub tcp_conns: u32,
    pub udp_conns: u32,
    pub processes: u32,
    pub load1: f32,
    pub load5: f32,
    pub load15: f32,
    // 系统信息（agent 真实上报，不再由前端写死 "Host System"）
    pub os_name: String,
    pub kernel_ver: String,
    pub arch: String,
    pub virtualization: String,
    pub gpu: String,
    pub cpu_model: String,
    pub cpu_cores: u32,
    // 三网延迟
    pub latency_ct: u32,
    pub latency_cu: u32,
    pub latency_cm: u32,
    pub latency_intl: u32,
    pub latency_source: String,
    // 回程线路诊断（agent 的 traceroute 结果）
    pub routes: Option<RouteSet>,
    // 自定义监控目标的探测结果（管理员在后台配置的 IP 列表）
    pub targets: Vec<TargetLatency>,
    // 该节点启用的监控目标 id（前端据此判断哪些是"指定"的）
    pub monitor_enabled: bool,
    pub monitor_mode: String,
    pub monitor_targets: String,
    pub route_enabled: bool,
    pub alert_enabled: bool,
    pub alert_offline: bool,
    pub alert_cpu: bool,
    pub alert_traffic: bool,
    pub alert_rules: alert_rules::NodeRules,
    // 流量校准基线：管理员手动填的已用量 + 当时的网卡计数，
    // 之后的新增用量 = 当前计数 - 基线计数。这几个字段只在服务端用。
    #[serde(skip_serializing)]
    pub traffic_base_gb: f64,
    #[serde(skip_serializing)]
    pub traffic_base_at: i64,
    #[serde(skip_serializing)]
    pub traffic_base_rx: u64,
    #[serde(skip_serializing)]
    pub traffic_base_tx: u64,
}

impl ServerStateItem {
    /// 只有元数据、没有实时指标时的骨架对象
    fn skeleton(
        id: String,
        token: String,
        name: String,
        region: String,
        region_name: String,
        provider: String,
    ) -> Self {
        Self {
            id,
            token,
            name,
            region,
            region_name,
            provider,
            status: "offline".to_string(),
            monitor_enabled: false,
            monitor_mode: "all".to_string(),
            monitor_targets: String::new(),
            route_enabled: false,
            alert_enabled: false,
            alert_offline: true,
            alert_cpu: false,
            alert_traffic: false,
            traffic_type: "outbound".to_string(),
            traffic_reset_day: 1,
            ..Default::default()
        }
    }
}

fn prune_metric_history(conn: &rusqlite::Connection, cutoff: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM metrics WHERE ts < ?1", [cutoff])?;
    conn.execute("DELETE FROM target_metrics WHERE ts < ?1", [cutoff])?;
    conn.execute("DELETE FROM metrics_daily WHERE day < ?1", [cutoff])?;
    Ok(())
}

/// 单个监控目标的实时延迟
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TargetLatency {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub carrier: String,
    pub region: String,
    /// 999 表示探测超时
    pub ms: u32,
}

/// 监控目标配置（后台 CRUD 用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorTarget {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub carrier: String,
    pub region: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RouteItem {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub line: String,
    /// agent 端字段名是 as_num，前端习惯用 as，用 alias 兼容两边
    #[serde(rename = "as", alias = "as_num", default)]
    pub as_num: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RouteSet {
    #[serde(default)]
    pub ct: RouteItem,
    #[serde(default)]
    pub cu: RouteItem,
    #[serde(default)]
    pub cm: RouteItem,
}

#[derive(Clone)]
pub struct AppContext {
    pub db: db::DbPool,
    pub history: history::HistoryReader,
    pub agent_connections: Arc<Mutex<HashMap<String, u64>>>,
    pub security: auth::SecurityManager,
    pub sessions: auth::SessionStore,
    pub live_servers: Arc<Mutex<HashMap<String, (ServerStateItem, Instant)>>>,
    pub client_tx: broadcast::Sender<String>,
    pub updates: updates::UpdateChecker,
}

#[tokio::main]
async fn main() {
    // 1. 初始化 SQLite 数据库
    let db_path = std::env::var("AEGIS_DB_PATH").unwrap_or_else(|_| "data/probe.db".to_string());
    if let Some(parent) = Path::new(&db_path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    let (db_pool, bootstrap_credentials) =
        db::init_db_with_bootstrap(&db_path).expect("SQLite 数据库初始化失败");
    {
        let conn = db_pool.lock().unwrap();
        prune_metric_history(&conn, now_secs() as i64 - 30 * 86400)
            .expect("历史指标保留期清理失败");
    }

    let (client_tx, _rx) = broadcast::channel::<String>(200);

    let ctx = AppContext {
        db: db_pool.clone(),
        history: history::HistoryReader::new(db_pool.clone()),
        agent_connections: Arc::new(Mutex::new(HashMap::new())),
        security: auth::SecurityManager::new(),
        sessions: auth::SessionStore::new(db_pool.clone()),
        live_servers: Arc::new(Mutex::new(HashMap::new())),
        client_tx,
        updates: updates::UpdateChecker::from_env(),
    };
    ctx.updates.spawn();

    let snapshot_ctx = ctx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            if snapshot_ctx.client_tx.receiver_count() > 0 {
                let items = list_all_servers(&snapshot_ctx);
                broadcast_snapshot(&snapshot_ctx, items);
            }
        }
    });

    let history_db = db_pool.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            let db=history_db.clone();
            let result=tokio::task::spawn_blocking(move || -> rusqlite::Result<()> {
                let cutoff=now_secs() as i64-30*86400;
                for (table,time_column) in [("metrics","ts"),("target_metrics","ts"),("metrics_daily","day")] {
                    let ids={let conn=db.lock().unwrap();let mut stmt=conn.prepare(&format!("SELECT DISTINCT server_id FROM {table}"))?;
                        let rows=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;rows};
                    for id in ids {
                        loop {
                            let affected={let conn=db.lock().unwrap();conn.execute(&format!("DELETE FROM {table} WHERE rowid IN (SELECT rowid FROM {table} WHERE server_id=?1 AND {time_column}<?2 LIMIT 2000)"),rusqlite::params![id,cutoff])?};
                            if affected==0 {break;}
                            std::thread::sleep(Duration::from_millis(2));
                        }
                    }
                }
                Ok(())
            }).await;
            if !matches!(result,Ok(Ok(()))) {eprintln!("历史指标分批清理失败: {result:?}");}
        }
    });

    // 2. 监控循环：每 3 秒检查心跳超时，顺带评估 CPU / 流量阈值告警
    let ctx_offline = ctx.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;

            // --- 离线判定 ---
            let (snapshot, went_offline, online) = {
                let mut map = ctx_offline.live_servers.lock().unwrap();
                let mut changed = false;
                let mut offline: Vec<ServerStateItem> = Vec::new();

                for (_, (item, last_instant)) in map.iter_mut() {
                    if item.status == "online" && heartbeat_expired(last_instant.elapsed()) {
                        item.status = "offline".to_string();
                        changed = true;
                        offline.push(item.clone());
                        println!("🔴 机器【{}】心跳超时，已标记为离线！", item.name);
                    }
                }

                let snap = if changed {
                    Some(map.values().map(|(s, _)| s.clone()).collect::<Vec<_>>())
                } else {
                    None
                };
                let alive: Vec<ServerStateItem> = map
                    .values()
                    .filter(|(s, _)| s.status == "online")
                    .map(|(s, _)| s.clone())
                    .collect();
                (snap, offline, alive)
            };

            if snapshot.is_some() {
                broadcast_snapshot(&ctx_offline, list_all_servers(&ctx_offline));
            }

            // 告警总开关关着就不用往下算了
            let cfg = {
                let conn = ctx_offline.db.lock().unwrap();
                notify::AlertConfig::load(&conn)
            };
            if !cfg.enabled {
                continue;
            }

            // --- 离线告警 ---
            if cfg.notify_offline {
                for item in went_offline {
                    if !item.alert_enabled || !item.alert_offline {
                        continue;
                    }
                    let alert = notify::AlertMessage {
                        server_name: item.name.clone(),
                        event_type: "offline".to_string(),
                        message: format!(
                            "节点已离线（超过 {} 秒未收到心跳）。地区：{}，服务商：{}",
                            HEARTBEAT_TIMEOUT.as_secs(),
                            item.region_name,
                            item.provider
                        ),
                        timestamp: format_ts(now_secs()),
                    };
                    record_alert_event(&ctx_offline, &item.id, "offline", &alert.message);
                    alert_dispatch::dispatch(&cfg, alert, "离线");
                }
            }

            // --- CPU / 流量阈值告警 ---
            if !online.is_empty() && (cfg.notify_cpu || cfg.notify_traffic) {
                for item in online {
                    // CPU：连续 3 次（约 9 秒）都超阈值才发，避开编译、备份这类瞬时尖峰
                    if cfg.notify_cpu && item.alert_enabled && item.alert_cpu {
                        let key = format!("{}:cpu", item.id);
                        let hit = {
                            let conn = ctx_offline.db.lock().unwrap();
                            let current: i64 = conn
                                .query_row(
                                    "SELECT streak FROM alert_state WHERE key = ?1",
                                    [&key],
                                    |r| r.get(0),
                                )
                                .unwrap_or(0);
                            let (next, hit) = advance_cpu_streak(
                                current as u32,
                                item.current_cpu >= cfg.cpu_threshold,
                            );
                            let _ = conn.execute(
                                "INSERT INTO alert_state (key, streak) VALUES (?1, ?2)
                                 ON CONFLICT(key) DO UPDATE SET streak = excluded.streak",
                                rusqlite::params![key, next],
                            );
                            hit
                        };

                        if hit && should_alert(&ctx_offline, &key, 1800) {
                            let alert = notify::AlertMessage {
                                server_name: item.name.clone(),
                                event_type: "cpu_high".to_string(),
                                message: format!(
                                    "CPU 使用率 {:.1}%，已连续 9 秒超过阈值 {:.0}%。",
                                    item.current_cpu, cfg.cpu_threshold
                                ),
                                timestamp: format_ts(now_secs()),
                            };
                            record_alert_event(&ctx_offline, &item.id, "cpu_high", &alert.message);
                            alert_dispatch::dispatch(&cfg, alert, "CPU");
                        }
                    }

                    // 流量：按百分比判断，冷却 6 小时（用量变化慢，不用频繁提醒）
                    if cfg.notify_traffic
                        && item.alert_enabled
                        && item.alert_traffic
                        && item.traffic_limit_gb > 0.0
                    {
                        let limit_bytes = item.traffic_limit_gb * 1024.0 * 1024.0 * 1024.0;
                        let used_pct = item.traffic_used_bytes as f64 / limit_bytes * 100.0;

                        if used_pct >= cfg.traffic_threshold as f64 {
                            let key = format!("{}:traffic:{}:{}", item.id, traffic::period(now_secs() as i64,item.traffic_reset_day), cfg.traffic_threshold);
                            let first = ctx_offline.db.lock().unwrap().execute("INSERT OR IGNORE INTO alert_state(key,last_notified) VALUES(?1,?2)",rusqlite::params![key,now_secs() as i64]).map(|n| n>0).unwrap_or(false);
                            if first {
                                let alert = notify::AlertMessage {
                                    server_name: item.name.clone(),
                                    event_type: "traffic_warning".to_string(),
                                    message: format!(
                                        "流量已用 {:.1} GiB / {:.0} GiB（{:.0}%），超过阈值 {}%。",
                                        item.traffic_used_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
                                        item.traffic_limit_gb,
                                        used_pct,
                                        cfg.traffic_threshold
                                    ),
                                    timestamp: format_ts(now_secs()),
                                };
                                record_alert_event(
                                    &ctx_offline,
                                    &item.id,
                                    "traffic_warning",
                                    &alert.message,
                                );
                                alert_dispatch::dispatch(&cfg, alert, "流量");
                            }
                        }
                    }
                }
            }
        }
    });

    alert_rules::spawn(ctx.clone());

    // 3. 管理后台受保护路由组：统一走 require_admin 中间件
    let admin_protected = Router::new()
        .route("/api/v1/admin/status", get(api_admin_status))
        .route(
            "/api/v1/admin/site-settings",
            get(api_admin_site_settings).post(api_admin_save_site_settings),
        )
        .route("/api/v1/admin/logout", post(api_admin_logout))
        .route("/api/v1/admin/servers", get(api_admin_get_servers))
        .route("/api/v1/admin/costs", get(api_admin_costs))
        .route("/api/v1/admin/servers/add", post(api_admin_add_server))
        // Compatibility for bundles cached before the add/update split.
        .route(
            "/api/v1/admin/servers/save",
            post(api_admin_save_server_legacy),
        )
        .route(
            "/api/v1/admin/servers/delete",
            post(api_admin_delete_server),
        )
        .route("/api/v1/admin/theme/switch", post(api_admin_switch_theme))
        .route("/api/v1/admin/themes", get(api_admin_get_themes))
        .route("/api/v1/admin/themes/delete", post(api_admin_delete_theme))
        .route(
            "/api/v1/admin/themes/upload",
            post(api_admin_upload_theme).layer(DefaultBodyLimit::max(32 * 1024 * 1024)),
        )
        .route("/api/v1/admin/themes/github", post(api_admin_install_theme_github))
        .route("/api/v1/admin/password", post(api_admin_change_password))
        .route("/api/v1/admin/audit", get(api_admin_get_audit))
        // 节点编辑
        .route(
            "/api/v1/admin/servers/update",
            post(api_admin_update_server),
        )
        .route(
            "/api/v1/admin/servers/reset_token",
            post(api_admin_reset_token),
        )
        .route(
            "/api/v1/admin/servers/calibrate",
            post(api_admin_calibrate_traffic),
        )
        // 监控目标管理
        .route("/api/v1/admin/2fa/status", get(api_admin_2fa_status))
        .route("/api/v1/admin/2fa/setup", post(api_admin_2fa_setup))
        .route("/api/v1/admin/2fa/enable", post(api_admin_2fa_enable))
        .route("/api/v1/admin/2fa/disable", post(api_admin_2fa_disable))
        .route("/api/v1/admin/targets", get(api_admin_get_targets))
        .route("/api/v1/admin/targets/save", post(api_admin_save_target))
        .route(
            "/api/v1/admin/targets/reset_defaults",
            post(api_admin_reset_targets),
        )
        .route(
            "/api/v1/admin/targets/delete",
            post(api_admin_delete_target),
        )
        .merge(alerts_api::router())
        .merge(updates::router())
        .route_layer(middleware::from_fn_with_state(ctx.clone(), require_admin));

    let app = Router::new()
        // React is the built-in UI; uploaded themes remain isolated.
        .route("/", get(serve_index))
        .route("/world-map-paths.svg", get(serve_map_svg))
        // 一键安装脚本端点
        .route("/install.sh", get(serve_install_sh))
        .route("/install.ps1", get(serve_install_ps1))
        // Agent 二进制分发（install 脚本据此下载，不再指向不存在的文件）
        .route("/download/agent/:platform", get(serve_agent_binary))
        // 公开 API
        .route("/api/v1/servers", get(api_get_servers))
        .route("/api/v1/site-settings", get(api_get_site_settings))
        .route("/api/v1/targets", get(api_get_targets))
        .route("/api/v1/metrics/:server_id", get(api_get_metrics))
        .route(
            "/api/v1/target_metrics/:server_id",
            get(api_get_target_metrics),
        )
        .route("/api/v1/ping", get(api_ping))
        .route("/api/v1/themes", get(api_get_themes))
        // 登录页与登录接口（不鉴权）
        .route("/admin/login", get(serve_admin_login))
        .route("/api/v1/admin/login", post(api_admin_login))
        // 后台页面本身放行，数据靠 API 鉴权保护
        .route("/admin", get(serve_admin_dashboard))
        .route("/admin/", get(serve_admin_dashboard))
        // WebSocket 管道
        .route("/ws/agent", get(ws_agent_handler))
        .route("/ws/client", get(ws_client_handler))
        .merge(admin_protected)
        .nest_service(
            "/ui-assets",
            tower_http::services::ServeDir::new("web/dist"),
        )
        .nest_service("/themes", tower_http::services::ServeDir::new("web/themes"))
        // 静态资源（国旗等），交给 tower-http 处理，自带 content-type 与缓存
        .nest_service("/assets", tower_http::services::ServeDir::new("web/assets"))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(middleware::from_fn(security::harden_request))
        .with_state(ctx);

    let bind_addr = std::env::var("AEGIS_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| panic!("无法绑定 {}: {}", bind_addr, e));
    let shown_addr = bind_addr.replace("0.0.0.0", "127.0.0.1");
    println!("启动成功: http://{}", shown_addr);
    println!("后台地址: http://{}/admin", shown_addr);
    if let Some(credentials) = bootstrap_credentials {
        println!("管理员账号: {}", credentials.username);
        println!("管理员密码: {}", credentials.password);
        let conn = db_pool.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO settings (key, value) VALUES ('bootstrap_admin_credentials_shown', '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        );
    }

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

/// 节点表的统一查询列，顺序必须和 `row_to_item` 里的索引一致
const SERVER_SELECT: &str = "SELECT id, token, name, region, region_name, provider,
        billing_price, billing_currency, billing_cycle, renewal_date, traffic_limit_gb,
        region_name_en, traffic_type, traffic_reset_day,
        monitor_enabled, monitor_mode, monitor_targets, route_enabled,
        alert_enabled, alert_offline, alert_cpu, alert_traffic,
        traffic_base_gb, traffic_base_at, traffic_base_rx, traffic_base_tx, last_seen,
        ipv4, ipv6, agent_version, tags, detected_ipv4, detected_ipv6, public_ip, alert_rules
 FROM servers";

fn row_to_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<ServerStateItem> {
    let mut item = ServerStateItem::skeleton(
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(4)?,
        r.get(5)?,
    );

    item.billing_price = r.get(6)?;
    item.billing_currency = r.get(7)?;
    item.billing_cycle = r.get(8)?;
    item.renewal_date = r.get(9)?;
    item.traffic_limit_gb = r.get(10)?;
    item.region_name_en = r.get(11)?;
    item.traffic_type = r.get(12)?;
    item.traffic_reset_day = r.get(13)?;
    item.monitor_enabled = r.get::<_, i64>(14)? != 0;
    item.monitor_mode = r.get(15)?;
    item.monitor_targets = r.get(16)?;
    item.route_enabled = r.get::<_, i64>(17)? != 0;
    item.alert_enabled = r.get::<_, i64>(18)? != 0;
    item.alert_offline = r.get::<_, i64>(19)? != 0;
    item.alert_cpu = r.get::<_, i64>(20)? != 0;
    item.alert_traffic = r.get::<_, i64>(21)? != 0;
    item.traffic_base_gb = r.get(22)?;
    item.traffic_base_at = r.get(23)?;
    item.traffic_base_rx = r.get::<_, i64>(24)? as u64;
    item.traffic_base_tx = r.get::<_, i64>(25)? as u64;
    item.last_seen = r.get::<_, i64>(26)? as u64;
    item.ipv4 = r.get(27)?;
    item.ipv6 = r.get(28)?;
    item.manual_ipv4 = !item.ipv4.is_empty();
    item.manual_ipv6 = !item.ipv6.is_empty();
    item.agent_version = r.get(29)?;
    item.tags = r.get(30)?;
    item.detected_ipv4 = r.get(31)?;
    item.detected_ipv6 = r.get(32)?;
    item.public_ip = r.get::<_,i64>(33)? != 0;
    item.alert_rules = serde_json::from_str(&r.get::<_,String>(34)?).unwrap_or_default();
    if item.ipv4.is_empty() { item.ipv4 = item.detected_ipv4.clone(); }
    if item.ipv6.is_empty() { item.ipv6 = item.detected_ipv6.clone(); }

    Ok(item)
}

/// 广播一份最新的节点快照给所有在线浏览器。
fn broadcast_snapshot(ctx: &AppContext, items: Vec<ServerStateItem>) {
    if ctx.client_tx.receiver_count() == 0 { return; }
    if let Ok(json_text) = serde_json::to_string(&public_items(items)) {
        let _ = ctx.client_tx.send(json_text);
    }
}

fn public_items(mut items: Vec<ServerStateItem>) -> Vec<ServerStateItem> {
    for item in &mut items {
        if !item.public_ip { item.ipv4.clear(); item.ipv6.clear(); }
    }
    items
}

/// 告警冷却检查：同一个 key 在 cooldown 内只放行一次
fn should_alert(ctx: &AppContext, key: &str, cooldown_secs: u64) -> bool {
    let now = now_secs() as i64;
    let conn = ctx.db.lock().unwrap();
    conn.execute(
        "INSERT INTO alert_state (key, streak, last_notified) VALUES (?1, 0, ?2)
         ON CONFLICT(key) DO UPDATE SET last_notified = excluded.last_notified
         WHERE alert_state.last_notified <= ?3",
        rusqlite::params![key, now, now - cooldown_secs as i64],
    )
    .map(|changed| changed > 0)
    .unwrap_or(false)
}

fn record_alert_event(ctx: &AppContext, server_id: &str, event_type: &str, message: &str) {
    let conn = ctx.db.lock().unwrap();
    let _ = conn.execute(
        "INSERT INTO alert_events (server_id, event_type, message, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![server_id, event_type, message, now_secs() as i64],
    );
    let _ = conn.execute(
        "DELETE FROM alert_events WHERE created_at < ?1",
        [now_secs() as i64 - 365 * 86400],
    );
}

/// 异步投递一封告警邮件，不阻塞检测循环
// ==========================================================================
// 鉴权中间件
// ==========================================================================
async fn require_admin(State(ctx): State<AppContext>, req: Request, next: Next) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string());

    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let ip = client_ip(req.headers(), peer);
    let ok = match token {
        Some(t) => ctx.sessions.verify(&t, &ip),
        None => false,
    };

    if !ok {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "success": false,
                "message": "登录已失效，请重新登录"
            })),
        )
            .into_response();
    }

    next.run(req).await
}

/// 解析访客真实 IP。
///
/// 默认只信任 TCP 连接对端地址；只有当显式设置 AEGIS_TRUST_PROXY=1 时才读
/// X-Forwarded-For —— 否则任何人都能伪造请求头绕过登录封禁。
fn client_ip(headers: &HeaderMap, addr: Option<SocketAddr>) -> String {
    if addr.is_none() {
        if let Some(ip) = headers.get("x-moniter-client-ip").and_then(|value| value.to_str().ok()) {
            return ip.to_string();
        }
    }
    security::source_ip(headers, addr)
}

// ==========================================================================
// 静态文件与主题双模服务 (磁盘外部主题优先，若无则内置降级)
// ==========================================================================
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Include the server timezone explicitly in notification timestamps.
fn format_ts(secs: u64) -> String {
    chrono::DateTime::from_timestamp(secs as i64, 0).unwrap_or_default().with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M:%S %:z").to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Shared static asset with an embedded copy and conditional caching.
fn asset_response(
    req_headers: &HeaderMap,
    disk_path: &str,
    content_type: &'static str,
    embedded: &'static str,
) -> Response {
    let path = Path::new(disk_path);

    if let Ok(meta) = fs::metadata(path) {
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let tag = format!("\"{:x}-{:x}\"", mtime, meta.len());

        // 条件请求命中就直接 304，连文件都不用读
        if req_headers
            .get(header::IF_NONE_MATCH)
            .and_then(|v| v.to_str().ok())
            == Some(tag.as_str())
        {
            let mut resp = StatusCode::NOT_MODIFIED.into_response();
            if let Ok(v) = HeaderValue::from_str(&tag) {
                resp.headers_mut().insert(header::ETAG, v);
            }
            return resp;
        }

        if let Ok(content) = fs::read_to_string(path) {
            let mut resp = content.into_response();
            resp.headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
            resp.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=0, must-revalidate"),
            );
            if let Ok(v) = HeaderValue::from_str(&tag) {
                resp.headers_mut().insert(header::ETAG, v);
            }
            return resp;
        }
    }

    let mut resp = embedded.to_string().into_response();
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=0, must-revalidate"),
    );
    resp
}

fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn inject_site_name(html: &str, site_name: &str) -> String {
    let safe_name = escape_html_text(site_name);
    let mut rendered = html.replace("__SITE_NAME__", &safe_name);
    let js_name = serde_json::to_string(site_name)
        .unwrap_or_else(|_| "\"Moniter\"".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let script = format!(
        "<script>(function(){{var n={};var t=document.title;var i=t.search(/[·|]/);document.title=n+(i>=0?' · '+t.slice(i+1).trim():'');document.querySelectorAll('[data-brand-name],.brand-title>span:first-child').forEach(function(e){{e.textContent=n;}});}})();</script>",
        js_name
    );
    if let Some(index) = rendered.rfind("</body>") {
        rendered.insert_str(index, &script);
    } else {
        rendered.push_str(&script);
    }
    rendered
}

fn dynamic_html_response(html: String) -> Response {
    let mut response = html.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn serve_admin_login(State(ctx): State<AppContext>) -> Response {
    react_app_response(&ctx)
}

async fn serve_admin_dashboard(State(ctx): State<AppContext>) -> Response {
    react_app_response(&ctx)
}

async fn serve_index(State(ctx): State<AppContext>) -> Response {
    let theme_id = get_active_theme(&ctx);
    if theme_id != "default" {
        if let Some(meta) = theme::scan_themes("web/themes")
            .into_iter()
            .find(|meta| meta.id == theme_id)
        {
            let path = Path::new("web/themes").join(&theme_id).join(&meta.entry);
            if let Ok(html) = fs::read_to_string(path) {
                return dynamic_html_response(theme::isolated_page(&html, &theme_id, &read_site_name(&ctx)));
            }
        }
    }
    react_app_response(&ctx)
}

fn react_app_response(ctx: &AppContext) -> Response {
    let html = match fs::read_to_string("web/dist/index.html") {
        Ok(html) => html,
        Err(_) => {
            let mut response = (
                StatusCode::SERVICE_UNAVAILABLE,
                "Moniter frontend is missing. Run `cd web/app && npm ci && npm run build`, then start Moniter from the project root.\n",
            ).into_response();
            response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            return response;
        }
    };
    let html = inject_site_name(&html, &read_site_name(ctx));
    let servers = serde_json::to_string(&public_items(list_all_servers(ctx)))
        .unwrap_or_else(|_| "[]".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    dynamic_html_response(
        html.replace("__INITIAL_SERVERS__", &servers),
    )
}

async fn serve_map_svg(headers: HeaderMap) -> Response {
    asset_response(
        &headers,
        "web/assets/world-map-paths.svg",
        "image/svg+xml",
        theme::EMBEDDED_MAP_SVG,
    )
}

fn get_active_theme(ctx: &AppContext) -> String {
    let conn = ctx.db.lock().unwrap();
    let theme_id: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'active_theme'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "default".to_string());

    // 主题 id 会被拼进文件路径，必须挡住 `../../` 这类穿越
    if is_valid_theme_id(&theme_id) {
        theme_id
    } else {
        "default".to_string()
    }
}

fn is_valid_theme_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ==========================================================================
// 一键部署脚本自动生成 (Linux/macOS Bash & Windows PowerShell)
// ==========================================================================
#[derive(Deserialize)]
struct InstallQuery {
    token: Option<String>,
}

fn install_token(query_token: Option<String>, headers: &HeaderMap) -> String {
    query_token
        .filter(|token| !token.is_empty())
        .unwrap_or_else(|| {
            headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .unwrap_or_default()
                .to_string()
        })
}

/// 由主控自己推导对外地址，不再把 `YOUR_SERVER` 这种占位符留给用户。
fn installation_values(ctx: &AppContext, q: InstallQuery, headers: &HeaderMap) -> Result<(String, String, String), Response> {
    let token = install_token(q.token, headers);
    if !security::valid_node_token(&token) {
        return Err((StatusCode::BAD_REQUEST, "# 节点令牌格式无效，请从节点管理复制安装命令\n").into_response());
    }
    if lookup_server_by_token(ctx, &token).is_none() {
        return Err((StatusCode::UNAUTHORIZED, "# 节点令牌无效或已重置\n").into_response());
    }
    let base = security::public_base_url(headers)
        .map_err(|error| (StatusCode::BAD_REQUEST, format!("# {error}\n")).into_response())?;
    let ws_base = base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    Ok((token, base, ws_base))
}

async fn serve_install_sh(State(ctx): State<AppContext>, Query(q): Query<InstallQuery>, headers: HeaderMap) -> Response {
    let (token, base, ws_base) = match installation_values(&ctx, q, &headers) {
        Ok(values) => values, Err(response) => return response,
    };

    let script = include_str!("install.sh")
        .replace("__TOKEN__", &security::shell_quote(&token))
        .replace("__BASE__", &security::shell_quote(&base))
        .replace("__WS_BASE__", &security::shell_quote(&ws_base));
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        script,
    ).into_response()
}

async fn serve_install_ps1(State(ctx): State<AppContext>, Query(q): Query<InstallQuery>, headers: HeaderMap) -> Response {
    let (token, base, ws_base) = match installation_values(&ctx, q, &headers) {
        Ok(values) => values, Err(response) => return response,
    };

    let script = include_str!("install.ps1")
        .replace("__TOKEN__", &security::powershell_quote(&token))
        .replace("__BASE__", &security::powershell_quote(&base))
        .replace("__WS_BASE__", &security::powershell_quote(&ws_base));
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        script,
    ).into_response()
}

/// 分发预编译的 Agent 二进制。
async fn serve_agent_binary(AxumPath(platform): AxumPath<String>) -> Response {
    // 平台名直接参与路径拼接，必须白名单
    let allowed = ["linux-amd64", "linux-arm64", "windows-amd64"];
    if !allowed.contains(&platform.as_str()) {
        return (StatusCode::NOT_FOUND, "unsupported platform").into_response();
    }

    let file = format!("binaries/aegis-agent-{}", platform);
    match fs::read(&file) {
        Ok(bytes) => {
            let mut resp = bytes.into_response();
            resp.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            );
            resp
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            format!(
                "binaries/aegis-agent-{} 不存在。请先执行 scripts/build-agent.sh 生成各平台二进制。",
                platform
            ),
        )
            .into_response(),
    }
}

// ==========================================================================
// REST API 接口
// ==========================================================================
async fn api_get_servers(State(ctx): State<AppContext>) -> Json<Vec<ServerStateItem>> {
    Json(public_items(list_all_servers(&ctx)))
}

/// 监控目标列表（公开读）。Agent 靠它拿到要探测的 IP，前端靠它渲染目标名。
async fn api_get_targets(State(ctx): State<AppContext>) -> Json<Vec<MonitorTarget>> {
    Json(list_targets(&ctx, true))
}

#[derive(Serialize)]
struct TargetPoint {
    ts: i64,
    /// 该时间桶内成功探测的平均延迟；整桶全部超时时为 null
    ms: Option<f64>,
    /// 该时间桶内超时次数
    timeouts: i64,
    /// 该时间桶内总探测次数
    total: i64,
}

#[derive(Serialize)]
struct TargetSeries {
    target_id: i64,
    name: String,
    host: String,
    carrier: String,
    region: String,
    deleted: bool,
    points: Vec<TargetPoint>,
}

/// 监控目标的历史时序，按时间桶聚合。
///
/// 超时（ms = 999）不参与平均值计算 —— 否则一个经常超时的目标
/// 平均延迟会被拉到 999，曲线完全看不出真实水平。超时次数单独统计，
/// 前端据此把丢包的桶画成断点。
async fn api_get_target_metrics(
    State(ctx): State<AppContext>,
    AxumPath(server_id): AxumPath<String>,
    Query(q): Query<MetricsQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (hours, bucket) = history::window(q.hours, q.bucket);
    let since = now_secs() as i64 - hours * 3600;

    let key = format!("targets:{server_id}:{hours}:{bucket}");
    ctx.history.query(key, move |conn| {
    let meta = conn.prepare("SELECT id, name, host, port, carrier, region, enabled FROM monitor_targets ORDER BY id")?
        .query_map([], |r| Ok(MonitorTarget { id: r.get(0)?, name: r.get(1)?, host: r.get(2)?, port: r.get(3)?, carrier: r.get(4)?, region: r.get(5)?, enabled: r.get::<_,i64>(6)? != 0 }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let rows: Vec<(i64, i64, Option<f64>, i64, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT target_id,
                    (ts / ?2) * ?2 AS b,
                    AVG(CASE WHEN ms > 0 AND ms < 999 THEN ms END) AS avg_ms,
                    SUM(CASE WHEN ms <= 0 OR ms >= 999 THEN 1 ELSE 0 END) AS timeouts,
                    COUNT(*) AS total
             FROM target_metrics
             WHERE server_id = ?1 AND ts >= ?3 AND ms > 0
             GROUP BY target_id, b
             ORDER BY target_id, b ASC",
        )?;

        let iter = stmt.query_map(rusqlite::params![server_id, bucket, since], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<f64>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        });

        let values = iter?.collect::<rusqlite::Result<Vec<_>>>()?;
        values
    };

    // 按 target_id 分组，保持 id 升序
    let mut series: Vec<TargetSeries> = Vec::new();
    for (target_id, ts, ms, timeouts, total) in rows {
        let idx = match series.iter().position(|s| s.target_id == target_id) {
            Some(i) => i,
            None => {
                let m = meta.iter().find(|t| t.id == target_id);
                series.push(TargetSeries {
                    target_id,
                    name: m
                        .map(|x| x.name.clone())
                        .unwrap_or_else(|| format!("#{target_id}")),
                    host: m.map(|x| x.host.clone()).unwrap_or_default(),
                    carrier: m.map(|x| x.carrier.clone()).unwrap_or_default(),
                    region: m.map(|x| x.region.clone()).unwrap_or_default(),
                    deleted: m.is_none(),
                    points: Vec::new(),
                });
                series.len() - 1
            }
        };
        series[idx].points.push(TargetPoint {
            ts,
            ms,
            timeouts,
            total,
        });
    }

    Ok(serde_json::to_value(series).expect("serializable history"))
    }).await
}

#[derive(Serialize, Deserialize)]
struct MetricPoint {
    ts: i64,
    cpu: f64,
    mem_used_mb: f64,
    mem_total_mb: f64,
    swap_used_mb: f64,
    swap_total_mb: f64,
    net_in_kb: f64,
    net_out_kb: f64,
    disk_used_bytes: f64,
    disk_total_bytes: f64,
    tcp_conns: f64,
    udp_conns: f64,
    processes: f64,
    load1: f64,
    load5: f64,
    load15: f64,
    lat_ct: Option<f64>,
    lat_cu: Option<f64>,
    lat_cm: Option<f64>,
    lat_ct_max: Option<i64>,
    lat_cu_max: Option<i64>,
    lat_cm_max: Option<i64>,
    lat_ct_total:i64,lat_cu_total:i64,lat_cm_total:i64,
    lat_ct_timeouts:i64,lat_cu_timeouts:i64,lat_cm_timeouts:i64,
}

#[derive(Deserialize)]
struct MetricsQuery {
    /// 回看多少小时，默认 24
    hours: Option<i64>,
    /// 聚合桶大小（秒），默认 300（5 分钟）
    bucket: Option<i64>,
}

/// 时序指标查询：按时间桶聚合，供前台 Smokeping 图使用。
async fn api_get_metrics(
    State(ctx): State<AppContext>,
    AxumPath(server_id): AxumPath<String>,
    Query(q): Query<MetricsQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (hours, bucket) = history::window(q.hours, q.bucket);
    let since = now_secs() as i64 - hours * 3600;

    let key = format!("metrics:{server_id}:{hours}:{bucket}");
    ctx.history.query(key, move |conn| {
    let mut stmt = conn.prepare(
        "SELECT (ts / ?2) * ?2 AS b,
                AVG(cpu), AVG(mem_used_mb), AVG(mem_total_mb),
                AVG(swap_used_mb), AVG(swap_total_mb),
                AVG(net_in_kb), AVG(net_out_kb),
                AVG(disk_used_bytes), AVG(disk_total_bytes),
                AVG(tcp_conns), AVG(udp_conns), AVG(processes),
                AVG(load1), AVG(load5), AVG(load15),
                AVG(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_ct BETWEEN 1 AND 998 THEN latency_ct END), AVG(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cu BETWEEN 1 AND 998 THEN latency_cu END), AVG(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cm BETWEEN 1 AND 998 THEN latency_cm END),
                MAX(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_ct BETWEEN 1 AND 998 THEN latency_ct END), MAX(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cu BETWEEN 1 AND 998 THEN latency_cu END), MAX(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cm BETWEEN 1 AND 998 THEN latency_cm END),
                COUNT(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_ct>0 THEN 1 END),COUNT(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cu>0 THEN 1 END),COUNT(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cm>0 THEN 1 END),
                COUNT(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_ct>=999 THEN 1 END),COUNT(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cu>=999 THEN 1 END),COUNT(CASE WHEN latency_source='sh-zstatic-tcp80-v1' AND latency_cm>=999 THEN 1 END)
         FROM metrics
         WHERE server_id = ?1 AND ts >= ?3
         GROUP BY b ORDER BY b ASC",
    )?;

    let rows = stmt.query_map(rusqlite::params![server_id, bucket, since], |r| {
        Ok(MetricPoint {
            ts: r.get(0)?,
            cpu: r.get(1)?,
            mem_used_mb: r.get(2)?,
            mem_total_mb: r.get(3)?,
            swap_used_mb: r.get(4)?,
            swap_total_mb: r.get(5)?,
            net_in_kb: r.get(6)?,
            net_out_kb: r.get(7)?,
            disk_used_bytes: r.get(8)?,
            disk_total_bytes: r.get(9)?,
            tcp_conns: r.get(10)?,
            udp_conns: r.get(11)?,
            processes: r.get(12)?,
            load1: r.get(13)?,
            load5: r.get(14)?,
            load15: r.get(15)?,
            lat_ct: r.get(16)?,
            lat_cu: r.get(17)?,
            lat_cm: r.get(18)?,
            lat_ct_max: r.get(19)?,
            lat_cu_max: r.get(20)?,
            lat_cm_max: r.get(21)?,
            lat_ct_total:r.get(22)?,lat_cu_total:r.get(23)?,lat_cm_total:r.get(24)?,
            lat_ct_timeouts:r.get(25)?,lat_cu_timeouts:r.get(26)?,lat_cm_timeouts:r.get(27)?,
        })
    });

    let mut out = rows?.collect::<rusqlite::Result<Vec<_>>>()?;
    out.sort_by_key(|point| point.ts);
    Ok(serde_json::to_value(out).expect("serializable history"))
    }).await
}

/// 浏览器端延迟探测端点。
///
/// 前端用 performance.now() 在请求前后取差值，得到访客到本机的真实 RTT，
/// 替代原来那个 Math.random() 假测速。
async fn api_ping() -> Response {
    let mut resp = "pong".into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate"),
    );
    resp.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    resp
}

async fn api_get_themes() -> Json<Vec<theme::ThemeMeta>> {
    Json(theme::scan_themes("web/themes"))
}

async fn api_admin_get_themes(State(ctx): State<AppContext>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "active": get_active_theme(&ctx),
        "themes": theme::scan_themes("web/themes"),
    }))
}

#[derive(Deserialize)]
struct DeleteThemeReq {theme_id:String}
async fn api_admin_delete_theme(State(ctx):State<AppContext>,headers:HeaderMap,Json(p):Json<DeleteThemeReq>)->Json<serde_json::Value> {
    if p.theme_id=="default" || !is_valid_theme_id(&p.theme_id) {return theme_error("无法删除内置主题或无效主题");}
    let _guard=theme::MUTATION_LOCK.lock().unwrap();
    if get_active_theme(&ctx)==p.theme_id {return theme_error("请先切换到其他主题，再删除当前主题");}
    let path=Path::new("web/themes").join(&p.theme_id);
    if path.symlink_metadata().is_ok_and(|meta|meta.file_type().is_symlink()) {return theme_error("主题目录不能为符号链接");}
    match fs::remove_dir_all(&path) {
        Ok(())=>{let _=ctx.db.lock().unwrap().execute("INSERT INTO audit_logs(action,ip) VALUES(?1,?2)",rusqlite::params![format!("删除主题【{}】",p.theme_id),client_ip(&headers,None)]);Json(serde_json::json!({"success":true}))},
        Err(error)=>theme_error(format!("删除主题失败: {error}"))
    }
}

fn theme_error(message: impl Into<String>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "success": false, "message": message.into() }))
}

fn install_theme_archive(bytes: &[u8], fallback_name: Option<&str>, replace: bool) -> Result<theme::ThemeMeta, String> {
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    let _guard=theme::MUTATION_LOCK.lock().unwrap();

    const MAX_ARCHIVE: usize = 32 * 1024 * 1024;
    const MAX_FILES: usize = 500;
    const MAX_UNCOMPRESSED: u64 = 50 * 1024 * 1024;
    if bytes.len() > MAX_ARCHIVE {
        return Err("主题压缩包不能超过 32 MB".to_string());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| "主题压缩包不是有效的 ZIP 文件")?;
    if archive.len() > MAX_FILES {
        return Err("主题压缩包文件数量超过限制".to_string());
    }

    let mut names = Vec::new();
    let mut total_size = 0u64;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|_| "无法读取主题压缩包")?;
        if file.is_dir() {
            continue;
        }
        total_size = total_size.saturating_add(file.size());
        if total_size > MAX_UNCOMPRESSED {
            return Err("主题压缩包解压后超过 50 MB 限制".to_string());
        }
        let path = file
            .enclosed_name()
            .ok_or_else(|| "主题压缩包包含非法路径".to_string())?;
        names.push(path.to_string_lossy().replace('\\', "/"));
    }

    let metadata_path = names
        .iter()
        .find(|name| name.ends_with("/theme.json") || name.as_str() == "theme.json")
        .cloned();
    let entry_path = names
        .iter()
        .find(|name| name.ends_with("/index.html") || name.as_str() == "index.html")
        .cloned()
        .ok_or_else(|| "主题压缩包缺少 index.html".to_string())?;
    let theme_path = metadata_path.as_ref().unwrap_or(&entry_path);
    let prefix = if metadata_path.is_some() {
        theme_path.strip_suffix("theme.json").unwrap_or_default()
    } else {
        theme_path.strip_suffix("index.html").unwrap_or_default()
    }
    .to_string();
    let mut extracted = Vec::<(String, Vec<u8>)>::new();
    let mut actual_size = 0u64;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|_| "无法读取主题压缩包")?;
        if file.is_dir() {
            continue;
        }
        let path = file
            .enclosed_name()
            .ok_or_else(|| "主题压缩包包含非法路径".to_string())?;
        let full = path.to_string_lossy().replace('\\', "/");
        let relative = full
            .strip_prefix(&prefix)
            .ok_or_else(|| "主题文件必须位于 theme.json 所在目录".to_string())?
            .to_string();
        if relative.is_empty() || relative.contains("..") {
            return Err("主题压缩包包含非法文件路径".to_string());
        }
        if file.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("主题压缩包不能包含符号链接".into());
        }
        let mut content = Vec::new();
        file.by_ref().take(MAX_UNCOMPRESSED.saturating_sub(actual_size) + 1)
            .read_to_end(&mut content).map_err(|_| "读取主题文件失败")?;
        actual_size += content.len() as u64;
        if actual_size > MAX_UNCOMPRESSED { return Err("主题压缩包实际解压大小超过 50 MB".into()); }
        extracted.push((relative, content));
    }

    let meta = if let Some(metadata) = extracted.iter().find(|(path, _)| path == "theme.json") {
        serde_json::from_slice::<theme::ThemeMeta>(&metadata.1)
            .map_err(|_| "theme.json 格式无效，必须包含 id、name、version、author、description、entry")?
    } else {
        let raw_id = fallback_name.unwrap_or("imported-theme");
        let id = raw_id
            .trim_end_matches(".zip")
            .split(|c: char| c == '/' || c == '\\' || c == '@')
            .last()
            .unwrap_or("imported-theme")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(48)
            .collect::<String>();
        let id = if id.is_empty() { "imported-theme".to_string() } else { id };
        theme::ThemeMeta {
            id: id.clone(),
            name: id,
            version: "imported".to_string(),
            author: "Imported theme".to_string(),
            description: "从 dist 压缩包导入的主题".to_string(),
            preview: None,
            entry: "index.html".to_string(),
        }
    };
    if meta.id == "default" || !is_valid_theme_id(&meta.id) {
        return Err("主题 id 无效，不能使用 default，只能包含字母、数字、- 和 _".to_string());
    }
    if meta.entry != "index.html" {
        return Err("主题 entry 必须为 index.html".to_string());
    }
    if metadata_path.is_none() {
        let metadata = serde_json::to_vec(&meta).map_err(|_| "无法生成主题元数据")?;
        extracted.push(("theme.json".to_string(), metadata));
    }

    let destination = Path::new("web/themes").join(&meta.id);
    if destination.exists() && !replace {return Err("同名主题已存在，请确认更新后重试".to_string());}
    if destination.symlink_metadata().is_ok_and(|meta|meta.file_type().is_symlink()) {return Err("主题目录不能为符号链接".into());}
    fs::create_dir_all("web/themes").map_err(|_|"无法创建主题目录")?;
    let temporary = Path::new("web/themes")
        .join(format!(".uploading-{:016x}", rand::random::<u64>()));
    fs::create_dir(&temporary).map_err(|_| "无法创建主题临时目录")?;
    let write_result = (|| -> Result<(), String> {
        for (relative, content) in extracted {
            let target = temporary.join(&relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|_| "无法创建主题资源目录")?;
            }
            fs::write(target, content).map_err(|_| "无法写入主题资源")?;
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|_| "无法创建主题目录")?;
    }
    let previous=Path::new("web/themes").join(format!(".previous-{:016x}",rand::random::<u64>()));
    let had_previous=destination.exists();
    if had_previous {if let Err(error)=fs::rename(&destination,&previous){let _=fs::remove_dir_all(&temporary);return Err(format!("无法暂存旧主题: {error}"));}}
    if let Err(error) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_dir_all(&temporary);
        if had_previous {let _=fs::rename(&previous,&destination);}
        return Err(format!("安装主题失败: {}", error));
    }
    if had_previous {let _=fs::remove_dir_all(previous);}
    Ok(meta)
}

#[derive(Deserialize)]
struct ThemeInstallQuery {#[serde(default)] replace:bool}

async fn api_admin_upload_theme(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Query(options): Query<ThemeInstallQuery>,
    mut multipart: Multipart,
) -> Json<serde_json::Value> {
    let mut upload = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            let filename = field.file_name().map(str::to_string);
            match field.bytes().await {
                Ok(value) => {
                    upload = Some((value, filename));
                    break;
                }
                Err(_) => return theme_error("读取主题压缩包失败"),
            }
        }
    }
    let Some((bytes, filename)) = upload else { return theme_error("请选择一个 ZIP 主题包") };
    match install_theme_archive(&bytes, filename.as_deref(), options.replace) {
        Ok(meta) => {
            let _ = ctx.db.lock().unwrap().execute(
                "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
                rusqlite::params![format!("上传主题【{}】", meta.id), client_ip(&headers, None)],
            );
            Json(serde_json::json!({ "success": true, "theme": meta }))
        }
        Err(error) => theme_error(error),
    }
}

#[derive(Deserialize)]
struct GitHubThemeReq {
    repository: String,
    #[serde(default)]
    replace: bool,
}

#[derive(Deserialize)]
struct GitHubRelease {
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

fn parse_github_repository(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim().trim_end_matches('/').trim_end_matches(".git");
    let path = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("github.com/"))?;
    let mut parts = path.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    let valid_segment = |value: &str| {
        !value.is_empty()
            && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid_segment(owner) || !valid_segment(repo) || parts.next().is_some() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

async fn api_admin_install_theme_github(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(payload): Json<GitHubThemeReq>,
) -> Json<serde_json::Value> {
    let Some((owner, repo)) = parse_github_repository(&payload.repository) else {
        return theme_error("请输入有效的 GitHub 仓库地址，例如 https://github.com/owner/theme");
    };
    let client = match security::github_client() { Ok(client) => client, Err(error) => return theme_error(error) };
    let release = match client
        .get(format!("https://api.github.com/repos/{owner}/{repo}/releases/latest"))
        .header("User-Agent", "Moniter-theme-manager")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => match security::read_limited(response, 2 * 1024 * 1024).await
            .and_then(|bytes| serde_json::from_slice::<GitHubRelease>(&bytes).map_err(|_| "GitHub Release 信息格式无效".into())) {
            Ok(value) => value,
            Err(_) => return theme_error("GitHub Release 信息格式无效"),
        },
        Ok(response) if response.status().as_u16() == 404 => {
            return theme_error("仓库没有公开的最新 Release，或仓库不存在")
        }
        Ok(response) => return theme_error(format!("GitHub 返回 HTTP {}", response.status())),
        Err(error) => return theme_error(format!("无法访问 GitHub: {}", error)),
    };
    let Some(asset) = release.assets.iter().find(|asset| asset.name.to_ascii_lowercase().ends_with(".zip")) else {
        return theme_error("最新 Release 没有 .zip 主题资源");
    };
    let Ok(download_url) = reqwest::Url::parse(&asset.browser_download_url) else {
        return theme_error("GitHub Release 提供的下载地址无效");
    };
    if download_url.scheme() != "https" || download_url.host_str() != Some("github.com") {
        return theme_error("GitHub Release 下载地址必须来自 github.com");
    }
    let response = match client
        .get(download_url)
        .header("User-Agent", "Moniter-theme-manager")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => return theme_error(format!("下载主题资源失败，HTTP {}", response.status())),
        Err(error) => return theme_error(format!("下载主题资源失败: {}", error)),
    };
    if response.content_length().is_some_and(|size| size > 32 * 1024 * 1024) {
        return theme_error("GitHub 主题压缩包不能超过 32 MB");
    }
    let bytes = match security::read_limited(response, 32 * 1024 * 1024).await {
        Ok(value) => value,
        Err(error) => return theme_error(format!("读取主题资源失败: {}", error)),
    };
    match install_theme_archive(&bytes, Some(&asset.name), payload.replace) {
        Ok(meta) => {
            let _ = ctx.db.lock().unwrap().execute(
                "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
                rusqlite::params![format!("从 GitHub 导入主题【{}】", meta.id), client_ip(&headers, None)],
            );
            Json(serde_json::json!({ "success": true, "theme": meta }))
        }
        Err(error) => theme_error(error),
    }
}

// ==========================================================================
// WebSocket 实时数据流处理 (Agent 上报与浏览器端订阅广播)
// ==========================================================================
#[derive(Deserialize, Default)]
struct AgentQuery {
    token: Option<String>,
}

/// 列出所有已注册节点：数据库元数据 + 实时状态合并。
///
/// 之前 `/api/v1/servers` 只返回内存里的在线节点，离线节点直接消失；
/// 而前台又拿 data.js 里的硬编码列表兜底，结果页面上混着真假两批机器。
/// 现在统一以 servers 表为准，离线的也返回（status=offline），
/// 实时字段保持 0，前端会渲染成占位符。
fn list_all_servers(ctx: &AppContext) -> Vec<ServerStateItem> {
    // 先查库并让连接在本块结束时释放，再取实时快照。
    // 两把锁不能嵌套 —— 别处（api_admin_get_servers）是先 db 后 live，
    // 如果这里反过来写，两个请求并发时就会死锁。
    let mut rows: Vec<ServerStateItem> = {
        let conn = ctx.db.lock().unwrap();
        let sql = format!("{} ORDER BY created_at ASC", SERVER_SELECT);
        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let iter = stmt.query_map([], row_to_item);

        match iter {
            Ok(i) => i.flatten().collect(),
            Err(_) => Vec::new(),
        }
    };

    // 在线的节点用实时快照整体覆盖
    {
        let map = ctx.live_servers.lock().unwrap();
        for item in rows.iter_mut() {
            if let Some((live, _)) = map.get(&item.id) {
                *item = live.clone();
            }
        }
    }

    // 已用流量统一在服务端算（含校准基线）
    let conn = ctx.db.lock().unwrap();
    for item in rows.iter_mut() {
        item.traffic_used_bytes = traffic::read(&conn, item, now_secs() as i64);
    }

    rows
}

/// 读取全部监控目标（后台和 Agent 共用）
fn list_targets(ctx: &AppContext, only_enabled: bool) -> Vec<MonitorTarget> {
    let conn = ctx.db.lock().unwrap();
    let sql = if only_enabled {
        "SELECT id, name, host, port, carrier, region, enabled FROM monitor_targets WHERE enabled = 1 ORDER BY id ASC"
    } else {
        "SELECT id, name, host, port, carrier, region, enabled FROM monitor_targets ORDER BY id ASC"
    };

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let iter = stmt.query_map([], |r| {
        Ok(MonitorTarget {
            id: r.get(0)?,
            name: r.get(1)?,
            host: r.get(2)?,
            port: r.get(3)?,
            carrier: r.get(4)?,
            region: r.get(5)?,
            enabled: r.get::<_, i64>(6)? != 0,
        })
    });

    match iter {
        Ok(i) => i.flatten().collect(),
        Err(_) => Vec::new(),
    }
}

/// 根据节点自身的监控开关和范围裁剪下发给 Agent 的目标。
fn list_targets_for_server(ctx: &AppContext, server: &ServerStateItem) -> Vec<MonitorTarget> {
    if !server.monitor_enabled {
        return Vec::new();
    }
    let all = list_targets(ctx, true);
    if server.monitor_mode != "selected" {
        return all;
    }
    let selected: std::collections::HashSet<i64> = server
        .monitor_targets
        .split(',')
        .filter_map(|v| v.trim().parse().ok())
        .collect();
    all.into_iter()
        .filter(|t| selected.contains(&t.id))
        .collect()
}

async fn ws_agent_handler(
    ws: WebSocketUpgrade,
    State(ctx): State<AppContext>,
    Query(q): Query<AgentQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    let source_ip = client_ip(&headers, Some(addr));
    static CONNECTIONS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let Ok(permit) = CONNECTIONS.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(512))).clone().try_acquire_owned() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Agent connection limit reached").into_response();
    };
    ws.max_message_size(256 * 1024).max_frame_size(256 * 1024).on_upgrade(move |socket| async move {
        let _permit = permit;
        handle_agent_ws(socket, ctx, q.token, source_ip).await
    })
}

/// 从数据库按令牌反查节点配置。
fn lookup_server_by_token(ctx: &AppContext, token: &str) -> Option<ServerStateItem> {
    let conn = ctx.db.lock().unwrap();
    let sql = format!("{} WHERE token = ?1", SERVER_SELECT);
    let mut item = conn.query_row(&sql, [token], row_to_item).ok()?;
    item.status = "online".to_string();
    Some(item)
}

async fn handle_agent_ws(
    mut socket: WebSocket,
    ctx: AppContext,
    query_token: Option<String>,
    source_ip: String,
) {
    println!("🔌 新 Agent 尝试连接...");

    // 优先用 URL 上的 token；没有就等第一帧里的 token（兼容老版 agent）
    let mut verified: Option<ServerStateItem> = None;
    let connection_id = rand::random::<u64>();
    let mut owned_server: Option<String> = None;
    if let Some(t) = query_token.as_deref() {
        match lookup_server_by_token(&ctx, t) {
            Some(item) => {
                println!("✅ Agent 认证通过: {} ({})", item.name, item.id);
                verified = Some(item);
            }
            None => {
                println!("⛔ 拒绝连接：令牌未注册");
                let _ = socket
                    .send(Message::Text(
                        serde_json::json!({"error":"invalid_token"}).to_string(),
                    ))
                    .await;
                let _ = socket.send(Message::Close(None)).await;
                return;
            }
        }
    }

    // 每个连接独立记录上次落库时间，天然按节点隔离
    let mut last_persist = Instant::now() - METRICS_PERSIST_INTERVAL;
    // 监控目标元数据缓存：60 秒刷新一次，避免每秒心跳都查库
    let mut target_meta: Vec<MonitorTarget> = Vec::new();
    let mut target_refresh = Instant::now() - Duration::from_secs(3600);
    let auth_deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let deadline = if verified.is_none() { auth_deadline } else { tokio::time::Instant::now() + Duration::from_secs(60) };
        let msg = match tokio::time::timeout_at(deadline, socket.next()).await {
            Ok(Some(Ok(message))) => message,
            _ => { let _ = socket.send(Message::Close(None)).await; break; }
        };
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        let payload: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // 尚未认证的连接，用首帧 token 补做一次认证
        if verified.is_none() {
            let t = payload
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            match lookup_server_by_token(&ctx, t) {
                Some(item) => {
                    println!("✅ Agent 认证通过（首帧令牌）: {} ({})", item.name, item.id);
                    verified = Some(item);
                }
                None => {
                    println!("⛔ 拒绝连接：首帧令牌无效");
                    let _ = socket
                        .send(Message::Text(
                            serde_json::json!({"error":"invalid_token"}).to_string(),
                        ))
                        .await;
                    let _ = socket.send(Message::Close(None)).await;
                    return;
                }
            }
        }

        if owned_server.is_none() {
            if let Some(meta) = verified.as_ref() {
                ctx.agent_connections.lock().unwrap().insert(meta.id.clone(), connection_id);
                owned_server = Some(meta.id.clone());
            }
        }
        if let Some(id) = &owned_server {
            if ctx.agent_connections.lock().unwrap().get(id) != Some(&connection_id) { break; }
        }

        // Revalidate every report so reset/deleted credentials cannot keep an
        // already-established connection authenticated for another five minutes.
        if let Some(token) = verified.as_ref().map(|item| item.token.clone()) {
            verified = lookup_server_by_token(&ctx, &token);
            if verified.is_none() { let _ = socket.send(Message::Close(None)).await; break; }
        }

        let meta = match verified.as_ref() {
            Some(m) => m.clone(),
            None => continue,
        };

        let agent_version = payload
            .get("agent_version")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Ok(ip) = source_ip.parse::<std::net::IpAddr>() {
            let detected = if ip.is_ipv4() { &meta.detected_ipv4 } else { &meta.detected_ipv6 };
            if detected != &source_ip || (!agent_version.is_empty() && agent_version != meta.agent_version) {
                let conn = ctx.db.lock().unwrap();
                let column = if ip.is_ipv4() { "detected_ipv4" } else { "detected_ipv6" };
                let _ = conn.execute(&format!("UPDATE servers SET {column}=?2, agent_version=CASE WHEN ?3='' THEN agent_version ELSE ?3 END WHERE id=?1"),
                    rusqlite::params![meta.id,source_ip,agent_version]);
            }
        }

        // 控制消息：Agent 主动请求监控目标列表。
        // 走 WebSocket 而不是让 Agent 再开一个 HTTP 客户端，省一个依赖。
        if payload.get("type").and_then(|v| v.as_str()) == Some("get_targets") {
            let list = list_targets_for_server(&ctx, &meta);
            let reply = serde_json::json!({
                "type": "targets",
                "list": list,
                "route_enabled": meta.route_enabled,
                "latency_enabled": meta.monitor_enabled
            })
            .to_string();
            if socket.send(Message::Text(reply)).await.is_err() {
                break;
            }
            continue;
        }

        // 令牌首帧只负责认证，不应被当成一条空指标写入。
        if payload.get("stats").is_none() {
            continue;
        }

        let stats = payload.get("stats");
        let latency_source=payload.get("latency_source").and_then(|v|v.as_str()).filter(|value|*value=="sh-zstatic-tcp80-v1").unwrap_or("");
        let latency = if meta.monitor_enabled && !latency_source.is_empty() {
            payload.get("latency")
        } else {
            None
        };
        let routes = if meta.route_enabled {
            payload.get("routes")
        } else {
            None
        };

        let cpu_usage = stats
            .and_then(|s| s.get("cpu_usage"))
            .and_then(|c| c.as_f64())
            .unwrap_or(0.0) as f32;
        let mem_used = stats
            .and_then(|s| s.get("mem_used_bytes"))
            .and_then(|m| m.as_u64())
            .unwrap_or(0)
            / 1024
            / 1024;
        let mem_total = stats
            .and_then(|s| s.get("mem_total_bytes"))
            .and_then(|m| m.as_u64())
            .unwrap_or(0)
            / 1024
            / 1024;
        let net_in = stats
            .and_then(|s| s.get("net_in_speed_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0)
            / 1024;
        let net_out = stats
            .and_then(|s| s.get("net_out_speed_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0)
            / 1024;

        let disk_used = stats
            .and_then(|s| s.get("disk_used_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let disk_total = stats
            .and_then(|s| s.get("disk_total_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let total_rx = stats
            .and_then(|s| s.get("total_rx_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let total_tx = stats
            .and_then(|s| s.get("total_tx_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let uptime = stats
            .and_then(|s| s.get("uptime_secs"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let swap_used = stats
            .and_then(|s| s.get("swap_used_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0)
            / 1024
            / 1024;
        let swap_total = stats
            .and_then(|s| s.get("swap_total_bytes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0)
            / 1024
            / 1024;

        let tcp_conns = stats
            .and_then(|s| s.get("tcp_conns"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0) as u32;
        let udp_conns = stats
            .and_then(|s| s.get("udp_conns"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0) as u32;
        let processes = stats
            .and_then(|s| s.get("processes"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0) as u32;

        let load1 = stats
            .and_then(|s| s.get("load1"))
            .and_then(|n| n.as_f64())
            .unwrap_or(0.0) as f32;
        let load5 = stats
            .and_then(|s| s.get("load5"))
            .and_then(|n| n.as_f64())
            .unwrap_or(0.0) as f32;
        let load15 = stats
            .and_then(|s| s.get("load15"))
            .and_then(|n| n.as_f64())
            .unwrap_or(0.0) as f32;

        let arch = stats
            .and_then(|s| s.get("arch"))
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        let virtualization = stats
            .and_then(|s| s.get("virtualization"))
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        let gpu = stats
            .and_then(|s| s.get("gpu"))
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();

        let os_name = stats
            .and_then(|s| s.get("os_name"))
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        let kernel_ver = stats
            .and_then(|s| s.get("kernel_ver"))
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        let cpu_model = stats
            .and_then(|s| s.get("cpu_model"))
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        let cpu_cores = stats
            .and_then(|s| s.get("cpu_cores"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0) as u32;

        let ct_ping = latency
            .and_then(|l| l.get("ct_ms"))
            .and_then(|p| p.as_u64())
            .unwrap_or(0) as u32;
        let cu_ping = latency
            .and_then(|l| l.get("cu_ms"))
            .and_then(|p| p.as_u64())
            .unwrap_or(0) as u32;
        let cm_ping = latency
            .and_then(|l| l.get("cm_ms"))
            .and_then(|p| p.as_u64())
            .unwrap_or(0) as u32;
        let intl_ping = latency
            .and_then(|l| l.get("intl_ms"))
            .and_then(|p| p.as_u64())
            .unwrap_or(0) as u32;

        let route_set: Option<RouteSet> =
            routes.and_then(|r| serde_json::from_value(r.clone()).ok());

        // 自定义监控目标的探测结果。Agent 只上报 [{"id":1,"ms":12}]，
        // 目标名称/运营商/地区由主控从 monitor_targets 表补齐。
        if target_refresh.elapsed() > Duration::from_secs(60) {
            target_meta = list_targets(&ctx, true);
            target_refresh = Instant::now();
        }
        let reported: Vec<(i64, u32)> = if meta.monitor_enabled {
            payload
                .get("targets")
                .and_then(|t| t.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| {
                            let id = v.get("id")?.as_i64()?;
                            let ms = v.get("ms")?.as_u64()? as u32;
                            Some((id, ms))
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let target_results: Vec<TargetLatency> = reported
            .into_iter()
            .filter_map(|(id, ms)| {
                target_meta
                    .iter()
                    .find(|t| t.id == id)
                    .map(|t| TargetLatency {
                        id: t.id,
                        name: t.name.clone(),
                        host: t.host.clone(),
                        carrier: t.carrier.clone(),
                        region: t.region.clone(),
                        ms,
                    })
            })
            .collect();

        let mut item = ServerStateItem {
            status: "online".to_string(),
            last_seen: now_millis(),
            current_cpu: cpu_usage,
            mem_used_mb: mem_used,
            mem_total_mb: mem_total,
            swap_used_mb: swap_used,
            swap_total_mb: swap_total,
            net_in_speed_kb: net_in,
            net_out_speed_kb: net_out,
            disk_used_bytes: disk_used,
            disk_total_bytes: disk_total,
            total_rx_bytes: total_rx,
            total_tx_bytes: total_tx,
            uptime_secs: uptime,
            os_name,
            kernel_ver,
            arch,
            virtualization,
            gpu,
            cpu_model,
            cpu_cores,
            tcp_conns,
            udp_conns,
            processes,
            load1,
            load5,
            load15,
            latency_ct: ct_ping,
            latency_cu: cu_ping,
            latency_cm: cm_ping,
            latency_intl: intl_ping,
            latency_source:latency_source.to_string(),
            routes: route_set,
            targets: target_results,
            // 其余字段（名称/地区/账单/校准基线/监控开关）全部沿用数据库里的配置
            ..meta.clone()
        };
        if source_ip
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_ipv4())
            .unwrap_or(false)
        {
            if !item.manual_ipv4 { item.ipv4 = source_ip.clone(); }
            item.detected_ipv4 = source_ip.clone();
        } else {
            if !item.manual_ipv6 { item.ipv6 = source_ip.clone(); }
            item.detected_ipv6 = source_ip.clone();
        }
        if !agent_version.is_empty() {
            item.agent_version = agent_version.to_string();
        }
        {
            let conn = ctx.db.lock().unwrap();
            match traffic::update(&conn, &item, now_secs() as i64) {
                Ok(value) => item.traffic_used_bytes = value,
                Err(error) => { eprintln!("流量累计保存失败: {error}"); item.traffic_used_bytes = traffic::read(&conn,&item,now_secs() as i64); }
            }
        }

        let was_offline = {
            let mut map = ctx.live_servers.lock().unwrap();
            let offline = map.get(&item.id).map(|(previous, _)| previous.status == "offline").unwrap_or(false);
            map.insert(item.id.clone(), (item.clone(), Instant::now()));
            offline
        };

        // 节点从离线恢复时记录并发送恢复通知；首次上线不算恢复。
        if was_offline && item.alert_enabled && item.alert_offline {
            let cfg = {
                let conn = ctx.db.lock().unwrap();
                notify::AlertConfig::load(&conn)
            };
            if cfg.enabled
                && cfg.notify_online
            {
                let alert = notify::AlertMessage {
                    server_name: item.name.clone(),
                    event_type: "online".to_string(),
                    message: "节点已恢复在线，心跳重新接收。".to_string(),
                    timestamp: format_ts(now_secs()),
                };
                record_alert_event(&ctx, &item.id, "online", &alert.message);
                alert_dispatch::dispatch(&cfg, alert, "恢复");
            }
        }

        // 3. 节流落库，供历史图表使用
        if last_persist.elapsed() >= METRICS_PERSIST_INTERVAL {
            last_persist = Instant::now();
            let mut connection = ctx.db.lock().unwrap();
            let Ok(conn) = connection.transaction() else { continue; };
            let _ = conn.execute(
                "UPDATE servers SET last_seen = ?2 WHERE id = ?1",
                rusqlite::params![item.id, item.last_seen as i64],
            );
            let _ = conn.execute(
                "INSERT INTO metrics (server_id, ts, cpu, mem_used_mb, mem_total_mb,
                                      net_in_kb, net_out_kb, latency_ct, latency_cu, latency_cm,
                                      tcp_conns, udp_conns, processes,
                                      load1, load5, load15,
                                      swap_used_mb, swap_total_mb,
                                      disk_used_bytes, disk_total_bytes, latency_source)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                         ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                rusqlite::params![
                    item.id,
                    now_secs() as i64,
                    item.current_cpu as f64,
                    item.mem_used_mb as i64,
                    item.mem_total_mb as i64,
                    item.net_in_speed_kb as i64,
                    item.net_out_speed_kb as i64,
                    item.latency_ct as i64,
                    item.latency_cu as i64,
                    item.latency_cm as i64,
                    item.tcp_conns as i64,
                    item.udp_conns as i64,
                    item.processes as i64,
                    item.load1 as f64,
                    item.load5 as f64,
                    item.load15 as f64,
                    item.swap_used_mb as i64,
                    item.swap_total_mb as i64,
                    item.disk_used_bytes as i64,
                    item.disk_total_bytes as i64,
                    item.latency_source,
                ],
            );
            // 监控目标的探测结果同样节流落库，供前端画趋势线
            if !item.targets.is_empty() {
                let ts = now_secs() as i64;
                for t in &item.targets {
                    let _ = conn.execute(
                        "INSERT INTO target_metrics (server_id, target_id, ts, ms) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![item.id, t.id, ts, t.ms as i64],
                    );
                }
            }
            let _ = conn.commit();
        }
    }

    // Every disconnect goes through the same offline transition as a timeout.
    // Only the current connection may expire a node; an old socket owns no state.
    if let Some(id) = owned_server {
        let mut owners = ctx.agent_connections.lock().unwrap();
        if owners.get(&id) == Some(&connection_id) {
            owners.remove(&id);
            if let Some((_, last)) = ctx.live_servers.lock().unwrap().get_mut(&id) {
                *last = Instant::now() - HEARTBEAT_TIMEOUT - Duration::from_millis(1);
            }
        }
    }
}

async fn ws_client_handler(ws: WebSocketUpgrade, State(ctx): State<AppContext>) -> Response {
    static CONNECTIONS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let Ok(permit) = CONNECTIONS.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1024))).clone().try_acquire_owned() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Viewer connection limit reached").into_response();
    };
    ws.max_message_size(4096).max_frame_size(4096).on_upgrade(move |socket| async move {
        let _permit = permit;
        handle_client_ws(socket, ctx).await
    })
}

async fn handle_client_ws(mut socket: WebSocket, ctx: AppContext) {
    let mut rx = ctx.client_tx.subscribe();
    loop {
        tokio::select! {
            received = socket.next() => match received {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                _ => {},
            },
            received = rx.recv() => match received {
                Ok(message) => if !matches!(tokio::time::timeout(Duration::from_secs(10), socket.send(Message::Text(message))).await, Ok(Ok(()))) { break; },
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
        }
    }
}

// ==========================================================================
// 管理员后台业务逻辑 (登录、防爆破、节点管理、主题切换、安全审计)
// ==========================================================================
#[derive(Deserialize)]
struct AdminLoginReq {
    username: String,
    password: String,
    /// 启用 2FA 后必填
    #[serde(default)]
    totp_code: Option<String>,
}

#[derive(Serialize)]
struct AdminLoginResp {
    success: bool,
    token: Option<String>,
    message: String,
    /// true 表示密码已通过，但还缺两步验证码
    #[serde(skip_serializing_if = "Option::is_none")]
    need_totp: Option<bool>,
}

async fn api_admin_login(
    State(ctx): State<AppContext>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<AdminLoginReq>,
) -> Json<AdminLoginResp> {
    let ip = client_ip(&headers, Some(addr));
    static LOGIN_SLOTS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let Ok(_permit) = LOGIN_SLOTS.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(4))).clone().try_acquire_owned() else {
        return Json(AdminLoginResp { success: false, token: None, message: "登录请求较多，请稍后重试".into(), need_totp: None });
    };
    if payload.username.len() > 64 || payload.password.len() > 1024 || payload.totp_code.as_ref().is_some_and(|code| code.len() > 16) {
        return Json(AdminLoginResp { success: false, token: None, message: "登录信息格式无效".into(), need_totp: None });
    }

    if ctx.security.is_ip_blocked(&ip) {
        let remain = ctx.security.remaining_lockout_secs(&ip);
        return Json(AdminLoginResp {
            success: false,
            token: None,
            message: format!(
                "登录失败次数过多，该 IP 已被锁定，请 {} 分钟后再试",
                (remain / 60).max(1)
            ),
            need_totp: None,
        });
    }

    let stored: Option<(String, String)> = {
        let conn = ctx.db.lock().unwrap();
        conn.query_row(
            "SELECT username, password_hash FROM admin WHERE username = ?1",
            [&payload.username],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()
    };

    // 用户不存在时也走一遍哈希校验，避免通过响应时间判断用户名是否存在
    let hash = stored.as_ref().map(|(_, hash)| hash.clone()).unwrap_or_else(||
        "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000".into());
    let password = payload.password.clone();
    let verified = tokio::task::spawn_blocking(move || auth::verify_password(&password, &hash))
        .await.unwrap_or(false) && stored.is_some();

    if !verified {
        ctx.security.record_failure(&ip);
        {
            let conn = ctx.db.lock().unwrap();
            let _ = conn.execute(
                "INSERT INTO audit_logs (action, ip) VALUES ('管理员登录失败', ?1)",
                [&ip],
            );
        }
        return Json(AdminLoginResp {
            success: false,
            token: None,
            message: "账号或密码错误".to_string(),
            need_totp: None,
        });
    }

    // 密码正确 → 若启用了两步验证，还要校验 TOTP
    let (totp_enabled, totp_secret): (i64, String) = {
        let conn = ctx.db.lock().unwrap();
        conn.query_row(
            "SELECT totp_enabled, totp_secret FROM admin WHERE username = 'admin'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, String::new()))
    };

    if totp_enabled != 0 {
        let code = payload
            .totp_code
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string();

        if code.is_empty() {
            // 密码对了但还没填验证码 —— 不算登录失败，不累计爆破计数
            return Json(AdminLoginResp {
                success: false,
                token: None,
                message: "请输入两步验证码".to_string(),
                need_totp: Some(true),
            });
        }

        let valid = build_totp(&totp_secret, "admin")
            .map(|t| t.check_current(&code).unwrap_or(false))
            .unwrap_or(false);

        if !valid {
            ctx.security.record_failure(&ip);
            {
                let conn = ctx.db.lock().unwrap();
                let _ = conn.execute(
                    "INSERT INTO audit_logs (action, ip) VALUES ('两步验证码错误', ?1)",
                    [&ip],
                );
            }
            return Json(AdminLoginResp {
                success: false,
                token: None,
                message: "验证码不正确".to_string(),
                need_totp: Some(true),
            });
        }
    }

    ctx.security.clear_failures(&ip);
    let session_token = match ctx.sessions.issue(&ip) {
        Ok(token) => token,
        Err(_) => return Json(AdminLoginResp { success: false, token: None, message: "无法保存登录会话，请稍后重试".into(), need_totp: None }),
    };
    {
        let conn = ctx.db.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
            rusqlite::params![format!("管理员【{}】登录成功", payload.username), ip],
        );
    }

    let cfg={let conn=ctx.db.lock().unwrap();notify::AlertConfig::load(&conn)};
    if cfg.enabled && cfg.notify_login {
        let alert=notify::AlertMessage {server_name:cfg.site_name.clone(),event_type:"login".into(),message:format!("管理员 {} 登录成功；来源 IP：{}",payload.username,ip),timestamp:format_ts(now_secs())};
        record_alert_event(&ctx,"admin","login",&alert.message);
        alert_dispatch::dispatch(&cfg,alert,"登录");
    }

    Json(AdminLoginResp {
        success: true,
        token: Some(session_token),
        message: "登录成功".to_string(),
        need_totp: None,
    })
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string())
}

async fn api_admin_status() -> Json<serde_json::Value> {
    // 能走到这里说明中间件已经校验过令牌
    Json(serde_json::json!({ "logged_in": true }))
}

#[derive(Serialize)]
struct SiteSettingsResponse {
    site_name: String,
}

fn read_site_name(ctx: &AppContext) -> String {
    ctx.db
        .lock()
        .unwrap()
        .query_row(
            "SELECT value FROM settings WHERE key = 'site_name'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "Moniter".to_string())
}

async fn api_get_site_settings(State(ctx): State<AppContext>) -> Json<SiteSettingsResponse> {
    Json(SiteSettingsResponse {
        site_name: read_site_name(&ctx),
    })
}

async fn api_admin_site_settings(State(ctx): State<AppContext>) -> Json<SiteSettingsResponse> {
    Json(SiteSettingsResponse {
        site_name: read_site_name(&ctx),
    })
}

#[derive(Deserialize)]
struct SaveSiteSettingsReq {
    site_name: String,
}

async fn api_admin_save_site_settings(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(payload): Json<SaveSiteSettingsReq>,
) -> Json<serde_json::Value> {
    let site_name = payload.site_name.trim();
    if site_name.is_empty()
        || site_name.chars().count() > 48
        || site_name.chars().any(char::is_control)
    {
        return Json(
            serde_json::json!({"success": false, "message": "网站名称需为 1 到 48 个字符"}),
        );
    }
    let conn = ctx.db.lock().unwrap();
    let result = conn.execute(
        "INSERT INTO settings (key, value) VALUES ('site_name', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [site_name],
    );
    if let Err(error) = result {
        return Json(serde_json::json!({"success": false, "message": error.to_string()}));
    }
    let ip = client_ip(&headers, None);
    let _ = conn.execute(
        "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
        rusqlite::params![format!("修改网站名称为【{}】", site_name), ip],
    );
    Json(serde_json::json!({"success": true, "site_name": site_name}))
}

async fn api_admin_logout(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
) -> Json<serde_json::Value> {
    if let Some(t) = bearer_token(&headers) {
        ctx.sessions.revoke(&t);
    }
    Json(serde_json::json!({ "success": true }))
}

#[derive(Serialize)]
struct ManagedServerItem {
    id: String,
    token: String,
    name: String,
    region: String,
    region_name: String,
    region_name_en: String,
    provider: String,
    ipv4: String,
    ipv6: String,
    ipv4_override: String,
    ipv6_override: String,
    agent_version: String,
    tags: String,
    billing_price: f64,
    billing_currency: String,
    billing_cycle: String,
    renewal_date: String,
    traffic_limit_gb: f64,
    traffic_type: String,
    traffic_reset_day: i64,
    traffic_used_gb: f64,
    traffic_base_gb: f64,
    monitor_enabled: bool,
    monitor_mode: String,
    monitor_targets: String,
    route_enabled: bool,
    alert_enabled: bool,
    alert_offline: bool,
    alert_cpu: bool,
    alert_traffic: bool,
    status: String,
    billing_currency_code: String,
    public_ip: bool,
    alert_rules: alert_rules::NodeRules,
    current_cpu: Option<f32>,
    latency_ct: Option<u32>,
    latency_cu: Option<u32>,
    latency_cm: Option<u32>,
    last_seen: u64,
}

async fn api_admin_get_servers(State(ctx): State<AppContext>) -> Json<Vec<ManagedServerItem>> {
    let rows: Vec<ManagedServerItem> = {
        let conn = ctx.db.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, token, name, region, region_name, region_name_en, provider,
                    billing_price, billing_currency, billing_cycle, renewal_date, traffic_limit_gb,
                    ipv4, ipv6, agent_version, tags,
                    traffic_type, traffic_reset_day, traffic_base_gb,
                    monitor_enabled, monitor_mode, monitor_targets, route_enabled,
                    alert_enabled, alert_offline, alert_cpu, alert_traffic, billing_currency_code, public_ip, last_seen, detected_ipv4, detected_ipv6, alert_rules
             FROM servers ORDER BY created_at DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Json(Vec::new()),
        };

        let iter = stmt.query_map([], |r| {
            Ok(ManagedServerItem {
                id: r.get(0)?,
                token: r.get(1)?,
                name: r.get(2)?,
                region: r.get(3)?,
                region_name: r.get(4)?,
                region_name_en: r.get(5)?,
                provider: r.get(6)?,
                billing_price: r.get(7)?,
                billing_currency: r.get(8)?,
                billing_cycle: r.get(9)?,
                renewal_date: r.get(10)?,
                traffic_limit_gb: r.get(11)?,
                ipv4: { let ip:String=r.get(12)?; if ip.is_empty() {r.get(30)?} else {ip} },
                ipv6: { let ip:String=r.get(13)?; if ip.is_empty() {r.get(31)?} else {ip} },
                ipv4_override: r.get(12)?,
                ipv6_override: r.get(13)?,
                agent_version: r.get(14)?,
                tags: r.get(15)?,
                traffic_type: r.get(16)?,
                traffic_reset_day: r.get(17)?,
                traffic_base_gb: r.get(18)?,
                traffic_used_gb: 0.0,
                monitor_enabled: r.get::<_, i64>(19)? != 0,
                monitor_mode: r.get(20)?,
                monitor_targets: r.get(21)?,
                route_enabled: r.get::<_, i64>(22)? != 0,
                alert_enabled: r.get::<_, i64>(23)? != 0,
                alert_offline: r.get::<_, i64>(24)? != 0,
                alert_cpu: r.get::<_, i64>(25)? != 0,
                alert_traffic: r.get::<_, i64>(26)? != 0,
                status: "offline".to_string(),
                billing_currency_code: r.get(27)?,
                public_ip: r.get::<_,i64>(28)? != 0,
                alert_rules: serde_json::from_str(&r.get::<_,String>(32)?).unwrap_or_default(),
                last_seen: r.get::<_,i64>(29)? as u64,
                current_cpu: None, latency_ct:None,latency_cu:None,latency_cm:None,
            })
        });

        match iter {
            Ok(i) => i.flatten().collect(),
            Err(_) => Vec::new(),
        }
    };

    // 在线状态和已用流量从实时快照补
    {
        let snapshot = list_all_servers(&ctx);
        let mut list = rows;
        for item in list.iter_mut() {
            if let Some(live) = snapshot.iter().find(|s| s.id == item.id) {
                item.status = live.status.clone();
                item.last_seen = live.last_seen;
                if live.status == "online" {
                    item.current_cpu=Some(live.current_cpu);
                    item.latency_ct=Some(live.latency_ct);item.latency_cu=Some(live.latency_cu);item.latency_cm=Some(live.latency_cm);
                }
                item.traffic_used_gb = live.traffic_used_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
            }
        }
        Json(list)
    }
}

#[derive(Serialize)]
struct CostNode {
    name: String,
    provider: String,
    price: f64,
    currency: String,
    currency_code: String,
    cycle: String,
    renewal_date: String,
}

async fn api_admin_costs(State(ctx): State<AppContext>) -> Json<Vec<CostNode>> {
    let conn = ctx.db.lock().unwrap();
    let mut stmt = match conn.prepare(
        "SELECT name, provider, billing_price, billing_currency, billing_currency_code, billing_cycle, renewal_date FROM servers ORDER BY name",
    ) {
        Ok(s) => s,
        Err(_) => return Json(Vec::new()),
    };
    let rows = stmt
        .query_map([], |r| {
            Ok(CostNode {
                name: r.get(0)?,
                provider: r.get(1)?,
                price: r.get(2)?,
                currency: r.get(3)?,
                currency_code: r.get(4)?,
                cycle: r.get(5)?,
                renewal_date: r.get(6)?,
            })
        })
        .map(|r| r.flatten().collect())
        .unwrap_or_default();
    Json(rows)
}

#[derive(Deserialize)]
struct AddServerReq {
    name: String,
    #[serde(default = "default_unknown_region")]
    region: String,
    #[serde(default = "default_unknown_region_name")]
    region_name: String,
    #[serde(default)]
    region_name_en: Option<String>,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    billing_price: f64,
    #[serde(default = "default_billing_currency")]
    billing_currency: String,
    #[serde(default)]
    billing_currency_code: Option<String>,
    #[serde(default = "default_billing_cycle")]
    billing_cycle: String,
    #[serde(default)]
    renewal_date: String,
    #[serde(default)]
    traffic_limit_gb: f64,
    #[serde(default)]
    traffic_type: Option<String>,
    #[serde(default)]
    traffic_reset_day: Option<i64>,
    #[serde(default)]
    monitor_enabled: Option<bool>,
    #[serde(default)]
    monitor_mode: Option<String>,
    #[serde(default)]
    monitor_targets: Option<String>,
    #[serde(default)]
    route_enabled: Option<bool>,
    #[serde(default)]
    alert_enabled: Option<bool>,
    #[serde(default)]
    alert_offline: Option<bool>,
    #[serde(default)]
    alert_cpu: Option<bool>,
    #[serde(default)]
    alert_traffic: Option<bool>,
    #[serde(default)]
    alert_rules: Option<alert_rules::NodeRules>,
}

async fn api_admin_save_server_legacy(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(value): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    if value.get("id").and_then(|id| id.as_str()).is_some() {
        match serde_json::from_value::<UpdateServerReq>(value) {
            Ok(payload) => api_admin_update_server(State(ctx), headers, Json(payload)).await,
            Err(error) => Json(serde_json::json!({
                "success": false,
                "message": format!("请求参数无效: {}", error)
            })),
        }
    } else {
        match serde_json::from_value::<AddServerReq>(value) {
            Ok(payload) => api_admin_add_server(State(ctx), headers, Json(payload)).await,
            Err(error) => Json(serde_json::json!({
                "success": false,
                "message": format!("请求参数无效: {}", error)
            })),
        }
    }
}

fn default_unknown_region() -> String {
    "un".to_string()
}

fn default_unknown_region_name() -> String {
    "Unknown".to_string()
}

fn default_billing_currency() -> String {
    "$".to_string()
}

fn default_billing_cycle() -> String {
    "free".to_string()
}

async fn api_admin_add_server(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<AddServerReq>,
) -> Json<serde_json::Value> {
    let name = p.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 64 {
        return Json(
            serde_json::json!({ "success": false, "message": "节点名称不能为空且不超过 64 字符" }),
        );
    }

    let token = auth::generate_node_token();
    let server_id = format!("srv-{}", &token[..8]);
    let ip = client_ip(&headers, None);

    let traffic_type = match p.traffic_type.as_deref() {
        Some("both") => "both",
        _ => "outbound",
    };
    let reset_day = p.traffic_reset_day.unwrap_or(1).clamp(1, 31);
    let monitor_mode = match p.monitor_mode.as_deref() {
        Some("selected") => "selected",
        _ => "all",
    };

    let conn = ctx.db.lock().unwrap();
    if let Err(e) = conn.execute(
        "INSERT INTO servers (id, token, name, region, region_name, region_name_en, provider, tags,
                              billing_currency_code,
                              billing_price, billing_currency, billing_cycle, renewal_date, traffic_limit_gb,
                              traffic_type, traffic_reset_day, monitor_enabled, monitor_mode, monitor_targets, route_enabled,
                              alert_enabled, alert_offline, alert_cpu, alert_traffic, alert_rules)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
        rusqlite::params![
            server_id,
            token,
            name,
            p.region,
            p.region_name,
            p.region_name_en.unwrap_or_default(),
            p.provider,
            p.tags.trim(),
            p.billing_currency_code.unwrap_or_else(|| "USD".to_string()),
            p.billing_price,
            p.billing_currency,
            p.billing_cycle,
            p.renewal_date,
            p.traffic_limit_gb,
            traffic_type,
            reset_day,
            p.monitor_enabled.unwrap_or(false) as i64,
            monitor_mode,
            p.monitor_targets.unwrap_or_default(),
            p.route_enabled.unwrap_or(false) as i64,
            p.alert_enabled.unwrap_or(false) as i64,
            p.alert_offline.unwrap_or(true) as i64,
            p.alert_cpu.unwrap_or(false) as i64,
            p.alert_traffic.unwrap_or(false) as i64,
            serde_json::to_string(&p.alert_rules.unwrap_or_default()).unwrap(),
        ],
    ) {
        return Json(serde_json::json!({ "success": false, "message": format!("写入失败: {}", e) }));
    }

    let _ = conn.execute(
        "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
        rusqlite::params![format!("添加新服务器节点【{}】", name), ip],
    );

    Json(serde_json::json!({ "success": true, "id": server_id, "token": token }))
}

#[derive(Deserialize)]
struct UpdateServerReq {
    id: String,
    #[serde(default)]
    public_ip: Option<bool>,
    name: String,
    #[serde(default)]
    ipv4: Option<String>,
    #[serde(default)]
    ipv6: Option<String>,
    region: String,
    region_name: String,
    #[serde(default)]
    region_name_en: Option<String>,
    provider: String,
    #[serde(default)]
    tags: String,
    billing_price: f64,
    billing_currency: String,
    #[serde(default)]
    billing_currency_code: Option<String>,
    billing_cycle: String,
    renewal_date: String,
    traffic_limit_gb: f64,
    // 下面这些是后加的配置项，用 Option 保证老调用方不传时保留原值
    #[serde(default)]
    traffic_type: Option<String>,
    #[serde(default)]
    traffic_reset_day: Option<i64>,
    #[serde(default)]
    monitor_enabled: Option<bool>,
    #[serde(default)]
    monitor_mode: Option<String>,
    #[serde(default)]
    monitor_targets: Option<String>,
    #[serde(default)]
    route_enabled: Option<bool>,
    #[serde(default)]
    alert_enabled: Option<bool>,
    #[serde(default)]
    alert_offline: Option<bool>,
    #[serde(default)]
    alert_cpu: Option<bool>,
    #[serde(default)]
    alert_traffic: Option<bool>,
    #[serde(default)]
    alert_rules: Option<alert_rules::NodeRules>,
}

async fn api_admin_update_server(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<UpdateServerReq>,
) -> Json<serde_json::Value> {
    let name = p.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 64 {
        return Json(
            serde_json::json!({ "success": false, "message": "节点名称不能为空且不超过 64 字符" }),
        );
    }
    if p.billing_price < 0.0 || p.traffic_limit_gb < 0.0 {
        return Json(
            serde_json::json!({ "success": false, "message": "价格和流量配额不能为负数" }),
        );
    }
    if p.ipv4.as_deref().is_some_and(|value| !value.is_empty() && value.parse::<std::net::Ipv4Addr>().is_err())
        || p.ipv6.as_deref().is_some_and(|value| !value.is_empty() && value.parse::<std::net::Ipv6Addr>().is_err()) {
        return Json(serde_json::json!({ "success": false, "message": "IPv4 或 IPv6 地址无效" }));
    }

    let traffic_type = p.traffic_type.as_deref().map(|value| if value == "both" { "both" } else { "outbound" });
    let reset_day = p.traffic_reset_day.map(|value| value.clamp(1, 31));
    let monitor_mode = p.monitor_mode.as_deref().map(|value| if value == "selected" { "selected" } else { "all" });

    let ip = client_ip(&headers, None);
    let affected = {
        let conn = ctx.db.lock().unwrap();
        let n = conn
            .execute(
                "UPDATE servers SET name = ?2, region = ?3, region_name = ?4, provider = ?5, tags = ?22,
                        billing_price = ?6, billing_currency = ?7, billing_cycle = ?8,
                        billing_currency_code = COALESCE(?23, billing_currency_code),
                        renewal_date = ?9, traffic_limit_gb = ?10,
                        region_name_en = COALESCE(?11, region_name_en),
                        traffic_type = COALESCE(?12, traffic_type), traffic_reset_day = COALESCE(?13, traffic_reset_day),
                        monitor_enabled = COALESCE(?14, monitor_enabled),
                        monitor_mode = COALESCE(?15, monitor_mode),
                        monitor_targets = COALESCE(?16, monitor_targets),
                        route_enabled = COALESCE(?17, route_enabled),
                        alert_enabled = COALESCE(?18, alert_enabled),
                        alert_offline = COALESCE(?19, alert_offline),
                        alert_cpu = COALESCE(?20, alert_cpu),
                        alert_traffic = COALESCE(?21, alert_traffic),
                        ipv4 = COALESCE(?24, ipv4), ipv6 = COALESCE(?25, ipv6), public_ip=COALESCE(?26, public_ip),
                        alert_rules = COALESCE(?27, alert_rules)
                 WHERE id = ?1",
                rusqlite::params![
                    p.id,
                    name,
                    p.region,
                    p.region_name,
                    p.provider,
                    p.billing_price,
                    p.billing_currency,
                    p.billing_cycle,
                    p.renewal_date,
                    p.traffic_limit_gb,
                    p.region_name_en,
                    traffic_type,
                    reset_day,
                    p.monitor_enabled.map(|b| b as i64),
                    monitor_mode,
                    p.monitor_targets,
                    p.route_enabled.map(|b| b as i64),
                    p.alert_enabled.map(|b| b as i64),
                    p.alert_offline.map(|b| b as i64),
                    p.alert_cpu.map(|b| b as i64),
                    p.alert_traffic.map(|b| b as i64),
                    p.tags.trim(),
                    p.billing_currency_code,
                    p.ipv4,
                    p.ipv6,
                    p.public_ip.map(|v|v as i64),
                    p.alert_rules.as_ref().map(|r|serde_json::to_string(r).unwrap()),
                ],
            )
            .unwrap_or(0);
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
            rusqlite::params![format!("编辑节点【{}】配置", name), ip],
        );
        n
    };

    if affected == 0 {
        return Json(serde_json::json!({ "success": false, "message": "节点不存在" }));
    }

    // 在线节点立刻同步内存里的元数据，不用等下一次心跳
    {
        let mut map = ctx.live_servers.lock().unwrap();
        if let Some((item, _)) = map.get_mut(&p.id) {
            if let Some(public) = p.public_ip { item.public_ip = public; }
            if let Some(ip) = &p.ipv4 { item.manual_ipv4 = !ip.is_empty(); item.ipv4 = if ip.is_empty() {item.detected_ipv4.clone()} else {ip.clone()}; }
            if let Some(ip) = &p.ipv6 { item.manual_ipv6 = !ip.is_empty(); item.ipv6 = if ip.is_empty() {item.detected_ipv6.clone()} else {ip.clone()}; }
            item.name = name;
            item.region = p.region;
            item.region_name = p.region_name;
            if let Some(en) = &p.region_name_en {
                item.region_name_en = en.clone();
            }
            item.provider = p.provider;
            item.billing_price = p.billing_price;
            item.billing_currency = p.billing_currency;
            item.billing_cycle = p.billing_cycle;
            item.renewal_date = p.renewal_date;
            item.traffic_limit_gb = p.traffic_limit_gb;
            if let Some(value) = traffic_type { item.traffic_type = value.to_string(); }
            if let Some(value) = reset_day { item.traffic_reset_day = value; }
            if let Some(v) = p.monitor_enabled {
                item.monitor_enabled = v;
            }
            if let Some(value) = monitor_mode { item.monitor_mode = value.to_string(); }
            if let Some(targets) = &p.monitor_targets {
                item.monitor_targets = targets.clone();
            }
            if let Some(v) = &p.route_enabled {
                item.route_enabled = *v;
            }
            if let Some(v) = p.alert_enabled {
                item.alert_enabled = v;
            }
            if let Some(v) = p.alert_offline {
                item.alert_offline = v;
            }
            if let Some(v) = p.alert_cpu {
                item.alert_cpu = v;
            }
            if let Some(v) = p.alert_traffic {
                item.alert_traffic = v;
            }
            if let Some(v)=p.alert_rules {item.alert_rules=v;}
        }
    }

    Json(serde_json::json!({ "success": true }))
}

#[derive(Deserialize)]
struct ResetTokenReq {
    id: String,
}

/// 重置节点令牌。旧令牌立即失效，对应 Agent 会被主控拒绝连接。
async fn api_admin_reset_token(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<ResetTokenReq>,
) -> Json<serde_json::Value> {
    let new_token = auth::generate_node_token();
    let ip = client_ip(&headers, None);

    let affected = {
        let conn = ctx.db.lock().unwrap();
        let n = conn
            .execute(
                "UPDATE servers SET token = ?2 WHERE id = ?1",
                rusqlite::params![p.id, new_token],
            )
            .unwrap_or(0);
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
            rusqlite::params![format!("重置节点【{}】的令牌", p.id), ip],
        );
        n
    };

    if affected == 0 {
        return Json(serde_json::json!({ "success": false, "message": "节点不存在" }));
    }

    // 内存里的 token 同步更新，下一次心跳就会用旧 token 校验失败
    {
        let mut map = ctx.live_servers.lock().unwrap();
        if let Some((item, _)) = map.get_mut(&p.id) {
            item.token = new_token.clone();
        }
    }

    Json(serde_json::json!({ "success": true, "token": new_token }))
}

#[derive(Deserialize)]
struct CalibrateReq {
    id: String,
    /// 管理员填写的"当前已用流量"（GB）
    used_gb: f64,
}

/// 流量校准：把「当前已用」设成指定值，并记录此刻的网卡计数作为基线。
/// 之后的用量 = 校准值 + (当前网卡计数 - 基线计数)。
async fn api_admin_calibrate_traffic(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<CalibrateReq>,
) -> Json<serde_json::Value> {
    if p.used_gb < 0.0 {
        return Json(serde_json::json!({ "success": false, "message": "已用流量不能为负数" }));
    }

    let ip = client_ip(&headers, None);
    if !p.used_gb.is_finite() || p.used_gb > (i64::MAX as f64 / traffic::GIB) {
        return Json(serde_json::json!({"success":false,"message":"流量数值无效"}));
    }
    let counters = ctx.live_servers.lock().unwrap().get(&p.id).filter(|(s,_)|s.status=="online").map(|(s,_)|(s.total_rx_bytes,s.total_tx_bytes));
    let result = (|| -> rusqlite::Result<bool> {
        let mut conn=ctx.db.lock().unwrap();
        let tx=conn.transaction()?;
        let day:i64=match tx.query_row("SELECT traffic_reset_day FROM servers WHERE id=?1",[&p.id],|r|r.get(0)) {
            Ok(day)=>day,Err(rusqlite::Error::QueryReturnedNoRows)=>return Ok(false),Err(e)=>return Err(e)
        };
        traffic::calibrate(&tx,&p.id,p.used_gb,day,counters,now_secs() as i64)?;
        tx.execute("UPDATE servers SET traffic_base_gb=?2,traffic_base_at=?3 WHERE id=?1",rusqlite::params![p.id,p.used_gb,now_secs() as i64])?;
        tx.execute("INSERT INTO audit_logs(action,ip) VALUES(?1,?2)",rusqlite::params![format!("校准节点【{}】流量为 {:.2} GiB",p.id,p.used_gb),ip])?;
        tx.commit()?;
        Ok(true)
    })();
    match result {
        Ok(true)=>{},Ok(false)=>return Json(serde_json::json!({"success":false,"message":"节点不存在"})),
        Err(error)=>return Json(serde_json::json!({"success":false,"message":format!("校准失败: {error}")}))
    }
    if let Some((item,_))=ctx.live_servers.lock().unwrap().get_mut(&p.id) { item.traffic_used_bytes=(p.used_gb*traffic::GIB) as u64; }

    Json(serde_json::json!({ "success": true }))
}

#[derive(Deserialize)]
struct DeleteServerReq {
    id: String,
}

async fn api_admin_delete_server(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<DeleteServerReq>,
) -> Json<serde_json::Value> {
    let ip = client_ip(&headers, None);
    {
        let conn = ctx.db.lock().unwrap();
        let _ = conn.execute("DELETE FROM servers WHERE id = ?1", [&p.id]);
        let _ = conn.execute("DELETE FROM traffic_usage WHERE server_id = ?1", [&p.id]);
        let _ = conn.execute("DELETE FROM metrics WHERE server_id = ?1", [&p.id]);
        let _ = conn.execute("DELETE FROM target_metrics WHERE server_id = ?1", [&p.id]);
        let _ = conn.execute("DELETE FROM metrics_daily WHERE server_id = ?1", [&p.id]);
        let _ = conn.execute(
            "DELETE FROM alert_state WHERE key LIKE ?1",
            [format!("{}:%", p.id)],
        );
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
            rusqlite::params![format!("删除服务器节点【{}】", p.id), ip],
        );
    }
    ctx.live_servers.lock().unwrap().remove(&p.id);

    Json(serde_json::json!({ "success": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> AppContext {
        let db = db::init_db(":memory:").expect("test db");
        let (client_tx, _) = broadcast::channel(2);
        AppContext {
            db: db.clone(),
            history: history::HistoryReader::new(db.clone()),
            agent_connections: Arc::new(Mutex::new(HashMap::new())),
            security: auth::SecurityManager::new(),
            sessions: auth::SessionStore::new(db.clone()),
            live_servers: Arc::new(Mutex::new(HashMap::new())),
            client_tx,
            updates: updates::UpdateChecker::new(false),
        }
    }

    #[test]
    fn site_name_injection_is_safe_in_html_and_inline_script() {
        let html = inject_site_name(
            "<title>__SITE_NAME__</title><body><span data-brand-name>__SITE_NAME__</span></body>",
            "</script><img src=x onerror=alert(1)>",
        );
        assert!(html.contains("&lt;/script&gt;&lt;img"));
        assert!(!html.contains("var n=\"</script>"));
        assert!(!html.contains("<img src=x onerror"));
    }

    #[test]
    fn alert_cooldown_is_persistent_in_sqlite() {
        let ctx = context();
        assert!(should_alert(&ctx, "srv-1:offline", 1800));
        assert!(!should_alert(&ctx, "srv-1:offline", 1800));

        let conn = ctx.db.lock().unwrap();
        let notified: i64 = conn
            .query_row(
                "SELECT last_notified FROM alert_state WHERE key = 'srv-1:offline'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(notified > 0);
    }


    #[test]
    fn heartbeat_and_cpu_thresholds_are_deterministic() {
        assert!(!heartbeat_expired(Duration::from_secs(10)));
        assert!(heartbeat_expired(Duration::from_secs(11)));
        assert_eq!(advance_cpu_streak(0, true), (1, false));
        assert_eq!(advance_cpu_streak(1, true), (2, false));
        assert_eq!(advance_cpu_streak(2, true), (0, true));
        assert_eq!(advance_cpu_streak(2, false), (0, false));
    }

    #[test]
    fn old_metrics_are_removed_after_retention_window() {
        let ctx = context();
        let now = now_secs() as i64;
        let old_ts = now - 40 * 86400;
        let conn = ctx.db.lock().unwrap();
        conn.execute(
            "INSERT INTO metrics (server_id, ts, cpu, latency_ct) VALUES ('srv-archive', ?1, 42, 81)",
            [old_ts],
        )
        .unwrap();

        prune_metric_history(&conn, now - 30 * 86400).unwrap();

        let raw_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM metrics WHERE server_id = 'srv-archive'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(raw_count, 0);
        let daily_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM metrics_daily WHERE server_id = 'srv-archive'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(daily_count, 0);
    }
}

#[derive(Deserialize)]
struct SwitchThemeReq {
    theme_id: String,
}

async fn api_admin_switch_theme(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<SwitchThemeReq>,
) -> Json<serde_json::Value> {
    // theme_id 会被拼进文件路径，必须白名单校验
    if !is_valid_theme_id(&p.theme_id) {
        return Json(serde_json::json!({ "success": false, "message": "非法的主题标识" }));
    }
    if p.theme_id != "default" && !Path::new(&format!("web/themes/{}", p.theme_id)).is_dir() {
        return Json(serde_json::json!({ "success": false, "message": "主题不存在" }));
    }

    let ip = client_ip(&headers, None);
    let conn = ctx.db.lock().unwrap();
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('active_theme', ?1)",
        [&p.theme_id],
    );
    let _ = conn.execute(
        "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
        rusqlite::params![format!("切换激活主题为【{}】", p.theme_id), ip],
    );

    Json(serde_json::json!({ "success": true, "theme_id": p.theme_id }))
}

#[derive(Deserialize)]
struct ChangePasswordReq {
    old_password: String,
    new_password: String,
}

async fn api_admin_change_password(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<ChangePasswordReq>,
) -> Json<serde_json::Value> {
    if p.new_password.chars().count() < 8 {
        return Json(serde_json::json!({ "success": false, "message": "新密码至少 8 位" }));
    }

    let ip = client_ip(&headers, None);
    let current_hash: Option<String> = {
        let conn = ctx.db.lock().unwrap();
        conn.query_row(
            "SELECT password_hash FROM admin WHERE username = 'admin'",
            [],
            |r| r.get(0),
        )
        .ok()
    };

    let ok = current_hash
        .as_ref()
        .map(|h| auth::verify_password(&p.old_password, h))
        .unwrap_or(false);

    if !ok {
        return Json(serde_json::json!({ "success": false, "message": "当前密码错误" }));
    }

    let new_hash = auth::hash_password(&p.new_password);
    {
        let conn = ctx.db.lock().unwrap();
        let _ = conn.execute(
            "UPDATE admin SET password_hash = ?1, updated_at = CURRENT_TIMESTAMP WHERE username = 'admin'",
            [&new_hash],
        );
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES ('管理员修改登录密码', ?1)",
            [&ip],
        );
    }

    // 改完密码踢掉所有会话，强制用新密码重新登录
    ctx.sessions.revoke_all();

    Json(serde_json::json!({ "success": true, "message": "密码已更新，请重新登录" }))
}

#[derive(Serialize)]
struct AuditLogItem {
    id: i64,
    action: String,
    ip: String,
    created_at: String,
}

#[derive(Deserialize)]
struct AuditQuery {limit:Option<i64>,offset:Option<i64>,search:Option<String>}
async fn api_admin_get_audit(State(ctx): State<AppContext>, Query(q):Query<AuditQuery>) -> Json<Vec<AuditLogItem>> {
    let conn = ctx.db.lock().unwrap();
    let mut stmt = match conn
        .prepare("SELECT id, action, ip, created_at FROM audit_logs WHERE (?3='' OR instr(action,?3)>0 OR instr(ip,?3)>0) ORDER BY id DESC LIMIT ?1 OFFSET ?2")
    {
        Ok(s) => s,
        Err(_) => return Json(Vec::new()),
    };

    let logs = stmt
        .query_map(rusqlite::params![q.limit.unwrap_or(50).clamp(1,200),q.offset.unwrap_or(0).max(0),q.search.unwrap_or_default()], |r| {
            Ok(AuditLogItem {
                id: r.get(0)?,
                action: r.get(1)?,
                ip: r.get(2)?,
                created_at: format!("{}Z",r.get::<_,String>(3)?.replace(' ',"T")),
            })
        })
        .map(|iter| iter.flatten().collect())
        .unwrap_or_default();

    Json(logs)
}

// ==========================================================================
// 两步验证（TOTP）
// ==========================================================================
/// RFC4648 base32（无 padding）编码。
///
/// `Secret::generate_secret()` 返回的是 `Secret::Raw`，而它的 `Display`
/// 实现输出的是 **hex** 而不是 base32 —— 直接 `.to_string()` 拿去当 base32
/// 解析会报 ParseBase32。所以这里自己编码，产出验证器 App 认的标准格式。
fn base32_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::new();
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;

    for &byte in data {
        buffer = (buffer << 8) | byte as u32;
        bits += 8;
        while bits >= 5 {
            let idx = ((buffer >> (bits - 5)) & 0x1F) as usize;
            out.push(ALPHABET[idx] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        let idx = ((buffer << (5 - bits)) & 0x1F) as usize;
        out.push(ALPHABET[idx] as char);
    }
    out
}

fn build_totp(secret_b32: &str, account: &str) -> Result<TOTP, String> {
    let bytes = Secret::Encoded(secret_b32.to_string())
        .to_bytes()
        .map_err(|e| format!("密钥格式无效: {:?}", e))?;

    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        bytes,
        Some("Moniter".to_string()),
        account.to_string(),
    )
    .map_err(|e| format!("初始化失败: {:?}", e))
}

#[derive(Serialize)]
struct TwoFactorStatus {
    enabled: bool,
}

async fn api_admin_2fa_status(State(ctx): State<AppContext>) -> Json<TwoFactorStatus> {
    let conn = ctx.db.lock().unwrap();
    let enabled: i64 = conn
        .query_row(
            "SELECT totp_enabled FROM admin WHERE username = 'admin'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Json(TwoFactorStatus {
        enabled: enabled != 0,
    })
}

/// 生成新的 TOTP 密钥并返回二维码。
///
/// 密钥此时**不落库** —— 必须等用户用验证器扫完、回填一次正确的 6 位码，
/// 才会在 enable 接口里写进去。否则扫歪了会把自己锁在门外。
async fn api_admin_2fa_setup(State(ctx): State<AppContext>) -> Json<serde_json::Value> {
    let enabled: i64 = {
        let conn = ctx.db.lock().unwrap();
        conn.query_row(
            "SELECT totp_enabled FROM admin WHERE username = 'admin'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    if enabled != 0 {
        return Json(
            serde_json::json!({ "success": false, "message": "两步验证已启用，请先关闭" }),
        );
    }

    let raw_secret = Secret::generate_secret();
    let secret = match raw_secret.to_bytes() {
        Ok(bytes) => base32_encode(&bytes),
        Err(e) => {
            return Json(
                serde_json::json!({ "success": false, "message": format!("生成密钥失败: {:?}", e) }),
            )
        }
    };

    let totp = match build_totp(&secret, "admin") {
        Ok(t) => t,
        Err(e) => return Json(serde_json::json!({ "success": false, "message": e })),
    };

    let url = totp.get_url();
    let qr_svg = match qrcode::QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<qrcode::render::svg::Color>()
            .min_dimensions(190, 190)
            .dark_color(qrcode::render::svg::Color("#111111"))
            .light_color(qrcode::render::svg::Color("#ffffff"))
            .build(),
        Err(e) => {
            return Json(
                serde_json::json!({ "success": false, "message": format!("生成二维码失败: {}", e) }),
            )
        }
    };

    Json(serde_json::json!({
        "success": true,
        "secret": secret,
        "url": url,
        "qr_svg": qr_svg,
    }))
}

#[derive(Deserialize)]
struct Enable2FAReq {
    secret: String,
    code: String,
}

async fn api_admin_2fa_enable(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<Enable2FAReq>,
) -> Json<serde_json::Value> {
    let totp = match build_totp(&p.secret, "admin") {
        Ok(t) => t,
        Err(e) => return Json(serde_json::json!({ "success": false, "message": e })),
    };

    // check_current() 用当前时间校验；容差 ±1 个时间步是在 build_totp 里
    // 通过 skew 参数指定的，这里不要重复传时间戳。
    let valid = totp.check_current(p.code.trim()).unwrap_or(false);
    if !valid {
        return Json(
            serde_json::json!({ "success": false, "message": "验证码不正确，请确认手机时间是否准确" }),
        );
    }

    let ip = client_ip(&headers, None);
    {
        let conn = ctx.db.lock().unwrap();
        let _ = conn.execute(
            "UPDATE admin SET totp_secret = ?1, totp_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE username = 'admin'",
            [&p.secret],
        );
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES ('启用两步验证 (2FA)', ?1)",
            [&ip],
        );
    }

    Json(serde_json::json!({ "success": true, "message": "两步验证已启用" }))
}

#[derive(Deserialize)]
struct Disable2FAReq {
    password: String,
}

async fn api_admin_2fa_disable(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<Disable2FAReq>,
) -> Json<serde_json::Value> {
    let hash: Option<String> = {
        let conn = ctx.db.lock().unwrap();
        conn.query_row(
            "SELECT password_hash FROM admin WHERE username = 'admin'",
            [],
            |r| r.get(0),
        )
        .ok()
    };

    let ok = hash
        .as_ref()
        .map(|h| auth::verify_password(&p.password, h))
        .unwrap_or(false);

    if !ok {
        return Json(serde_json::json!({ "success": false, "message": "密码错误" }));
    }

    let ip = client_ip(&headers, None);
    {
        let conn = ctx.db.lock().unwrap();
        let _ = conn.execute(
            "UPDATE admin SET totp_secret = '', totp_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE username = 'admin'",
            [],
        );
        let _ = conn.execute(
            "INSERT INTO audit_logs (action, ip) VALUES ('关闭两步验证 (2FA)', ?1)",
            [&ip],
        );
    }

    Json(serde_json::json!({ "success": true, "message": "两步验证已关闭" }))
}

// ==========================================================================
// 监控目标管理（延迟探测用的 IP 列表）
// ==========================================================================
async fn api_admin_get_targets(State(ctx): State<AppContext>) -> Json<Vec<MonitorTarget>> {
    Json(list_targets(&ctx, false))
}

/// 主机名 / IP 白名单校验。参数化查询已经防注入，这里主要是拦住明显乱填的值，
/// 避免 Agent 拿到一个畸形地址后一直探测失败。
fn is_valid_host(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && h.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':' || c == '_')
        && !h.starts_with('-')
        && !h.starts_with('.')
}

#[derive(Deserialize)]
struct SaveTargetReq {
    /// None 表示新建，Some(id) 表示编辑
    id: Option<i64>,
    name: String,
    host: String,
    port: i64,
    carrier: String,
    region: String,
    enabled: bool,
}

async fn api_admin_save_target(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<SaveTargetReq>,
) -> Json<serde_json::Value> {
    let name = p.name.trim().to_string();
    let host = p.host.trim().to_string();

    if name.is_empty() || name.chars().count() > 64 {
        return Json(
            serde_json::json!({ "success": false, "message": "名称不能为空且不超过 64 字符" }),
        );
    }
    if !is_valid_host(&host) {
        return Json(serde_json::json!({ "success": false, "message": "IP / 域名格式不正确" }));
    }
    if !(1..=65535).contains(&p.port) {
        return Json(serde_json::json!({ "success": false, "message": "端口必须在 1-65535 之间" }));
    }

    let carrier = match p.carrier.as_str() {
        "ct" | "cu" | "cm" | "intl" => p.carrier.clone(),
        _ => String::new(),
    };
    let region = p.region.trim().to_string();
    let ip = client_ip(&headers, None);

    let conn = ctx.db.lock().unwrap();
    let result = match p.id {
        Some(id) => conn
            .execute(
                "UPDATE monitor_targets SET name = ?2, host = ?3, port = ?4, carrier = ?5,
                        region = ?6, enabled = ?7 WHERE id = ?1",
                rusqlite::params![id, name, host, p.port, carrier, region, p.enabled as i64],
            )
            .map(|n| n > 0),
        None => conn
            .execute(
                "INSERT INTO monitor_targets (name, host, port, carrier, region, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![name, host, p.port, carrier, region, p.enabled as i64],
            )
            .map(|_| true),
    };

    match result {
        Ok(true) => {
            let action = if p.id.is_some() {
                format!("编辑监控目标【{}】{}", name, host)
            } else {
                format!("新增监控目标【{}】{}", name, host)
            };
            let _ = conn.execute(
                "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
                rusqlite::params![action, ip],
            );
            Json(serde_json::json!({ "success": true }))
        }
        Ok(false) => Json(serde_json::json!({ "success": false, "message": "目标不存在" })),
        Err(e) => {
            Json(serde_json::json!({ "success": false, "message": format!("保存失败: {}", e) }))
        }
    }
}

#[derive(Deserialize)]
struct DeleteTargetReq {
    id: i64,
}

async fn api_admin_delete_target(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<DeleteTargetReq>,
) -> Json<serde_json::Value> {
    let ip = client_ip(&headers, None);
    let result=(|| -> rusqlite::Result<usize> {
        let mut c=ctx.db.lock().unwrap();let tx=c.transaction()?;
        tx.execute("DELETE FROM monitor_targets WHERE id=?1",[p.id])?;
        let paused=targets::reconcile(&tx,&HashMap::new())?;
        tx.execute("INSERT INTO audit_logs(action,ip) VALUES(?1,?2)",rusqlite::params![format!("删除监控目标 #{}；暂停 {} 个无目标节点的探测",p.id,paused),ip])?;
        tx.commit()?;Ok(paused)
    })();
    match result {Ok(paused)=>Json(serde_json::json!({"success":true,"paused_nodes":paused})),Err(error)=>Json(serde_json::json!({"success":false,"message":error.to_string()}))}
}

async fn api_admin_reset_targets(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
) -> Json<serde_json::Value> {
    let ip = client_ip(&headers, None);
    let mut conn = ctx.db.lock().unwrap();
    match targets::reset(&mut conn) {
        Ok(paused)=>{
            let _=conn.execute("INSERT INTO audit_logs(action,ip) VALUES(?1,?2)",rusqlite::params![format!("恢复默认监控目标（93 项）；暂停 {paused} 个无目标节点的探测"),ip]);
            Json(serde_json::json!({"success":true,"count":93,"paused_nodes":paused}))
        },
        Err(error)=>Json(serde_json::json!({"success":false,"message":error.to_string()}))
    }
}
