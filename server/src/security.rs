use axum::{
    extract::{ConnectInfo, Request},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

pub fn trusted_proxy(peer: IpAddr) -> bool {
    let enabled = std::env::var("AEGIS_TRUST_PROXY")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
    if !enabled { return false; }
    let networks = std::env::var("AEGIS_TRUSTED_PROXIES")
        .unwrap_or_else(|_| "127.0.0.0/8,::1/128".into());
    networks.split(',').filter_map(|network| network.trim().parse::<ipnet::IpNet>().ok())
        .any(|network| network.contains(&peer))
}

pub fn source_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> String {
    source_ip_with_trust(headers, peer, trusted_proxy)
}

fn source_ip_with_trust(headers: &HeaderMap, peer: Option<SocketAddr>, trusted: impl Fn(IpAddr) -> bool) -> String {
    let Some(peer) = peer else { return "unknown".into(); };
    if trusted(peer.ip()) {
        // Walk from the connection toward the client, stopping at the first
        // untrusted hop. An attacker-supplied leftmost XFF value is not trusted.
        if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            let mut current = peer.ip();
            for hop in value.rsplit(',').take(32) {
                if !trusted(current) { break; }
                match hop.trim().parse::<IpAddr>() {
                    Ok(ip) => current = ip,
                    Err(_) => return peer.ip().to_string(),
                }
            }
            return current.to_string();
        }
        if let Some(ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<IpAddr>().ok()) {
            return ip.to_string();
        }
    }
    peer.ip().to_string()
}

fn public_read_path(path: &str) -> bool {
    matches!(path, "/api/v1/servers" | "/api/v1/site-settings" | "/api/v1/targets" | "/api/v1/themes" | "/api/v1/ping"
        | "/world-map-paths.svg")
        || path.starts_with("/api/v1/metrics/") || path.starts_with("/api/v1/target_metrics/")
        || path.starts_with("/themes/") || path.starts_with("/assets/") || path.starts_with("/ui-assets/")
}

fn fingerprinted_asset(filename: &str) -> bool {
    let Some(stem) = filename.strip_suffix(".js").or_else(|| filename.strip_suffix(".css")) else {
        return false;
    };
    // Vite's default eight-character hash can itself contain '-' and '_'.
    let bytes = stem.as_bytes();
    bytes.len() > 9 && bytes[bytes.len() - 9] == b'-'
        && bytes[bytes.len() - 8..].iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
}

pub async fn harden_request(mut request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let public_read = public_read_path(&path);
    let peer = request.extensions().get::<ConnectInfo<SocketAddr>>().map(|value| value.0);
    let ip = source_ip(request.headers(), peer);
    // Internal, overwritten on EVERY request; handlers without ConnectInfo use it for audit logs.
    request.headers_mut().remove("x-moniter-client-ip");
    if let Ok(value) = HeaderValue::from_str(&ip) {
        request.headers_mut().insert("x-moniter-client-ip", value);
    }
    if !peer.is_some_and(|addr| trusted_proxy(addr.ip())) {
        request.headers_mut().remove("x-forwarded-proto");
    }
    let is_admin = path == "/admin" || path.starts_with("/admin/") || path.starts_with("/api/v1/admin/");
    // Sandboxed themes have an opaque Origin. They may read public data only,
    // including when a future authentication transport is added.
    if is_admin && request.headers().get(header::ORIGIN).is_some_and(|origin| origin == "null") {
        return (StatusCode::FORBIDDEN, "Themes cannot access administration").into_response();
    }
    let mut response = if public_read && request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else { next.run(request).await };
    let success = response.status().is_success();
    let headers = response.headers_mut();
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert("permissions-policy", HeaderValue::from_static("camera=(), microphone=(), geolocation=()"));
    if is_admin || path.starts_with("/install.") {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    if path.starts_with("/api/") {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    if path.starts_with("/ui-assets/") && success {
        let filename = path.rsplit('/').next().unwrap_or_default();
        if fingerprinted_asset(filename) {
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
        }
    }
    if path.starts_with("/themes/") {
        // Applies to directly opened HTML/SVG too: an unselected installed theme
        // must never regain same-origin privileges by bypassing the wrapper.
        headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("sandbox allow-scripts allow-downloads; frame-ancestors 'self'; object-src 'none'"));
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    } else {
        headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
        headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("frame-ancestors 'none'; object-src 'none'; base-uri 'self'"));
    }
    if public_read {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
        headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, HEAD, OPTIONS"));
        headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Content-Type, Authorization"));
    }
    response
}

pub fn public_base_url(headers: &HeaderMap, install_origin: Option<&str>) -> Result<String, &'static str> {
    let origin = if let Ok(configured) = std::env::var("AEGIS_PUBLIC_URL") {
        configured
    } else if let Some(origin) = install_origin {
        origin.to_string()
    } else {
        let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).ok_or("缺少主控地址")?;
        let authority = host.parse::<axum::http::uri::Authority>().map_err(|_| "主控地址无效")?;
        if authority.as_str().contains('@') || !host.bytes().all(|b| b.is_ascii_alphanumeric() || b".-:[]".contains(&b)) {
            return Err("主控地址无效");
        }
        let scheme = match headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()) {
            Some("https") => "https", _ => "http",
        };
        format!("{scheme}://{host}")
    };
    validate_public_origin(&origin)
}

