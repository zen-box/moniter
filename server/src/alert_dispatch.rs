use crate::notify;

/// Fan out one alert to the enabled notification channels without blocking the
/// heartbeat monitor. Channel failures are reported independently so one bad
/// destination does not suppress the others.
pub fn dispatch(cfg: &notify::AlertConfig, alert: notify::AlertMessage, kind: &'static str) {
    let subject = format!("[{}] {}告警：{}", cfg.site_name, kind, alert.server_name);
    let body = notify::render_body(&alert, &cfg.site_name);
    let cfg = cfg.clone();
    tokio::spawn(async move {
        let mut delivered = 0;
        let mut errors = Vec::new();
        if cfg.smtp_enabled {
            match notify::send_mail(&cfg, &subject, &body).await {
                Ok(_) => delivered += 1,
                Err(e) => errors.push(format!("SMTP: {}", e)),
            }
        }
        if cfg.telegram_enabled {
            match notify::send_telegram(&cfg, &body).await {
                Ok(_) => delivered += 1,
                Err(e) => errors.push(format!("Telegram: {}", e)),
            }
        }
        if cfg.webhook_enabled {
            match notify::send_webhook(&cfg, &subject, &body).await {
                Ok(_) => delivered += 1,
                Err(e) => errors.push(format!("Webhook: {}", e)),
            }
        }
        if delivered > 0 {
            println!("📣 {} 告警已投递到 {} 个渠道", kind, delivered);
        }
        if !errors.is_empty() {
            eprintln!("⚠️ {} 告警投递失败: {}", kind, errors.join("；"));
        }
    });
}
