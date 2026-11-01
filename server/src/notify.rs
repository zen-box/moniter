use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::{Deserialize, Serialize};

fn default_notify_online() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct AlertMessage {
    pub server_name: String,
    pub event_type: String, // "offline", "online", "cpu_high", "traffic_warning", "billing_due"
    pub message: String,
    pub timestamp: String,
}

/// 告警配置。存在 settings 表里，用 JSON 序列化。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertConfig {
    /// 总开关。关闭后所有渠道都不投递。
    pub enabled: bool,
    #[serde(skip)]
    pub site_name: String,
    #[serde(default)]
    pub smtp_enabled: bool,
    pub smtp_host: String,
    pub smtp_port: u16,
    /// 465 走隐式 TLS，587/25 走 STARTTLS
    pub smtp_user: String,
    pub smtp_pass: String,
    pub from: String,
    /// 多个收件人用英文逗号分隔
    pub to: String,
    pub notify_offline: bool,
    #[serde(default)]
    pub notify_login: bool,
    #[serde(default)]
    pub resource_rules: crate::alert_rules::Rules,
    #[serde(default = "default_notify_online")]
    pub notify_online: bool,
    pub notify_cpu: bool,
    pub cpu_threshold: f32,
    pub notify_traffic: bool,
    pub traffic_threshold: u8,
    #[serde(default)]
    pub telegram_enabled: bool,
    #[serde(default)]
    pub telegram_bot_token: String,
    #[serde(default)]
    pub telegram_chat_id: String,
    #[serde(default)]
    pub webhook_enabled: bool,
    #[serde(default)]
    pub webhook_url: String,
    #[serde(default)]
    pub webhook_format: String,
}

impl Default for AlertConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            site_name: "Moniter".into(),
            smtp_enabled: false,
            smtp_host: String::new(),
            smtp_port: 465,
            smtp_user: String::new(),
            smtp_pass: String::new(),
            from: String::new(),
            to: String::new(),
            notify_offline: true,
            notify_login: false,
            resource_rules: Default::default(),
            notify_online: true,
            notify_cpu: false,
            cpu_threshold: 90.0,
            notify_traffic: false,
            traffic_threshold: 90,
            telegram_enabled: false,
            telegram_bot_token: String::new(),
            telegram_chat_id: String::new(),
            webhook_enabled: false,
            webhook_url: String::new(),
            webhook_format: "generic".into(),
        }
    }
}

impl AlertConfig {
    /// 从 settings 表读配置，没有就用默认值（未启用）
    pub fn load(conn: &rusqlite::Connection) -> Self {
        let mut config:Self = conn.query_row(
            "SELECT value FROM settings WHERE key = 'alert_config'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|json| {
            let value: serde_json::Value = serde_json::from_str(&json).ok()?;
            let legacy = value.get("smtp_enabled").is_none();
            let mut config: Self = serde_json::from_value(value).ok()?;
            if legacy {
                config.smtp_enabled = !config.smtp_host.trim().is_empty();
                let _ = config.save(conn);
            }
            Some(config)
        })
        .unwrap_or_default();
        config.site_name = conn.query_row("SELECT value FROM settings WHERE key='site_name'",[],|r|r.get(0)).unwrap_or_else(|_|"Moniter".into());
        config
    }

    pub fn save(&self, conn: &rusqlite::Connection) -> rusqlite::Result<()> {
        let json = serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('alert_config', ?1)",
            [json],
        )?;
        Ok(())
    }

    /// 返回给前端的版本，密码打码
    pub fn masked(&self) -> serde_json::Value {
        serde_json::json!({
            "enabled": self.enabled,
            "smtp_enabled": self.smtp_enabled,
            "smtp_host": self.smtp_host,
            "smtp_port": self.smtp_port,
            "smtp_user": self.smtp_user,
            "smtp_pass_set": !self.smtp_pass.is_empty(),
            "from": self.from,
            "to": self.to,
            "notify_offline": self.notify_offline,
            "notify_login": self.notify_login,
            "resource_rules": self.resource_rules,
            "notify_online": self.notify_online,
            "notify_cpu": self.notify_cpu,
            "cpu_threshold": self.cpu_threshold,
            "notify_traffic": self.notify_traffic,
            "traffic_threshold": self.traffic_threshold,
            "telegram_enabled": self.telegram_enabled,
            "telegram_bot_token_set": !self.telegram_bot_token.is_empty(),
            "telegram_chat_id": self.telegram_chat_id,
            "webhook_enabled": self.webhook_enabled,
            "webhook_url": self.webhook_url,
            "webhook_format": self.webhook_format,
        })
    }
}

