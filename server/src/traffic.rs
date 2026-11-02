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

#[derive(Default, Clone, PartialEq, Eq)]
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

fn initial(item: &ServerStateItem, current: i64) -> Usage {
    Usage {
        period: current, base: if item.traffic_base_at >= current { (item.traffic_base_gb * GIB) as u64 } else {0}, pending: true, ..Usage::default()
    }
}

/// Fold one counter reading into the period total. Returns true when the
/// billing period rolled over.
fn advance(u: &mut Usage, item: &ServerStateItem, current: i64) -> bool {
    let rolled = u.period != current;
    if rolled {
        // We cannot attribute traffic during an offline gap to either month.
        // Establish a fresh baseline rather than charging the previous cycle again.
        *u = Usage {period:current, pending:true, ..Usage::default()};
    }
    if !u.pending {
        u.rx = u.rx.saturating_add(if item.total_rx_bytes >= u.last_rx {item.total_rx_bytes-u.last_rx} else {item.total_rx_bytes});
        u.tx = u.tx.saturating_add(if item.total_tx_bytes >= u.last_tx {item.total_tx_bytes-u.last_tx} else {item.total_tx_bytes});
    }
    u.last_rx = item.total_rx_bytes;
    u.last_tx = item.total_tx_bytes;
    u.pending = false;
    rolled
}

#[cfg(test)]
fn update(conn: &Connection, item: &ServerStateItem, now: i64) -> rusqlite::Result<u64> {
    let current = period(now, item.traffic_reset_day);
    let mut u = load(conn, &item.id)?.unwrap_or_else(|| initial(item, current));
    advance(&mut u, item, current);
    let value = used(&u, item.traffic_type == "both");
    save(conn,&item.id,&u)?;
    Ok(value)
}

/// Maximum time between database saves. Live snapshots still advance on every
/// heartbeat. An abrupt process/OS failure can lose unflushed counter resets.
const SAVE_EVERY: std::time::Duration = std::time::Duration::from_secs(30);

/// Per-connection usage: advanced in memory on every heartbeat, written to the
/// database on the first reading, on period rollover, every SAVE_EVERY and on
/// disconnect.
#[derive(Default)]
pub struct Meter {
    usage: Option<Usage>,
    persisted: Option<Usage>,
    saved: Option<std::time::Instant>,
    dirty: bool,
}

impl Meter {
    /// Drop cached progress so the next reading reloads stored usage, e.g.
    /// after a calibration or a change to the accounting settings.
    pub fn invalidate(&mut self) {
        self.usage = None;
        self.persisted = None;
        self.saved = None;
        self.dirty = false;
    }

    pub fn current(&self, item: &ServerStateItem) -> Option<u64> {
        self.usage.as_ref().map(|u| used(u, item.traffic_type == "both"))
    }

    pub fn reload_if_changed(&mut self, db: &crate::db::DbPool, id: &str) -> rusqlite::Result<()> {
        if load(&db.lock().unwrap(), id)? != self.persisted {
            self.invalidate();
        }
        Ok(())
    }

    pub fn advance(&mut self, db: &crate::db::DbPool, item: &ServerStateItem, now: i64) -> rusqlite::Result<u64> {
        let current = period(now, item.traffic_reset_day);
        if self.usage.is_none() {
            self.persisted = load(&db.lock().unwrap(), &item.id)?;
            self.usage = Some(self.persisted.clone().unwrap_or_else(|| initial(item, current)));
        }
        let u = self.usage.as_mut().unwrap();
        let rolled = advance(u, item, current);
        self.dirty = true;
        if rolled || self.saved.map_or(true, |at| at.elapsed() >= SAVE_EVERY) {
            // Calibration can happen between two reports. Serialize the check
            // and save with administrative writes so stale totals cannot undo it.
            let conn = db.lock().unwrap();
            let stored = load(&conn, &item.id)?;
            if stored != self.persisted {
                *u = stored.unwrap_or_else(|| initial(item, current));
                advance(u, item, current);
            }
            save(&conn, &item.id, u)?;
            self.persisted = Some(u.clone());
            self.saved = Some(std::time::Instant::now());
            self.dirty = false;
        }
        Ok(used(u, item.traffic_type == "both"))
    }

