use serde::Serialize;
use tokio::process::Command;
use std::time::Duration;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize)]
pub struct RouteInfo {
    pub name: String,
    pub line: String,
    pub as_num: String,
    pub status: String, // optimal, good, normal, warning, unknown
}

#[derive(Debug, Clone, Serialize)]
pub struct RouteDiagnosis {
    pub ct: RouteInfo,
    pub cu: RouteInfo,
    pub cm: RouteInfo,
}

impl RouteInfo {
    /// 探测失败或认不出线路时的结果。
    ///
    /// 以前这里填的是 "AS4837 直连优化" / "CMI 优质直连" 这类看起来很好的结论，
    /// 但其实根本没测过 —— 等于给用户编了一个好线路。现在如实写"未识别"。
    fn unknown(name: &str) -> Self {
        Self {
            name: name.to_string(),
            line: "未识别".to_string(),
            as_num: "—".to_string(),
            status: "unknown".to_string(),
        }
    }
}

impl RouteDiagnosis {
    /// 还没探测完时的占位值，避免首帧心跳把"未识别"写成好线路
    pub fn pending() -> Self {
        Self {
            ct: RouteInfo::unknown("中国电信"),
            cu: RouteInfo::unknown("中国联通"),
            cm: RouteInfo::unknown("中国移动"),
        }
    }
}

/// 三家运营商各取一个骨干网内可达的探测目标（与 ping.rs 保持一致）
const CT_TARGET: &str = "202.96.128.86"; // 上海电信 DNS
const CU_TARGET: &str = "210.22.84.3"; // 上海联通 DNS
const CM_TARGET: &str = "211.136.192.6"; // 上海移动 DNS

/// 单次 traceroute 的整体超时。15 跳 × 0.8s 留足余量。
const TRACE_TIMEOUT: Duration = Duration::from_secs(25);

async fn run_traceroute(target: &str) -> String {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("tracert");
        // -d 不反解域名，-h 最大跳数，-w 每跳超时(ms)
        c.args(["-d", "-h", "15", "-w", "800", target]);
        c
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("traceroute");
        // -n 不反解域名，-m 最大跳数，-q 每跳探测次数，-w 超时(秒)
        c.args(["-n", "-m", "15", "-q", "1", "-w", "1", target]);
        c
    };

    cmd.kill_on_drop(true);
    match cmd.output().await {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        // traceroute 未安装、权限不足等情况，返回空串走"未识别"分支
        Err(_) => String::new(),
    }
}

async fn trace(target: &str) -> String {
    let output = timeout(TRACE_TIMEOUT, run_traceroute(target)).await.unwrap_or_default();
    // Headers echo the destination too. Only numbered hop lines contribute evidence.
    intermediate_hops(&output, target)
}

fn intermediate_hops(output: &str, target: &str) -> String {
    output.lines().filter(|line|line.split_whitespace().next().and_then(|s|s.parse::<u32>().ok()).is_some())
        .flat_map(|line|line.split_whitespace())
        .map(|part|part.trim_matches(|c:char|c=='('||c==')'||c=='['||c==']'))
        .filter(|part|*part!=target && part.parse::<std::net::IpAddr>().is_ok())
        .collect::<Vec<_>>().join(" ")
}

/// 按经过的骨干网 IP 段判断线路类型。
/// 判据取自三家实际使用的骨干网地址段，识别不到就返回 None。
fn has_prefix(out: &str, prefix: [u8; 2]) -> bool {
    out.split_whitespace()
        .filter_map(|hop| hop.parse::<std::net::Ipv4Addr>().ok())
        .any(|ip| ip.octets()[..2] == prefix)
}

