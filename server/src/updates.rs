use axum::{extract::State, routing::{get, post}, Json, Router};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::{Duration, Instant}};
use tokio::sync::{Mutex, RwLock};

use crate::AppContext;

const REPOSITORY: &str = "zen-box/moniter";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const COOLDOWN: Duration = Duration::from_secs(60);

#[derive(Clone, Serialize)]
pub struct UpdateStatus {
    current_version: &'static str,
    repository: &'static str,
    enabled: bool,
    latest_version: Option<String>,
    update_available: bool,
    release_url: Option<String>,
    checked_at: Option<i64>,
    last_attempt_at: Option<i64>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}

fn latest_server(releases: &[Release]) -> Option<Version> {
    releases.iter().filter(|release| !release.draft && !release.prerelease)
        .filter_map(|release| release.tag_name.strip_prefix('v'))
        .filter_map(|tag| Version::parse(tag).ok())
        .filter(|version| version.pre.is_empty() && version.build.is_empty())
        .max()
}

impl UpdateStatus {
    fn new(enabled: bool) -> Self {
        Self {
            current_version: CURRENT_VERSION, repository: REPOSITORY, enabled,
            latest_version: None, update_available: false, release_url: None,
            checked_at: None, last_attempt_at: None, error: None,
        }
    }

    fn apply(&mut self, result: Result<Option<Version>, String>, now: i64) {
        self.last_attempt_at = Some(now);
        match result {
            Ok(latest) => {
                self.update_available = latest.as_ref().is_some_and(|version|
                    version > &Version::parse(CURRENT_VERSION).expect("Cargo package version"));
                self.release_url = latest.as_ref().map(|version|
                    format!("https://github.com/{REPOSITORY}/releases/tag/v{version}"));
                self.latest_version = latest.map(|version| version.to_string());
                self.checked_at = Some(now);
                self.error = None;
            }
            Err(error) => self.error = Some(error), // Keep the last successful result.
        }
    }
}

struct Inner {
    status: RwLock<UpdateStatus>,
    attempt: Mutex<Option<Instant>>,
}

#[derive(Clone)]
pub struct UpdateChecker(Arc<Inner>);

impl UpdateChecker {
    pub fn new(enabled: bool) -> Self {
        Self(Arc::new(Inner {
            status: RwLock::new(UpdateStatus::new(enabled)),
            attempt: Mutex::new(None),
        }))
    }

    pub fn from_env() -> Self {
        let enabled = !std::env::var("MONITER_UPDATE_CHECK")
            .is_ok_and(|v| v == "0" || v.eq_ignore_ascii_case("false"));
        Self::new(enabled)
    }

    async fn status(&self) -> UpdateStatus { self.0.status.read().await.clone() }

    async fn check_with<F, Fut>(&self, fetch: F) -> UpdateStatus
    where F: FnOnce() -> Fut, Fut: std::future::Future<Output = Result<Option<Version>, String>> {
        // One in-flight request; concurrent/manual retries share its result.
        let mut attempt = self.0.attempt.lock().await;
        if !self.0.status.read().await.enabled
            || attempt.is_some_and(|time| time.elapsed() < COOLDOWN) {
            return self.status().await;
        }
        *attempt = Some(Instant::now());
        let result = fetch().await;
        let mut status = self.0.status.write().await;
        status.apply(result, chrono::Utc::now().timestamp());
        status.clone()
    }

    async fn check(&self) -> UpdateStatus {
        self.check_with(|| async {
            tokio::time::timeout(Duration::from_secs(15), fetch_latest()).await
                .map_err(|_| "network".to_string())?
        }).await
    }

    pub fn spawn(&self) {
        let checker = self.clone();
        tokio::spawn(async move {
            if !checker.status().await.enabled { return; }
            let mut interval = tokio::time::interval(INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop { interval.tick().await; checker.check().await; }
        });
    }
}

async fn fetch_latest() -> Result<Option<Version>, String> {
    let client = crate::security::github_client().map_err(|_| "network")?;
    let mut all = Vec::new();
    // Public repository only; no credentials or arbitrary user-supplied URLs.
    for page in 1..=5 {
        let response = client.get(format!("https://api.github.com/repos/{REPOSITORY}/releases"))
            .query(&[("per_page", 100), ("page", page)])
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", format!("Moniter/{CURRENT_VERSION}"))
            .send().await.map_err(|_| "network")?;
        if response.status() == reqwest::StatusCode::FORBIDDEN
            || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err("rate_limited".into());
        }
        if !response.status().is_success() { return Err("github_unavailable".into()); }
        let bytes = crate::security::read_limited(response, 4 * 1024 * 1024).await
            .map_err(|_| "invalid_response")?;
        let releases: Vec<Release> = serde_json::from_slice(&bytes).map_err(|_| "invalid_response")?;
        let complete = releases.len() < 100;
        all.extend(releases);
        if complete { return Ok(latest_server(&all)); }
    }
    Err("release_limit".into())
}

pub fn router() -> Router<AppContext> {
    Router::new()
        .route("/api/v1/admin/updates", get(status))
        .route("/api/v1/admin/updates/check", post(check))
}

async fn status(State(ctx): State<AppContext>) -> Json<UpdateStatus> { Json(ctx.updates.status().await) }
async fn check(State(ctx): State<AppContext>) -> Json<UpdateStatus> { Json(ctx.updates.check().await) }

#[cfg(test)]
mod tests {
    use super::*;
    fn releases(value: serde_json::Value) -> Vec<Release> { serde_json::from_value(value).unwrap() }

    #[test]
    fn selects_server_semver_and_ignores_agent_and_unstable_releases() {
        let input = releases(serde_json::json!([
            {"tag_name":"agent-v99.0.0","draft":false,"prerelease":false},
            {"tag_name":"v0.9.0","draft":false,"prerelease":false},
            {"tag_name":"v0.10.0","draft":false,"prerelease":false},
            {"tag_name":"v2.0.0","draft":true,"prerelease":false},
            {"tag_name":"v3.0.0","draft":false,"prerelease":true},
            {"tag_name":"v4.0.0-rc.1","draft":false,"prerelease":false},
            {"tag_name":"nonsense","draft":false,"prerelease":false}
        ]));
        assert_eq!(latest_server(&input).unwrap().to_string(), "0.10.0");
        assert!(latest_server(&[]).is_none());
    }

    #[test]
    fn failures_preserve_success_and_empty_repository_is_valid() {
        let mut status = UpdateStatus::new(true);
        status.apply(Ok(Some(Version::parse("0.2.0").unwrap())), 100);
        status.apply(Err("network".into()), 200);
        assert!(status.update_available);
        assert_eq!(status.checked_at, Some(100));
        assert_eq!(status.last_attempt_at, Some(200));
        status.apply(Ok(None), 300);
        assert!(status.error.is_none());
        assert!(!status.update_available);
        assert!(status.latest_version.is_none());
        status.apply(Ok(Some(Version::parse(CURRENT_VERSION).unwrap())), 400);
        assert!(!status.update_available);
    }

    #[tokio::test]
    async fn checks_are_coalesced_and_disabled_mode_never_fetches() {
        let checker = UpdateChecker::new(true);
        let (a, b) = tokio::join!(
            checker.check_with(|| async { tokio::task::yield_now().await; Ok(Some(Version::new(0, 2, 0))) }),
            checker.check_with(|| async { panic!("duplicate fetch") })
        );
        assert_eq!(a.latest_version, b.latest_version);
        let status = UpdateChecker::new(false).check_with(|| async { panic!("disabled fetch") }).await;
        assert!(!status.enabled);
    }
}