    pub fn flush(&mut self, db: &crate::db::DbPool, id: &str) -> rusqlite::Result<()> {
        if let (true, Some(u)) = (self.dirty, self.usage.as_ref()) {
            let conn = db.lock().unwrap();
            if load(&conn, id)? != self.persisted {
                // A later calibration takes precedence over this connection's
                // old in-memory totals, including when it disconnects at once.
                drop(conn);
                self.invalidate();
                return Ok(());
            }
            save(&conn, id, u)?;
            self.persisted = Some(u.clone());
            self.dirty = false;
        }
        Ok(())
    }
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
    fn meter_saves_periodically_and_matches_direct_updates() {
        let db = crate::db::init_db(":memory:").unwrap();
        let now = 1793534400;
        let mut item = ServerStateItem {id:"m".into(),traffic_type:"both".into(),traffic_reset_day:1,..Default::default()};
        let mut meter = Meter::default();
        item.total_rx_bytes = 1_000; item.total_tx_bytes = 2_000;
        assert_eq!(meter.advance(&db, &item, now).unwrap(), 0);
        // In-memory progress between saves.
        item.total_rx_bytes += 300; item.total_tx_bytes += 700;
        assert_eq!(meter.advance(&db, &item, now + 1).unwrap(), 1_000);
        let stored = |db: &crate::db::DbPool| read(&db.lock().unwrap(), &item, now + 1);
        assert_eq!(stored(&db), 0, "the second reading stays in memory until the next save");
        meter.flush(&db, &item.id).unwrap();
        assert_eq!(stored(&db), 1_000);
        // A new connection that never saw the in-memory reading still counts it.
        let mut next = Meter::default();
        item.total_rx_bytes += 50; item.total_tx_bytes += 50;
        assert_eq!(next.advance(&db, &item, now + 2).unwrap(), 1_100);
    }

    #[test]
    fn heartbeats_advance_without_database_writes_between_saves() {
        let db = crate::db::init_db(":memory:").unwrap();
        let now = 1793534400;
        let mut item = ServerStateItem {id:"cached".into(),traffic_type:"both".into(),traffic_reset_day:1,..Default::default()};
        let mut meter = Meter::default();
        meter.advance(&db, &item, now).unwrap();
        let changes = db.lock().unwrap().total_changes();
        for n in 1..=100 {
            item.total_rx_bytes = n;
            item.total_tx_bytes = n * 2;
            assert_eq!(meter.advance(&db, &item, now).unwrap(), n * 3);
        }
        assert_eq!(db.lock().unwrap().total_changes(), changes);
        meter.saved = Some(std::time::Instant::now() - SAVE_EVERY);
        assert_eq!(meter.advance(&db, &item, now).unwrap(), 300);
        assert_eq!(db.lock().unwrap().total_changes(), changes + 1);
        assert_eq!(read(&db.lock().unwrap(), &item, now), 300);
    }

    #[test]
    fn calibration_is_not_overwritten_by_disconnect_or_scheduled_save() {
        let db = crate::db::init_db(":memory:").unwrap();
        let now = 1793534400;
        let mut item = ServerStateItem {id:"calibration".into(),traffic_type:"both".into(),traffic_reset_day:1,..Default::default()};
        let mut meter = Meter::default();
        meter.advance(&db, &item, now).unwrap();
        item.total_tx_bytes = 100;
        meter.advance(&db, &item, now + 1).unwrap();
        calibrate(&db.lock().unwrap(), &item.id, 10.0, 1, Some((0, 100)), now + 1).unwrap();
        meter.flush(&db, &item.id).unwrap();
        assert_eq!(read(&db.lock().unwrap(), &item, now + 1), (10.0 * GIB) as u64);
        item.total_tx_bytes = 150;
        assert_eq!(meter.advance(&db, &item, now + 2).unwrap(), (10.0 * GIB) as u64 + 50);

        // A calibration can also arrive just before the periodic save.
        calibrate(&db.lock().unwrap(), &item.id, 20.0, 1, Some((0, 150)), now + 2).unwrap();
        meter.saved = Some(std::time::Instant::now() - SAVE_EVERY);
        item.total_tx_bytes = 200;
        assert_eq!(meter.advance(&db, &item, now + 3).unwrap(), (20.0 * GIB) as u64 + 50);
        assert_eq!(read(&db.lock().unwrap(), &item, now + 3), (20.0 * GIB) as u64 + 50);
    }

