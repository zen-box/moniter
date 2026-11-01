use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// 内嵌的官方默认主题文件 (单二进制分发保障)
pub const EMBEDDED_HTML: &str = include_str!("../../web/themes/default/index.html");
pub const EMBEDDED_CSS: &str = include_str!("../../web/themes/default/style.css");
pub const EMBEDDED_JS: &str = include_str!("../../web/themes/default/app.js");
pub const EMBEDDED_DATA_JS: &str = include_str!("../../web/themes/default/data.js");
pub const EMBEDDED_MAP_SVG: &str = include_str!("../../web/themes/default/world-map-paths.svg");

/// Third-party JavaScript runs in an opaque-origin iframe. The outer document
/// only bridges a bounded, theme-specific preferences store and hash navigation.
pub fn isolated_page(html: &str, id: &str, site_name: &str) -> String {
    let bridge = include_str!("theme_bridge.js");
    let prefix = format!("<base href=\"/themes/{id}/\"><script>{bridge}</script>");
    let mut document = crate::inject_site_name(html, site_name);
    let lower = document.to_ascii_lowercase();
    if let Some(start) = lower.find("<head").and_then(|start| lower[start..].find('>').map(|end| start + end + 1)) {
        document.insert_str(start, &prefix);
    } else { document.insert_str(0, &prefix); }
    crate::inject_site_name(
        &include_str!("theme_shell.html")
            .replace("__THEME_ID__", &crate::security::script_json(&id))
            .replace("__THEME_DOCUMENT__", &crate::security::script_json(&document)),
        site_name,
    )
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub preview: Option<String>,
    pub entry: String,
}

pub static MUTATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn scan_themes(themes_dir: &str) -> Vec<ThemeMeta> {
    let mut list = Vec::new();
    let path = Path::new(themes_dir);

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let sub_path = entry.path();
            if sub_path.is_dir() && !entry.file_type().is_ok_and(|kind|kind.is_symlink()) && crate::is_valid_theme_id(&entry.file_name().to_string_lossy()) {
                let json_path = sub_path.join("theme.json");
                if json_path.exists() {
                    if let Ok(content) = fs::read_to_string(json_path) {
                        if let Ok(meta) = serde_json::from_str::<ThemeMeta>(&content) {
                            list.push(meta);
                        }
                    }
                }
            }
        }
    }

    list.retain(|meta|meta.id!="default");
    list.sort_by(|a,b|a.name.cmp(&b.name));
    list.insert(0,ThemeMeta {id:"default".into(),name:"Moniter".into(),version:env!("CARGO_PKG_VERSION").into(),author:"Moniter".into(),description:"内置监控主题".into(),preview:None,entry:"index.html".into()});

    list
}