/// 真正把邮件发出去。
///
/// 之前这里的实现是 `TcpStream::connect("api.telegram.org:443")` 然后什么都不发 ——
/// 看起来像在发告警，其实一个字节都没发出去。现在用 lettre 走标准 SMTP。
pub async fn send_mail(cfg: &AlertConfig, subject: &str, body: &str) -> Result<(), String> {
    if cfg.smtp_host.trim().is_empty() {
        return Err("未配置 SMTP 服务器".to_string());
    }
    if cfg.from.trim().is_empty() {
        return Err("未配置发件人地址".to_string());
    }
    if cfg.to.trim().is_empty() {
        return Err("未配置收件人地址".to_string());
    }

    let from = cfg
        .from
        .trim()
        .parse()
        .map_err(|e| format!("发件人地址无效: {}", e))?;

    let mut builder = Message::builder()
        .from(from)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN);

    let mut recipients = 0;
    for raw in cfg.to.split(',') {
        let addr = raw.trim();
        if addr.is_empty() {
            continue;
        }
        let mailbox = addr
            .parse()
            .map_err(|e| format!("收件人「{}」无效: {}", addr, e))?;
        builder = builder.to(mailbox);
        recipients += 1;
    }
    if recipients == 0 {
        return Err("没有有效的收件人地址".to_string());
    }

    let email = builder
        .body(body.to_string())
        .map_err(|e| format!("构造邮件失败: {}", e))?;

    let creds = Credentials::new(cfg.smtp_user.clone(), cfg.smtp_pass.clone());

    let mailer = if cfg.smtp_port == 465 {
        // 465 是隐式 TLS（SMTPS）
        AsyncSmtpTransport::<Tokio1Executor>::relay(cfg.smtp_host.trim())
            .map_err(|e| format!("SMTP 连接失败: {}", e))?
            .port(cfg.smtp_port)
            .credentials(creds)
            .build()
    } else {
        // 587 / 25 走 STARTTLS
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(cfg.smtp_host.trim())
            .map_err(|e| format!("SMTP 连接失败: {}", e))?
            .port(cfg.smtp_port)
            .credentials(creds)
            .build()
    };

    tokio::time::timeout(std::time::Duration::from_secs(15), mailer.send(email))
        .await.map_err(|_| "SMTP 发送超时".to_string())?
        .map_err(|e| format!("发送失败: {}", e))?;

    Ok(())
}

/// 通过 Telegram Bot API 投递纯文本告警。
pub async fn send_telegram(cfg: &AlertConfig, body: &str) -> Result<(), String> {
    if cfg.telegram_bot_token.trim().is_empty() || cfg.telegram_chat_id.trim().is_empty() {
        return Err("未配置 Telegram Bot Token 或 Chat ID".to_string());
    }
    let url = format!(
        "https://api.telegram.org/bot{}/sendMessage",
        cfg.telegram_bot_token.trim()
    );
    let response = crate::security::notification_client()?
        .post(url)
        .json(&serde_json::json!({
            "chat_id": cfg.telegram_chat_id.trim(),
            "text": body,
            "disable_web_page_preview": true
        }))
        .send()
        .await
        .map_err(|e| format!("Telegram 连接失败: {}", e.without_url()))?;
    if !response.status().is_success() {
        return Err(format!("Telegram 返回 HTTP {}", response.status()));
    }
    Ok(())
}