fn validate_public_origin(origin: &str) -> Result<String, &'static str> {
    let url = reqwest::Url::parse(origin).map_err(|_| "主控地址无效")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.host_str().is_some_and(|host| host.bytes().all(|c| c.is_ascii_alphanumeric() || b".-:[]".contains(&c)))
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some()
        || url.fragment().is_some() || url.path() != "/" {
        return Err("主控地址必须是 http(s) 来源地址，不能包含用户名、路径或参数");
    }
    Ok(url.origin().ascii_serialization())
}

pub fn valid_node_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

pub fn shell_quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\\''")) }
pub fn powershell_quote(value: &str) -> String { format!("'{}'", value.replace('\'', "''")) }

pub fn notification_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_| "无法初始化通知连接".into())
}

pub fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().https_only(true).connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let allowed = matches!(attempt.url().host_str(), Some("github.com" | "api.github.com" | "release-assets.githubusercontent.com" | "objects.githubusercontent.com"));
            if attempt.previous().len() >= 5 || !allowed || attempt.url().scheme() != "https" || attempt.url().port_or_known_default() != Some(443) {
                attempt.error("GitHub redirect refused")
            } else { attempt.follow() }
        }))
        .build().map_err(|_| "无法初始化 GitHub 连接".into())
}

pub async fn read_limited(mut response: reqwest::Response, maximum: usize) -> Result<Vec<u8>, String> {
    if response.content_length().is_some_and(|length| length > maximum as u64) { return Err("响应超过大小限制".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("读取响应失败: {}", error.without_url()))? {
        if chunk.len() > maximum.saturating_sub(bytes.len()) { return Err("响应超过大小限制".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn script_json(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".into())
        .replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn asset_cache_accepts_hyphens_inside_vite_hashes() {
        assert!(fingerprinted_asset("index-C1Qy3-0Y.css"));
        assert!(fingerprinted_asset("NodeDetailPage-A_-1x2Yz.js"));
        assert!(!fingerprinted_asset("index.html"));
        assert!(!fingerprinted_asset("style.css"));
        assert!(!fingerprinted_asset("index-short.js"));
    }
    #[test]
    fn installer_values_cannot_escape_strings() {
        assert!(!valid_node_token("abc\";echo injected"));
        assert!(valid_node_token(&"a".repeat(32)));
        assert_eq!(powershell_quote("x'$()"), "'x''$()'");
        assert_eq!(shell_quote("x'$(id)"), "'x'\\''$(id)'");
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("bad\"host"));
        assert!(public_base_url(&headers, None).is_err());
    }
    #[test]
    fn install_origin_preserves_https_and_rejects_shell_or_url_payloads() {
        assert_eq!(validate_public_origin("https://status.example.com:8443").unwrap(), "https://status.example.com:8443");
        assert_eq!(validate_public_origin("http://127.0.0.1:8080").unwrap(), "http://127.0.0.1:8080");
        for origin in ["file:///etc/passwd", "https://user:pass@example.com", "https://example.com/path", "https://example.com?x=1", "https://example.com#x", "https://example.com';$(id)"] {
            assert!(validate_public_origin(origin).is_err(), "invalid origin: {origin}");
        }
    }
    #[test]
    fn only_public_reads_are_shared_with_themes() {
        assert!(public_read_path("/api/v1/servers"));
        assert!(!public_read_path("/api/v1/admin/servers"));
        assert!(!public_read_path("/install.sh"));
        assert!(!script_json(&"</script>").contains("</script>"));
    }
    #[test]
    fn forwarded_ips_stop_at_the_first_untrusted_hop() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("198.51.100.99, 203.0.113.10, 127.0.0.2"));
        let peer = Some("127.0.0.1:8080".parse().unwrap());
        let trust_loopback = |ip: IpAddr| ip.is_loopback();
        assert_eq!(source_ip_with_trust(&headers, peer, trust_loopback), "203.0.113.10");
        assert_eq!(source_ip_with_trust(&headers, Some("192.0.2.3:8080".parse().unwrap()), trust_loopback), "192.0.2.3");
        headers.insert("x-forwarded-for", HeaderValue::from_static("invalid"));
        assert_eq!(source_ip_with_trust(&headers, peer, trust_loopback), "127.0.0.1");
    }
    #[tokio::test]
    async fn streaming_responses_cannot_exceed_the_limit_without_content_length() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let writer = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 2048];
            let _ = stream.read(&mut request).await;
            stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4\r\n1234\r\n4\r\n5678\r\n0\r\n\r\n").await.unwrap();
        });
        let response = notification_client().unwrap().get(format!("http://{address}")).send().await.unwrap();
        assert!(read_limited(response, 6).await.unwrap_err().contains("大小限制"));
        writer.await.unwrap();
    }
}