    #[test]
    fn repeated_calibration_with_the_same_value_and_timestamp_reloads_its_baseline() {
        let db = crate::db::init_db(":memory:").unwrap();
        let now = 1793534400;
        let mut item = ServerStateItem {id:"repeat".into(),traffic_type:"outbound".into(),traffic_reset_day:1,..Default::default()};
        let mut meter = Meter::default();
        calibrate(&db.lock().unwrap(), &item.id, 10.0, 1, Some((0, 0)), now).unwrap();
        meter.advance(&db, &item, now).unwrap();
        item.total_tx_bytes = 100;
        assert_eq!(meter.advance(&db, &item, now).unwrap(), (10.0 * GIB) as u64 + 100);
        calibrate(&db.lock().unwrap(), &item.id, 10.0, 1, Some((0, 100)), now).unwrap();
        meter.reload_if_changed(&db, &item.id).unwrap();
        item.total_tx_bytes = 150;
        assert_eq!(meter.advance(&db, &item, now).unwrap(), (10.0 * GIB) as u64 + 50);
    }

    #[test]
    fn reconnect_recovers_unsaved_counter_progress_and_rollover_resets_it() {
        let db = crate::db::init_db(":memory:").unwrap();
        let now = 1793534400;
        let mut item = ServerStateItem {id:"reconnect".into(),traffic_type:"outbound".into(),traffic_reset_day:1,..Default::default()};
        let mut first = Meter::default();
        first.advance(&db, &item, now).unwrap();
        item.total_rx_bytes = 100;
        item.total_tx_bytes = 200;
        assert_eq!(first.advance(&db, &item, now + 1).unwrap(), 200);
        let mut next = Meter::default();
        item.total_tx_bytes += 10;
        assert_eq!(next.advance(&db, &item, now + 2).unwrap(), 210);
        item.traffic_type = "both".into();
        assert_eq!(next.advance(&db, &item, now + 3).unwrap(), 310);
        assert_eq!(next.advance(&db, &item, now + 32 * 86400).unwrap(), 0);
        assert_eq!(read(&db.lock().unwrap(), &item, now + 32 * 86400), 0);
    }

    #[test]
    fn failed_save_preserves_in_memory_counter_resets_for_retry() {
        let db = crate::db::init_db(":memory:").unwrap();
        let now = 1793534400;
        let mut item = ServerStateItem {id:"retry".into(),traffic_type:"both".into(),traffic_reset_day:1,total_rx_bytes:1000,total_tx_bytes:2000,..Default::default()};
        let mut meter = Meter::default();
        meter.advance(&db, &item, now).unwrap();
        item.total_rx_bytes += 100;
        item.total_tx_bytes += 200;
        assert_eq!(meter.advance(&db, &item, now + 1).unwrap(), 300);
        db.lock().unwrap().execute_batch("CREATE TRIGGER reject_usage BEFORE INSERT ON traffic_usage BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        item.total_rx_bytes = 10;
        item.total_tx_bytes = 20;
        meter.saved = Some(std::time::Instant::now() - SAVE_EVERY);
        assert!(meter.advance(&db, &item, now + 2).is_err());
        assert_eq!(meter.current(&item), Some(330));
        db.lock().unwrap().execute_batch("DROP TRIGGER reject_usage;").unwrap();
        item.total_tx_bytes += 5;
        assert_eq!(meter.advance(&db, &item, now + 3).unwrap(), 335);
        assert_eq!(read(&db.lock().unwrap(), &item, now + 3), 335);
    }

    #[test]
    fn reset_day_31_clamps_to_february_and_uses_timezone() {
        let ts=chrono::DateTime::parse_from_rfc3339("2024-02-29T00:00:00+08:00").unwrap().timestamp();
        assert_eq!(period_at(ts,31,8*3600),ts);
        assert!(period_at(ts-1,31,8*3600)<ts-86400);
    }
}
