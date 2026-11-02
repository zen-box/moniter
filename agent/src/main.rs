mod ping;
mod route;
mod sys;
#[cfg(test)]
mod tls_tests;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Serialize)]
struct AgentHeartbeat {
    token: String,
    agent_version: String,
    stats: sys::SystemStats,
    latency: ping::LatencyResult,
    latency_source: &'static str,
    routes: route::RouteDiagnosis,
    /// 自定义监控目标的探测结果
    targets: Vec<TargetResult>,
}

/// 主控下发的监控目标（管理员在后台配置的 IP 列表）
#[derive(Debug, Clone, Deserialize)]
struct TargetSpec {
    id: i64,
    host: String,
    port: u16,
    #[serde(default, rename = "name")]
    _name: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ProbeConfig {
    #[serde(default)]
    targets: Vec<TargetSpec>,
    #[serde(default)]
    route_enabled: bool,
    #[serde(default)]
    latency_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
struct TargetResult {
    id: i64,
    /// 999 表示超时
    ms: u32,
}

fn insecure_remote_ws(server_url: &str) -> bool {
    let Some(authority) = server_url.strip_prefix("ws://") else {
        return false;
    };
    let authority = authority.split('/').next().unwrap_or_default();
    let host = if authority.starts_with('[') {
        authority
            .split(']')
            .next()
            .unwrap_or_default()
            .trim_start_matches('[')
    } else {
        authority.split(':').next().unwrap_or_default()
    };
    !matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn reconnect_backoff(current: Duration, connected_for: Duration) -> (Duration, Duration) {
    if connected_for >= Duration::from_secs(30) {
        (Duration::from_secs(5), Duration::from_secs(5))
    } else {
        (current, (current * 2).min(Duration::from_secs(60)))
    }
}

/// TCP 握手测延迟。host 支持域名（由 tokio 内部解析）。
async fn measure_target_tcp(host: &str, port: u16) -> u32 {
    let addr = if host.contains(':') {format!("[{}]:{}",host,port)} else {format!("{}:{}",host,port)};
    let start = std::time::Instant::now();
    match tokio::time::timeout(
        Duration::from_millis(2000),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_)) => start.elapsed().as_millis().clamp(1,998) as u32,
        _ => 999,
    }
}

/// 并发探测所有目标，任何一个卡住都不会拖累其他
async fn probe_all(targets: Vec<TargetSpec>) -> Vec<TargetResult> {
    let futures = targets.into_iter().map(|t| async move {
        let ms = measure_target_tcp(&t.host, t.port).await;
        TargetResult { id: t.id, ms }
    });
    futures_util::future::join_all(futures).await
}

fn init_tls_provider() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to initialize the TLS crypto provider");
}