fn classify_ct(out: &str) -> Option<RouteInfo> {
    if has_prefix(out, [59, 43]) {
        return Some(RouteInfo {
            name: "中国电信".into(),
            line: if has_prefix(out, [202, 97]) {"CN2 / 163 混合"} else {"CN2 骨干"}.into(),
            as_num: "AS4809".into(),
            status: "good".into(),
        });
    }
    if has_prefix(out, [202, 97]) {
        return Some(RouteInfo {
            name: "中国电信".into(),
            line: "163 骨干".into(),
            as_num: "AS4134".into(),
            status: "normal".into(),
        });
    }
    None
}

fn classify_cu(out: &str) -> Option<RouteInfo> {
    if has_prefix(out, [218, 105]) {
        return Some(RouteInfo {
            name: "中国联通".into(),
            line: "AS9929 精品网".into(),
            as_num: "AS9929".into(),
            status: "optimal".into(),
        });
    }
    if has_prefix(out, [219, 158]) {
        return Some(RouteInfo {
            name: "中国联通".into(),
            line: "联通 169 骨干".into(),
            as_num: "AS4837".into(),
            status: "good".into(),
        });
    }
    None
}

fn classify_cm(out: &str) -> Option<RouteInfo> {
    if has_prefix(out, [223, 120]) {
        return Some(RouteInfo {name:"中国移动".into(),line:"CMI 骨干".into(),as_num:"AS58453".into(),status:"good".into()});
    }
    if has_prefix(out, [221, 183]) {
        return Some(RouteInfo {name:"中国移动".into(),line:"移动国内骨干".into(),as_num:"AS9808".into(),status:"normal".into()});
    }
    None
}

pub async fn diagnose_routes() -> RouteDiagnosis {
    // 三家并发探测，任何一家卡住都不会拖累另外两家
    let (ct_out, cu_out, cm_out) =
        tokio::join!(trace(CT_TARGET), trace(CU_TARGET), trace(CM_TARGET),);

    RouteDiagnosis {
        ct: classify_ct(&ct_out).unwrap_or_else(|| RouteInfo::unknown("中国电信")),
        cu: classify_cu(&cu_out).unwrap_or_else(|| RouteInfo::unknown("中国联通")),
        cm: classify_cm(&cm_out).unwrap_or_else(|| RouteInfo::unknown("中国移动")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destination_echo_does_not_prove_a_route() {
        let hops=intermediate_hops("traceroute to 211.136.192.6\n 1 10.0.0.1 1 ms\n 2 211.136.192.6 10 ms",CM_TARGET);
        assert_eq!(hops,"10.0.0.1");assert!(classify_cm(&hops).is_none());
        assert_eq!(RouteInfo::unknown("移动").status,"unknown");
    }
    #[test]
    fn cn2_evidence_does_not_claim_gia_and_mobile_asn_is_correct() {
        assert!(!classify_ct("59.43.1.1 202.97.1.1").unwrap().line.contains("GIA"));
        assert_eq!(classify_cm("223.120.1.1").unwrap().as_num,"AS58453");
        assert!(classify_cm("211.136.192.6").is_none());
    }

    #[test]
    fn classification_requires_complete_valid_addresses() {
        for hop in ["10.59.43.1", "159.43.1.1", "59.43.999.1", "59.43.", "host-59.43.1.1"] {
            assert!(classify_ct(hop).is_none(), "false CN2 evidence: {hop}");
        }
        for hop in ["1218.105.1.1", "10.218.105.1", "219.158.999.1"] {
            assert!(classify_cu(hop).is_none(), "false Unicom evidence: {hop}");
        }
        for hop in ["1223.120.1.1", "10.223.120.1", "221.183.999.1"] {
            assert!(classify_cm(hop).is_none(), "false Mobile evidence: {hop}");
        }
        assert_eq!(classify_ct("10.59.43.1 202.97.1.1").unwrap().as_num, "AS4134");
        assert_eq!(classify_ct("59.43.0.0 59.43.255.255").unwrap().as_num, "AS4809");
        assert_eq!(classify_cu("218.105.1.1 219.158.1.1").unwrap().as_num, "AS9929");
        assert_eq!(classify_cm("221.183.1.1").unwrap().as_num, "AS9808");
    }
}
