//! Expensive public history reads never borrow the heartbeat writer connection.
use std::{collections::HashMap, sync::{Arc, Mutex}, time::{Duration, Instant}};
use axum::{http::StatusCode, Json};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

#[derive(Clone)]
pub struct HistoryReader {
    path: Option<String>,
    fallback: super::db::DbPool,
    permits: Arc<tokio::sync::Semaphore>,
    cache: Arc<Mutex<HashMap<String, (Instant, Value)>>>,
    flights: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl HistoryReader {
    pub fn new(db: super::db::DbPool) -> Self {
        let path = db.lock().unwrap().path().filter(|p| !p.is_empty()).map(str::to_owned);
        Self { path, fallback: db, permits: Arc::new(tokio::sync::Semaphore::new(2)), cache: Arc::new(Mutex::new(HashMap::new())), flights:Arc::new(Mutex::new(HashMap::new())) }
    }

    fn cached(&self, key: &str) -> Option<Value> {
        self.cache.lock().unwrap().get(key).filter(|(at, _)| at.elapsed() < Duration::from_secs(30)).map(|(_, value)| value.clone())
    }

    pub async fn query<F>(&self, key: String, read: F) -> Result<Json<Value>, StatusCode>
    where F: FnOnce(&Connection) -> rusqlite::Result<Value> + Send + 'static {
        if let Some(value) = self.cached(&key) { return Ok(Json(value)); }
        let flight = {
            let mut flights=self.flights.lock().unwrap();
            flights.retain(|_, flight| Arc::strong_count(flight)>1);
            flights.entry(key.clone()).or_insert_with(||Arc::new(tokio::sync::Mutex::new(()))).clone()
        };
        let _flight=tokio::time::timeout(Duration::from_secs(8),flight.lock()).await.map_err(|_|StatusCode::TOO_MANY_REQUESTS)?;
        if let Some(value) = self.cached(&key) { return Ok(Json(value)); }
        let permit = tokio::time::timeout(Duration::from_secs(8), self.permits.clone().acquire_owned()).await
            .map_err(|_| StatusCode::TOO_MANY_REQUESTS)?.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        // Recheck after queuing: concurrent requests for the same window reuse a result.
        if let Some(value) = self.cached(&key) { return Ok(Json(value)); }
        let path = self.path.clone();
        let db = self.fallback.clone();
        let value = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            if let Some(path) = path {
                let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
                conn.busy_timeout(Duration::from_secs(2))?;
                let start = Instant::now();
                conn.progress_handler(20_000, Some(move || start.elapsed() > Duration::from_secs(6)));
                read(&conn)
            } else {
                // Only in-memory unit-test databases share a connection.
                read(&db.lock().unwrap())
            }
        }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .map_err(|error| { eprintln!("历史查询失败: {error}"); StatusCode::SERVICE_UNAVAILABLE })?;
        let mut cache = self.cache.lock().unwrap();
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(30));
        if cache.len() >= 16 { cache.clear(); }
        cache.insert(key, (Instant::now(), value.clone()));
        Ok(Json(value))
    }
}

pub fn window(hours: Option<i64>, bucket: Option<i64>) -> (i64, i64) {
    let hours = hours.unwrap_or(24).clamp(1, 720);
    // At most 480 points per series, regardless of an anonymous caller's bucket.
    (hours, bucket.unwrap_or(300).clamp(30, 86400).max((hours * 3600 + 479) / 480))
}