#[tokio::main]
async fn main() {
    init_tls_provider();
    println!("🦀 Moniter Agent 启动中...");

    let args: Vec<String> = env::args().collect();
    let mut server_url = "ws://127.0.0.1:8080/ws/agent".to_string();
    let mut token = env::var("AEGIS_AGENT_TOKEN").unwrap_or_default();
    let mut token_file = env::var("AEGIS_AGENT_TOKEN_FILE").ok();
    let mut allow_insecure = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--server" | "-s" => {
                if i + 1 < args.len() {
                    server_url = args[i + 1].clone();
                    i += 1;
                }
            }
            "--token" | "-t" => {
                if i + 1 < args.len() {
                    token = args[i + 1].clone();
                    i += 1;
                }
            }
            "--token-file" => {
                if i + 1 < args.len() {
                    token_file = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--allow-insecure" => allow_insecure = true,
            _ => {}
        }
        i += 1;
    }

    if !server_url.starts_with("ws://") && !server_url.starts_with("wss://") {
        eprintln!("❌ Agent 地址必须以 ws:// 或 wss:// 开头。");
        std::process::exit(2);
    }

    if let Some(path) = token_file {
        match std::fs::read_to_string(&path) {
            Ok(contents) => token = contents.trim().to_string(),
            Err(error) => {
                eprintln!("❌ 无法读取 Agent Token 文件 {}: {}", path, error);
                std::process::exit(2);
            }
        }
    }
    if token.is_empty() {
        eprintln!(
            "❌ 缺少 Agent Token，请使用 --token、--token-file 或 AEGIS_AGENT_TOKEN_FILE 配置。"
        );
        std::process::exit(2);
    }

    println!("🎯 目标主控: {}", server_url);
    if insecure_remote_ws(&server_url) && !allow_insecure {
        eprintln!("❌ 远程主控必须使用 wss:// 加密连接；如确需明文内网连接，请显式传入 --allow-insecure。");
        std::process::exit(2);
    }
    // 只取前 4 个字符打日志。按字节切片会在多字节 token 上 panic，
    // 用 chars() 才是按字符切。
    let token_preview: String = token.chars().take(4).collect();
    println!("🔑 节点令牌: {}***", token_preview);

    let mut collector = sys::Collector::new();

    // 回程诊断要跑 traceroute，单次最多几十秒，绝不能卡在心跳主循环里 ——
    // 服务端 10 秒收不到心跳就判离线了。所以丢到后台任务，结果通过 channel 回传。
    let (route_tx, mut route_rx) = tokio::sync::mpsc::channel(1);
    let (route_enabled_tx, route_enabled_rx) = tokio::sync::watch::channel(false);
    tokio::spawn(async move {
        let mut enabled = route_enabled_rx;
        loop {
            if !*enabled.borrow() {
                if enabled.changed().await.is_err() {
                    break;
                }
                continue;
            }

            let diagnosis = tokio::select! {
                result = route::diagnose_routes() => result,
                changed = enabled.changed() => {
                    if changed.is_err() { break; }
                    continue;
                }
            };
            if route_tx.send(diagnosis).await.is_err() {
                break;
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(6 * 3600)) => {},
                changed = enabled.changed() => if changed.is_err() { break; },
            }
        }
    });

    // 首帧先上报"未识别"，探测结果回来后自动替换
    let mut current_routes = route::RouteDiagnosis::pending();

    // 延迟探测默认关闭，等主控下发节点配置后再决定是否运行。
    let mut latency_enabled = false;
    let mut current_latency = ping::LatencyResult::default();
    let mut last_ping_check = tokio::time::Instant::now();

    // 自定义监控目标：主控通过 WS 下发，本地缓存后定期探测。
    // 用 Arc<Mutex> 是因为 select! 的两个分支都要访问它。
    let targets_shared: Arc<Mutex<Vec<TargetSpec>>> = Arc::new(Mutex::new(Vec::new()));
    let mut target_results: Vec<TargetResult> = Vec::new();
    let mut last_target_fetch = tokio::time::Instant::now() - Duration::from_secs(3600);
    let mut last_target_probe = tokio::time::Instant::now() - Duration::from_secs(3600);
    let mut reconnect_delay = Duration::from_secs(5);

    // 永不退出的自动重连主循环
    loop {
        println!("📡 正在连接主控端...");
        let connected_at = tokio::time::Instant::now();
        match connect_async(&server_url).await {
            Ok((ws_stream, _)) => {
                println!("✅ 成功连接主控！开始实时毫秒级心跳同步...");
                let (mut write, mut read) = ws_stream.split();
                let auth = serde_json::json!({"token": token}).to_string();
                if write.send(Message::Text(auth)).await.is_err() {
                    println!("⚠️ 发送认证信息失败，准备重新连接...");
                    tokio::time::sleep(reconnect_delay).await;
                    continue;
                }

                let mut interval = tokio::time::interval(Duration::from_millis(1000));

                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            // 定时更新三网 Ping (每 30 秒跑一次)
                            if latency_enabled && last_ping_check.elapsed() >= Duration::from_secs(30) {
                                current_latency = ping::run_ping_cycle().await;
                                last_ping_check = tokio::time::Instant::now();
                            }

                            // 后台探测任务有新结果就换掉，不阻塞心跳
                            if let Ok(latest) = route_rx.try_recv() {
                                println!("🛣️ 回程诊断已更新: CT={} CU={} CM={}",
                                    latest.ct.line, latest.cu.line, latest.cm.line);
                                current_routes = latest;
                            }

                            // 每 5 分钟向主控要一次目标列表（后台可能刚改过配置）
                            if last_target_fetch.elapsed() > Duration::from_secs(30) {
                                let req = serde_json::json!({"type": "get_targets"}).to_string();
                                if write.send(Message::Text(req)).await.is_err() {
                                    break;
                                }
                                last_target_fetch = tokio::time::Instant::now();
                            }

                            // 每 30 秒重新探测一轮自定义目标
                            if last_target_probe.elapsed() > Duration::from_secs(30) {
                                let snapshot: Vec<TargetSpec> = {
                                    targets_shared.lock().unwrap().clone()
                                };
                                if !snapshot.is_empty() {
                                    target_results = probe_all(snapshot).await;
                                }
                                last_target_probe = tokio::time::Instant::now();
                            }

                            // 采集硬件指标
                            let stats = collector.collect();
                            let heartbeat = AgentHeartbeat {
                                token: token.clone(),
                                agent_version: env!("CARGO_PKG_VERSION").to_string(),
                                stats,
                                latency: current_latency.clone(),
                                latency_source: "sh-zstatic-tcp80-v1",
                                routes: current_routes.clone(),
                                targets: target_results.clone(),
                            };

                            if let Ok(json_text) = serde_json::to_string(&heartbeat) {
                                if write.send(Message::Text(json_text)).await.is_err() {
                                    println!("⚠️ 发送心跳失败，准备重新连接...");
                                    break;
                                }
                            }
                        }
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Close(_))) | None => {
                                    println!("🔌 主控端断开连接");
                                    break;
                                }
                                Some(Ok(Message::Ping(p))) => {
                                    let _ = write.send(Message::Pong(p)).await;
                                }
                                Some(Ok(Message::Text(t))) => {
                                    // 服务端在令牌校验失败时会先回一条错误再关连接。
                                    // 令牌错了重试多少次都没用，直接退出让运维看到。
                                    if t.contains("invalid_token") {
                                        eprintln!("❌ 令牌无效，主控拒绝了连接。");
                                        eprintln!("   请到管理后台确认该节点的令牌，或重新生成安装命令。");
                                        std::process::exit(1);
                                    }

                                    // 主控下发的监控目标列表
                                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                                        let kind = v.get("type").and_then(|x| x.as_str());
                                        if kind == Some("probe_config") || kind == Some("targets") {
                                            let parsed_config = if kind == Some("probe_config") {
                                                serde_json::from_value::<ProbeConfig>(v.clone()).map(|c| (c.targets, c.route_enabled, c.latency_enabled))
                                            } else {
                                                serde_json::from_value::<Vec<TargetSpec>>(v.get("list").cloned().unwrap_or_default())
                                                    .map(|targets| (
                                                        targets,
                                                        v.get("route_enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                                                        v.get("latency_enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                                                    ))
                                            };
                                            match parsed_config {
                                                Ok((parsed, route_enabled, next_latency_enabled)) => {
                                                    let n = parsed.len();
                                                    *targets_shared.lock().unwrap() = parsed;
                                                    route_enabled_tx.send_replace(route_enabled);
                                                    if next_latency_enabled != latency_enabled {
                                                        latency_enabled = next_latency_enabled;
                                                        current_latency = ping::LatencyResult::default();
                                                        last_ping_check = tokio::time::Instant::now() - Duration::from_secs(30);
                                                    }
                                                    println!("🎯 收到探针配置：延迟监控{}、{} 个自定义目标，回程诊断{}", if latency_enabled { "开启" } else { "关闭" }, n, if route_enabled { "开启" } else { "关闭" });
                                                    last_target_probe = tokio::time::Instant::now() - Duration::from_secs(3600);
                                                }
                                                Err(e) => eprintln!("⚠️ 探针配置解析失败: {}", e),
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            Err(e) => {
                println!(
                    "❌ 连接主控失败: {}，{:?} 后自动重试...",
                    e, reconnect_delay
                );
            }
        }

        let (wait, next_delay) = reconnect_backoff(reconnect_delay, connected_at.elapsed());
        tokio::time::sleep(wait).await;
        reconnect_delay = next_delay;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latency_probe_is_off_by_default_until_configured() {
        let config = ProbeConfig::default();
        assert!(!config.latency_enabled);
        assert!(!config.route_enabled);
        assert!(config.targets.is_empty());
    }

    #[test]
    fn legacy_targets_message_keeps_compatibility_defaults() {
        let value = serde_json::json!({"type": "targets", "list": []});
        let latency = value
            .get("latency_enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        assert!(latency);
    }

    #[test]
    fn plaintext_ws_is_only_allowed_for_loopback_by_default() {
        assert!(!insecure_remote_ws("ws://localhost:8080/ws/agent"));
        assert!(!insecure_remote_ws("ws://127.0.0.1:8080/ws/agent"));
        assert!(!insecure_remote_ws("ws://[::1]:8080/ws/agent"));
        assert!(insecure_remote_ws("ws://monitor.example.com/ws/agent"));
        assert!(!insecure_remote_ws("wss://monitor.example.com/ws/agent"));
    }

    #[test]
    fn reconnect_backoff_waits_after_drop_and_caps_repeated_failures() {
        assert_eq!(
            reconnect_backoff(Duration::from_secs(20), Duration::from_secs(31)),
            (Duration::from_secs(5), Duration::from_secs(5))
        );
        assert_eq!(
            reconnect_backoff(Duration::from_secs(20), Duration::from_secs(4)),
            (Duration::from_secs(20), Duration::from_secs(40))
        );
        assert_eq!(
            reconnect_backoff(Duration::from_secs(60), Duration::from_secs(2)),
            (Duration::from_secs(60), Duration::from_secs(60))
        );
    }
}
