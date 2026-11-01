//! Persistent billing-period usage. Counter resets never erase already observed usage.
use chrono::{Datelike, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use crate::ServerStateItem;
pub const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

pub fn period_at(now: i64, day: i64, offset: i32) -> i64 {
    let tz = chrono::FixedOffset::east_opt(offset).expect("valid system offset");
    let date = tz.timestamp_opt(now, 0).single().expect("valid timestamp").date_naive();
    let boundary = |year, month| {
        let next = if month == 12 { chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1) } else { chrono::NaiveDate::from_ymd_opt(year, month + 1, 1) }.unwrap();
        chrono::NaiveDate::from_ymd_opt(year, month, (day.clamp(1, 31) as u32).min(next.pred_opt().unwrap().day())).unwrap()
    };
    let this = boundary(date.year(), date.month());
    let start = if date >= this { this } else if date.month() == 1 { boundary(date.year()-1, 12) } else { boundary(date.year(), date.month()-1) };
    tz.from_local_datetime(&start.and_hms_opt(0,0,0).unwrap()).single().unwrap().timestamp()
}

pub fn period(now: i64, day: i64) -> i64 {
    period_at(now, day, chrono::Local::now().offset().local_minus_utc())
}

#[derive(Default)]
struct Usage { period: i64, base: u64, rx: u64, tx: u64, last_rx: u64, last_tx: u64, pending: bool }
fn integer(value: u64) -> i64 { value.min(i64::MAX as u64) as i64 }
fn load(conn: &Connection, id: &str) -> rusqlite::Result<Option<Usage>> {
    conn.query_row("SELECT period, base, rx, tx, last_rx, last_tx, pending FROM traffic_usage WHERE server_id=?1", [id], |r| Ok(Usage {
        period: r.get(0)?, base: r.get::<_,i64>(1)? as u64, rx:r.get::<_,i64>(2)? as u64, tx:r.get::<_,i64>(3)? as u64,
        last_rx:r.get::<_,i64>(4)? as u64, last_tx:r.get::<_,i64>(5)? as u64, pending:r.get::<_,i64>(6)? != 0,
    })).optional()
}
fn save(conn: &Connection, id: &str, u: &Usage) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO traffic_usage(server_id,period,base,rx,tx,last_rx,last_tx,pending) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
        ON CONFLICT(server_id) DO UPDATE SET period=excluded.period,base=excluded.base,rx=excluded.rx,tx=excluded.tx,last_rx=excluded.last_rx,last_tx=excluded.last_tx,pending=excluded.pending",
        params![id,u.period,integer(u.base),integer(u.rx),integer(u.tx),integer(u.last_rx),integer(u.last_tx),u.pending as i64])?;
    Ok(())
}
fn used(u: &Usage, both: bool) -> u64 { u.base.saturating_add(u.tx).saturating_add(if both {u.rx} else {0}) }

pub fn read(conn: &Connection, item: &ServerStateItem, now: i64) -> u64 {
    match load(conn, &item.id).ok().flatten() {
        Some(u) if u.period == period(now, item.traffic_reset_day) => used(&u, item.traffic_type == "both"),
        Some(_) => 0,
        None if item.traffic_base_at > 0 && item.traffic_base_at >= period(now, item.traffic_reset_day) => (item.traffic_base_gb * GIB) as u64,
        None => 0,
    }
}

pub fn update(conn: &Connection, item: &ServerStateItem, now: i64) -> rusqlite::Result<u64> {
    let current = period(now, item.traffic_reset_day);
    let mut u = load(conn, &item.id)?.unwrap_or(Usage {
        period: current, base: if item.traffic_base_at >= current { (item.traffic_base_gb * GIB) as u64 } else {0}, pending: true, ..Usage::default()
    });
    if u.period != current {
        // We cannot attribute traffic during an offline gap to either month.
        // Establish a fresh baseline rather than charging the previous cycle again.
        u = Usage {period:current, pending:true, ..Usage::default()};
    }
    if !u.pending {
        u.rx = u.rx.saturating_add(if item.total_rx_bytes >= u.last_rx {item.total_rx_bytes-u.last_rx} else {item.total_rx_bytes});
        u.tx = u.tx.saturating_add(if item.total_tx_bytes >= u.last_tx {item.total_tx_bytes-u.last_tx} else {item.total_tx_bytes});
    }
    u.last_rx = item.total_rx_bytes;
    u.last_tx = item.total_tx_bytes;
    u.pending = false;
    let value = used(&u, item.traffic_type == "both");
    save(conn,&item.id,&u)?;
    Ok(value)
}

pub fn calibrate(conn: &Connection, id: &str, amount: f64, reset: i64, counters: Option<(u64,u64)>, now: i64) -> rusqlite::Result<()> {
    let (last_rx,last_tx) = counters.unwrap_or_default();
    save(conn,id,&Usage {period:period(now,reset),base:(amount*GIB) as u64,last_rx,last_tx,pending:counters.is_none(),..Usage::default()})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_calibration_counter_reset_and_month_rollover() {
        let db = crate::db::init_db(":memory:").unwrap(); let conn = db.lock().unwrap();
        let now = 1793534400;
        let mut item = ServerStateItem {id:"test".into(),traffic_type:"both".into(),traffic_reset_day:1,..Default::default()};
        calibrate(&conn,"test",10.0,1,None,now).unwrap();
        item.total_rx_bytes=3_000_000_000;item.total_tx_bytes=600_000_000;
        assert_eq!(update(&conn,&item,now).unwrap(),(10.0*GIB) as u64);
        item.total_rx_bytes+=100;item.total_tx_bytes+=200;
        assert_eq!(update(&conn,&item,now+1).unwrap(),(10.0*GIB) as u64+300);
        item.total_rx_bytes=40;item.total_tx_bytes=20;
        assert_eq!(update(&conn,&item,now+2).unwrap(),(10.0*GIB) as u64+360);
        assert_eq!(read(&conn,&item,now+2),(10.0*GIB) as u64+360);
        assert_eq!(update(&conn,&item,now+32*86400).unwrap(),0);
    }
    #[test]
    fn reset_day_31_clamps_to_february_and_uses_timezone() {
        let ts=chrono::DateTime::parse_from_rfc3339("2024-02-29T00:00:00+08:00").unwrap().timestamp();
        assert_eq!(period_at(ts,31,8*3600),ts);
        assert!(period_at(ts-1,31,8*3600)<ts-86400);
    }
}