/// 向通用 Webhook 发送 JSON，兼容企业微信、飞书、Discord 等自定义接收器。
pub async fn send_webhook(cfg: &AlertConfig, subject: &str, body: &str) -> Result<(), String> {
    if cfg.webhook_url.trim().is_empty() {
        return Err("未配置 Webhook URL".to_string());
    }
    let url = reqwest::Url::parse(cfg.webhook_url.trim()).map_err(|_| "Webhook 地址无效")?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("Webhook 必须为不含用户名密码的 HTTP(S) 地址".into());
    }
    let response = crate::security::notification_client()?
        .post(url)
        .json(&webhook_payload(cfg, subject, body))
        .send()
        .await
        .map_err(|e| format!("Webhook 连接失败: {}", e.without_url()))?;
    if !response.status().is_success() {
        return Err(format!("Webhook 返回 HTTP {}", response.status()));
    }
    Ok(())
}

pub fn webhook_payload(cfg:&AlertConfig, subject:&str, body:&str)->serde_json::Value {
    match cfg.webhook_format.as_str() {
        "wecom"|"dingtalk"=>serde_json::json!({"msgtype":"text","text":{"content":format!("{subject}\n{body}")}}),
        "feishu"=>serde_json::json!({"msg_type":"text","content":{"text":format!("{subject}\n{body}")}}),
        "discord"=>serde_json::json!({"content":format!("{subject}\n{body}")}),
        _=>serde_json::json!({"title":subject,"content":body,"source":cfg.site_name}),
    }
}

pub fn render_body(alert: &AlertMessage, site_name:&str) -> String {
    let event=match alert.event_type.as_str() {
        "offline"=>"节点离线", "online"=>"恢复在线", "cpu_high"=>"CPU 超阈值", "traffic_warning"=>"流量超阈值", "login"=>"管理员登录", "test"=>"通知测试",
        "memory_high"=>"内存超阈值", "disk_high"=>"磁盘超阈值", "load_high"=>"负载超阈值", "probe_loss"=>"TCP 探测失败率", "billing_due"=>"续费提醒",other=>other
    };
    format!("{site_name} 告警通知\n节点：{}\n事件：{event}\n详情：{}\n时间：{}\n此通知由 {site_name} 自动发送。",alert.server_name,alert.message,alert.timestamp)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_smtp_disable_survives_loading_and_legacy_migrates_once() {
        let db=crate::db::init_db(":memory:").unwrap();let conn=db.lock().unwrap();
        let config=AlertConfig {smtp_host:"smtp.example.test".into(),..Default::default()};config.save(&conn).unwrap();
        assert!(!AlertConfig::load(&conn).smtp_enabled);
        let mut legacy=serde_json::to_value(&config).unwrap();legacy.as_object_mut().unwrap().remove("smtp_enabled");
        conn.execute("UPDATE settings SET value=?1 WHERE key='alert_config'",[legacy.to_string()]).unwrap();
        assert!(AlertConfig::load(&conn).smtp_enabled);
        let mut migrated=AlertConfig::load(&conn);migrated.smtp_enabled=false;migrated.save(&conn).unwrap();assert!(!AlertConfig::load(&conn).smtp_enabled);
    }
    #[test]
    fn webhook_presets_have_service_specific_envelopes() {
        let mut cfg=AlertConfig::default();assert_eq!(webhook_payload(&cfg,"test","body")["title"],"test");
        cfg.webhook_format="wecom".into();assert_eq!(webhook_payload(&cfg,"test","body")["msgtype"],"text");
        cfg.webhook_format="feishu".into();assert_eq!(webhook_payload(&cfg,"test","body")["msg_type"],"text");
        cfg.webhook_format="discord".into();assert!(webhook_payload(&cfg,"test","body")["content"].is_string());
    }
}
