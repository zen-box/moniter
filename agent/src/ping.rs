use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;

#[derive(Debug, Clone, Serialize, Default)]
pub struct LatencyResult {
    pub ct_ms: u32,   // 中国电信
    pub cu_ms: u32,   // 中国联通
    pub cm_ms: u32,   // 中国移动
    pub intl_ms: u32, // 国际/香港基准
}

// Operator-specific provincial endpoints supplied with the default targets.
const CT_TARGETS: &[&str] = &["sh-ct-v4.ip.zstaticcdn.com:80"];
const CU_TARGETS: &[&str] = &["sh-cu-v4.ip.zstaticcdn.com:80"];
const CM_TARGETS: &[&str] = &["sh-cm-v4.ip.zstaticcdn.com:80"];
const INTL_TARGETS: &[&str] = &["1.1.1.1:443"];

pub async fn measure_target(target: &str) -> u32 {
    let addresses = match tokio::time::timeout(Duration::from_millis(1500), tokio::net::lookup_host(target)).await {
        Ok(Ok(addresses)) => addresses.collect::<Vec<_>>(),
        _ => return 999,
    };

    let start = Instant::now();
    match tokio::time::timeout(Duration::from_millis(999), TcpStream::connect(addresses.as_slice())).await {
        Ok(Ok(_)) => u32::try_from(start.elapsed().as_millis()).unwrap_or(999).max(1).min(999),
        _ => 999, // 超时或无法连接
    }
}

/// 并发探测一组目标，取最快的一个；全都不通才返回 999。
async fn measure_any(targets: &[&str]) -> u32 {
    let futures = targets.iter().map(|t| measure_target(t));
    let results = futures_util::future::join_all(futures).await;
    results
        .into_iter()
        .filter(|v| *v < 999)
        .min()
        .unwrap_or(999)
}

pub async fn run_ping_cycle() -> LatencyResult {
    // 四个方向并发测试，每个方向内部再并发试多个目标
    let (ct, cu, cm, intl) = tokio::join!(
        measure_any(CT_TARGETS),
        measure_any(CU_TARGETS),
        measure_any(CM_TARGETS),
        measure_any(INTL_TARGETS),
    );

    LatencyResult {
        ct_ms: ct,
        cu_ms: cu,
        cm_ms: cm,
        intl_ms: intl,
    }
}
