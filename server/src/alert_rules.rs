//! Optional resource and renewal rules; all new rules are opt-in for existing sites.
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use crate::ServerStateItem;
use std::{collections::HashMap,time::{Duration,Instant}};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct NodeRules {
    pub memory: bool,
    pub disk: bool,
    pub load: bool,
    pub loss: bool,
    pub billing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Rules {
    pub memory: bool,
    pub memory_percent: f64,
    pub disk: bool,
    pub disk_percent: f64,
    pub load: bool,
    pub load_per_core: f64,
    pub loss: bool,
    pub loss_percent: f64,
    pub billing: bool,
    pub billing_days: i64,
}
impl Default for Rules {
    fn default() -> Self {
        Self {memory:false,memory_percent:90.0,disk:false,disk_percent:90.0,load:false,
            load_per_core:1.0,loss:false,loss_percent:20.0,billing:false,billing_days:7}
    }
}
impl Rules {
    pub fn normalize(&mut self) {
        self.memory_percent=self.memory_percent.clamp(1.0,100.0);
        self.disk_percent=self.disk_percent.clamp(1.0,100.0);
        self.load_per_core=self.load_per_core.clamp(0.1,100.0);
        self.loss_percent=self.loss_percent.clamp(1.0,100.0);
        self.billing_days=self.billing_days.clamp(0,90);
    }
}

pub struct Breach {
    pub kind: &'static str,
    pub label: &'static str,
    pub exceeded: bool,
    pub message: String,
}

pub fn resources(item:&ServerStateItem,rules:&Rules) -> Vec<Breach> {
    if !item.alert_enabled || item.status!="online" { return vec![]; }
    let flags=&item.alert_rules;
    let mut out=vec![];
    for (kind,label,enabled,used,total,threshold) in [
        ("memory_high","内存",rules.memory&&flags.memory,item.mem_used_mb,item.mem_total_mb,rules.memory_percent),
        ("disk_high","磁盘",rules.disk&&flags.disk,item.disk_used_bytes,item.disk_total_bytes,rules.disk_percent),
    ] {
        if enabled && total>0 {
            let percent=used as f64/total as f64*100.0;
            out.push(Breach {kind,label,exceeded:percent>=threshold,
                message:format!("{label}使用率 {percent:.1}%，连续 3 次检查达到阈值 {threshold:.1}%。")});
        }
    }
    if rules.load&&flags.load&&item.cpu_cores>0&&!item.os_name.to_ascii_lowercase().contains("windows") {
        let load=item.load1 as f64/item.cpu_cores as f64;
        out.push(Breach {kind:"load_high",label:"负载",exceeded:load>=rules.load_per_core,
            message:format!("每核心 1 分钟负载 {load:.2}，连续 3 次检查达到阈值 {:.2}。",rules.load_per_core)});
    }
    out
}

pub fn renewal(item:&ServerStateItem,rules:&Rules,today:NaiveDate) -> Option<(String,String)> {
    if !item.alert_enabled || !item.alert_rules.billing || !rules.billing || matches!(item.billing_cycle.as_str(),"free"|"lifetime") {return None;}
    let due=NaiveDate::parse_from_str(&item.renewal_date,"%Y-%m-%d").ok()?;
    let days=(due-today).num_days();
    if days>rules.billing_days {return None;}
    let stage=if days<0 {"overdue"}else{"upcoming"};
    let message=if days<0 {format!("节点续费日期 {}，已逾期 {} 天。请确认是否已付款并更新续费日期。",due,-days)}
        else {format!("节点将于 {} 到期，剩余 {} 天。",due,days)};
    Some((format!("{}:billing:{}:{stage}",item.id,due),message))
}

pub fn loss_percent(timeouts:i64,total:i64) -> Option<f64> {
    (total>=3 && timeouts>=0 && timeouts<=total).then(||timeouts as f64/total as f64*100.0)
}

fn dispatch(ctx:&crate::AppContext,cfg:&crate::notify::AlertConfig,item:&ServerStateItem,kind:&str,label:&'static str,message:String) {
    crate::record_alert_event(ctx,&item.id,kind,&message);
    crate::alert_dispatch::dispatch(cfg,crate::notify::AlertMessage {
        server_name:item.name.clone(),event_type:kind.into(),message,timestamp:crate::format_ts(crate::now_secs()),
    },label);
}

/// History reads run in their own task and cannot delay heartbeat/offline evaluation.
pub fn spawn(ctx:crate::AppContext) {
    tokio::spawn(async move {
        let mut streaks:HashMap<(String,&'static str),u8>=HashMap::new();
        let mut billing_at=Instant::now()-Duration::from_secs(60);
        let mut loss_at=Instant::now()-Duration::from_secs(15);
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let cfg={let conn=ctx.db.lock().unwrap();crate::notify::AlertConfig::load(&conn)};
            if !cfg.enabled {streaks.clear();continue;}
            let items=crate::list_all_servers(&ctx);
            let mut active=HashMap::new();
            for item in &items {
                for breach in resources(item,&cfg.resource_rules) {
                    let key=(item.id.clone(),breach.kind);
                    let count=streaks.entry(key.clone()).or_default();
                    *count=if breach.exceeded {count.saturating_add(1).min(3)} else {0};
                    active.insert(key,());
                    if *count>=3&&crate::should_alert(&ctx,&format!("{}:{}",item.id,breach.kind),1800) {
                        dispatch(&ctx,&cfg,item,breach.kind,breach.label,breach.message);
                    }
                }
            }
            streaks.retain(|key,_|active.contains_key(key));
            if cfg.resource_rules.billing&&billing_at.elapsed()>=Duration::from_secs(60) {
                billing_at=Instant::now();
                for item in &items {
                    if let Some((key,message))=renewal(item,&cfg.resource_rules,chrono::Local::now().date_naive()) {
                        let first=ctx.db.lock().unwrap().execute("INSERT OR IGNORE INTO alert_state(key,last_notified) VALUES(?1,?2)",
                            rusqlite::params![key,crate::now_secs() as i64]).map(|n|n>0).unwrap_or(false);
                        if first {dispatch(&ctx,&cfg,item,"billing_due","续费",message);}
                    }
                }
            }
            if cfg.resource_rules.loss&&loss_at.elapsed()>=Duration::from_secs(15) {
                loss_at=Instant::now();
                for item in &items {
                    if item.status!="online"||!item.alert_enabled||!item.alert_rules.loss||!item.monitor_enabled {continue;}
                    let id=item.id.clone();let now=crate::now_secs() as i64;
                    let result=ctx.history.query(format!("alert-loss:{id}:{}",now/30),move|conn|{
                        let mut statement=conn.prepare("SELECT target_id, SUM(CASE WHEN ms>=999 THEN 1 ELSE 0 END),COUNT(*),
                            COALESCE((SELECT name FROM monitor_targets WHERE id=target_id),'')
                            FROM target_metrics WHERE server_id=?1 AND ts>=?2 AND ms>0 GROUP BY target_id")?;
                        let values=statement.query_map(rusqlite::params![id,now-300],|row|Ok(serde_json::json!({
                            "id":row.get::<_,i64>(0)?,"failed":row.get::<_,i64>(1)?,"total":row.get::<_,i64>(2)?,"name":row.get::<_,String>(3)?,
                        })))?.collect::<rusqlite::Result<Vec<_>>>()?;
                        Ok(serde_json::json!(values))
                    }).await;
                    if let Ok(axum::Json(values))=result {
                        for value in values.as_array().into_iter().flatten() {
                            let failed=value["failed"].as_i64().unwrap_or(0);let total=value["total"].as_i64().unwrap_or(0);
                            if let Some(percent)=loss_percent(failed,total).filter(|p|*p>=cfg.resource_rules.loss_percent) {
                                let target=value["id"].as_i64().unwrap_or(0);
                                if crate::should_alert(&ctx,&format!("{}:probe_loss:{target}",item.id),1800) {
                                    let name=value["name"].as_str().filter(|s|!s.is_empty()).map(str::to_string).unwrap_or_else(||format!("#{target}"));
                                    dispatch(&ctx,&cfg,item,"probe_loss","探测失败率",format!("目标 {name} 最近 5 分钟 TCP 探测失败率 {percent:.1}%（{failed}/{total} 次），达到阈值 {:.1}%。",cfg.resource_rules.loss_percent));
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resource_rules_need_both_switches_and_real_denominators() {
        let mut node=ServerStateItem {status:"online".into(),alert_enabled:true,mem_used_mb:95,mem_total_mb:100,cpu_cores:2,load1:3.0,
            alert_rules:NodeRules {memory:true,load:true,..Default::default()},..Default::default()};
        let rules=Rules {memory:true,load:true,..Default::default()};
        assert_eq!(resources(&node,&rules).len(),2);assert!(resources(&node,&rules).iter().all(|b|b.exceeded));
        node.os_name="Windows 11".into();assert_eq!(resources(&node,&rules).len(),1);
        node.mem_total_mb=0;assert!(resources(&node,&rules).is_empty());
        node.alert_enabled=false;assert!(resources(&node,&rules).is_empty());
        assert!((loss_percent(2,3).unwrap()-200.0/3.0).abs()<1e-10);assert_eq!(loss_percent(2,2),None);
    }
    #[test]
    fn renewal_checks_offline_nodes_and_never_assumes_payment() {
        let today=NaiveDate::from_ymd_opt(2026,11,1).unwrap();
        let mut node=ServerStateItem {id:"test".into(),alert_enabled:true,billing_cycle:"monthly".into(),renewal_date:"2026-11-05".into(),
            alert_rules:NodeRules {billing:true,..Default::default()},..Default::default()};
        let rules=Rules {billing:true,..Default::default()};
        assert!(renewal(&node,&rules,today).unwrap().0.ends_with("upcoming"));
        node.renewal_date="2026-10-31".into();assert!(renewal(&node,&rules,today).unwrap().0.ends_with("overdue"));
        node.billing_cycle="free".into();assert!(renewal(&node,&rules,today).is_none());
    }
}
