use crate::{client_ip, format_ts, notify, now_secs, AppContext};
use axum::{
    extract::State,
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

pub fn router() -> Router<AppContext> {
    Router::new()
        .route("/api/v1/admin/alerts", get(get_alerts))
        .route("/api/v1/admin/alerts/events", get(get_alert_events))
        .route("/api/v1/admin/alerts/save", post(save_alerts))
        .route("/api/v1/admin/alerts/test", post(test_alert))
}

async fn get_alerts(State(ctx): State<AppContext>) -> Json<serde_json::Value> {
    let conn = ctx.db.lock().unwrap();
    Json(notify::AlertConfig::load(&conn).masked())
}

#[derive(Deserialize)]
struct AlertEventsQuery {
    limit: Option<i64>,
}

async fn get_alert_events(
    State(ctx): State<AppContext>,
    axum::extract::Query(q): axum::extract::Query<AlertEventsQuery>,
) -> Json<Vec<serde_json::Value>> {
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let conn = ctx.db.lock().unwrap();
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT e.server_id, e.event_type, e.message, e.created_at, COALESCE(s.name,e.server_id)
         FROM alert_events e LEFT JOIN servers s ON s.id=e.server_id ORDER BY e.created_at DESC LIMIT ?1",
    ) {
        if let Ok(rows) = stmt.query_map([limit], |r| {
            Ok(serde_json::json!({
                "server_id": r.get::<_, String>(0)?,
                "event_type": r.get::<_, String>(1)?,
                "message": r.get::<_, String>(2)?,
                "created_at": r.get::<_, i64>(3)?,
                "server_name": r.get::<_,String>(4)?,
            }))
        }) {
            out.extend(rows.flatten());
        }
    }
    Json(out)
}

#[derive(Deserialize)]
struct SaveAlertReq {
    enabled: bool,
    #[serde(default)]
    smtp_enabled: bool,
    smtp_host: String,
    smtp_port: u16,
    smtp_user: String,
    smtp_pass: Option<String>,
    from: String,
    to: String,
    notify_offline: bool,
    #[serde(default)]
    notify_login: bool,
    #[serde(default)]
    resource_rules: Option<crate::alert_rules::Rules>,
    #[serde(default)]
    notify_online: bool,
    notify_cpu: bool,
    cpu_threshold: f32,
    notify_traffic: bool,
    traffic_threshold: u8,
    #[serde(default)]
    telegram_enabled: bool,
    #[serde(default)]
    telegram_bot_token: Option<String>,
    #[serde(default)]
    telegram_chat_id: String,
    #[serde(default)]
    webhook_enabled: bool,
    #[serde(default)]
    webhook_url: String,
    #[serde(default)]
    webhook_format: String,
}

async fn save_alerts(
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    Json(p): Json<SaveAlertReq>,
) -> Json<serde_json::Value> {
    let ip = client_ip(&headers, None);
    let mut cfg = {
        let conn = ctx.db.lock().unwrap();
        notify::AlertConfig::load(&conn)
    };

    cfg.enabled = p.enabled;
    cfg.smtp_enabled = p.smtp_enabled;
    cfg.smtp_host = p.smtp_host.trim().to_string();
    cfg.smtp_port = p.smtp_port.clamp(1, 65535);
    cfg.smtp_user = p.smtp_user.trim().to_string();
    cfg.from = p.from.trim().to_string();
    cfg.to = p.to.trim().to_string();
    cfg.notify_offline = p.notify_offline;
    cfg.notify_login = p.notify_login;
    if let Some(mut rules)=p.resource_rules {rules.normalize();cfg.resource_rules=rules;}
    cfg.notify_online = p.notify_online;
    cfg.notify_cpu = p.notify_cpu;
    cfg.cpu_threshold = p.cpu_threshold.clamp(1.0, 100.0);
    cfg.notify_traffic = p.notify_traffic;
    cfg.traffic_threshold = p.traffic_threshold.clamp(1, 100);
    cfg.telegram_enabled = p.telegram_enabled;
    cfg.telegram_chat_id = p.telegram_chat_id.trim().to_string();
    cfg.webhook_enabled = p.webhook_enabled;
    cfg.webhook_url = p.webhook_url.trim().to_string();
    cfg.webhook_format=match p.webhook_format.as_str() {"wecom"|"feishu"|"dingtalk"|"discord"=>p.webhook_format,_=>"generic".into()};

    if cfg.smtp_host.is_empty() && cfg.smtp_user.is_empty() {
        cfg.smtp_pass.clear();
    } else if let Some(password) = p.smtp_pass.filter(|value| !value.is_empty()) {
        cfg.smtp_pass = password;
    }
    if let Some(token) = p
        .telegram_bot_token
        .filter(|value| !value.trim().is_empty())
    {
        cfg.telegram_bot_token = token.trim().to_string();
    }
    if !cfg.telegram_enabled && cfg.telegram_chat_id.is_empty() {
        cfg.telegram_bot_token.clear();
    }

    let conn = ctx.db.lock().unwrap();
    if let Err(error) = cfg.save(&conn) {
        return Json(serde_json::json!({
            "success": false,
            "message": format!("保存失败: {}", error)
        }));
    }
    let _ = conn.execute(
        "INSERT INTO audit_logs (action, ip) VALUES (?1, ?2)",
        rusqlite::params!["更新告警通知配置", ip],
    );
    Json(serde_json::json!({ "success": true }))
}

async fn test_alert(State(ctx): State<AppContext>) -> Json<serde_json::Value> {
    let cfg = {
        let conn = ctx.db.lock().unwrap();
        notify::AlertConfig::load(&conn)
    };
    let alert = notify::AlertMessage {
        server_name: "测试节点".to_string(),
        event_type: "test".to_string(),
        message: "这是一条测试告警，用于验证已启用的通知渠道。".to_string(),
        timestamp: format_ts(now_secs()),
    };
    let subject = format!("[{}] 测试告警", cfg.site_name);
    let body = notify::render_body(&alert, &cfg.site_name);
    let mut sent = Vec::new();
    let mut errors = Vec::new();

    if cfg.smtp_enabled {
        match notify::send_mail(&cfg, &subject, &body).await {
            Ok(()) => sent.push("SMTP"),
            Err(error) => errors.push(error),
        }
    }
    if cfg.telegram_enabled {
        match notify::send_telegram(&cfg, &body).await {
            Ok(()) => sent.push("Telegram"),
            Err(error) => errors.push(error),
        }
    }
    if cfg.webhook_enabled {
        match notify::send_webhook(&cfg, &subject, &body).await {
            Ok(()) => sent.push("Webhook"),
            Err(error) => errors.push(error),
        }
    }
    if sent.is_empty() {
        let message = if errors.is_empty() {
            "没有启用任何告警渠道".to_string()
        } else {
            errors.join("；")
        };
        Json(serde_json::json!({ "success": false, "message": message }))
    } else if !errors.is_empty() {
        Json(serde_json::json!({
            "success": false,
            "message": format!("已发送到 {}；以下渠道失败：{}", sent.join("、"), errors.join("；")),
            "sent": sent, "errors": errors
        }))
    } else {
        Json(serde_json::json!({
            "success": true,
            "message": format!("测试告警已发送到 {}", sent.join("、")),
            "sent": sent, "errors": errors
        }))
    }
}
