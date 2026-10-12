//! Orivue application shell. The UI runs inside the webview; this crate only
//! provides what a webview cannot do on its own: a loopback media proxy,
//! bounded downloads without CORS, a durable key-value store and device
//! information. Everything is shared by desktop, Android, Fire TV and iOS.

mod epg;

use std::path::PathBuf;
use std::time::Duration;

use orivue_stream_proxy::{
    DestinationPolicy, FetchTextOptions, OpenSession, ProxyHandle, ProxyOptions, ProxyServer,
    SessionHeaders, SessionInfo,
};
use serde::{Deserialize, Serialize};
use tauri::{Manager, RunEvent, State};

const MAX_FETCH_BYTES: usize = 200 * 1024 * 1024;
/// Guides are streamed to disk and read incrementally, so the cap only
/// protects the disk, not memory.
const MAX_EPG_BYTES: usize = 2 * 1024 * 1024 * 1024;
const MAX_KV_BYTES: usize = 16 * 1024 * 1024;

struct AppState {
    proxy: ProxyHandle,
    kv_dir: PathBuf,
    cache_dir: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyInfo {
    base_url: String,
    token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    platform: &'static str,
    version: &'static str,
    mobile: bool,
    debug: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchEpgArgs {
    url: String,
    #[serde(default)]
    headers: SessionHeaders,
    since_ms: i64,
    until_ms: i64,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    allow_private: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchSourceArgs {
    url: String,
    #[serde(default)]
    headers: SessionHeaders,
    #[serde(default)]
    max_bytes: Option<usize>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    allow_private: bool,
}

#[tauri::command]
fn proxy_info(state: State<'_, AppState>) -> ProxyInfo {
    ProxyInfo {
        base_url: state.proxy.base_url().to_string(),
        token: state.proxy.token().to_string(),
    }
}

#[tauri::command]
fn device_info() -> DeviceInfo {
    DeviceInfo {
        platform: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
        mobile: cfg!(any(target_os = "android", target_os = "ios")),
        debug: cfg!(debug_assertions),
    }
}

/// Downloads a playlist, guide or JSON document and returns the raw bytes.
#[tauri::command]
async fn fetch_source(
    state: State<'_, AppState>,
    args: FetchSourceArgs,
) -> Result<tauri::ipc::Response, String> {
    let fetched = state
        .proxy
        .fetch_text(
            &args.url,
            FetchTextOptions {
                headers: args.headers,
                max_bytes: args
                    .max_bytes
                    .unwrap_or(MAX_FETCH_BYTES)
                    .min(MAX_FETCH_BYTES),
                timeout: Duration::from_millis(
                    args.timeout_ms.unwrap_or(60_000).clamp(1_000, 300_000),
                ),
                policy: if args.allow_private {
                    DestinationPolicy::AllowPrivate
                } else {
                    DestinationPolicy::PublicOnly
                },
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(fetched.text.into_bytes()))
}

/// Downloads an XMLTV guide to the cache directory and returns, as JSON, the
/// channel names and the programmes inside the window. The webview never
/// holds the document itself, so there is no practical size limit.
#[tauri::command]
async fn fetch_epg(
    state: State<'_, AppState>,
    args: FetchEpgArgs,
) -> Result<tauri::ipc::Response, String> {
    std::fs::create_dir_all(&state.cache_dir).map_err(|error| error.to_string())?;
    let path = state.cache_dir.join(format!(
        "epg-{}.xml",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let downloaded = state
        .proxy
        .fetch_to_file(
            &args.url,
            FetchTextOptions {
                headers: args.headers,
                max_bytes: MAX_EPG_BYTES,
                timeout: Duration::from_millis(
                    args.timeout_ms.unwrap_or(300_000).clamp(1_000, 1_800_000),
                ),
                policy: if args.allow_private {
                    DestinationPolicy::AllowPrivate
                } else {
                    DestinationPolicy::PublicOnly
                },
            },
            &path,
        )
        .await;
    let result = match downloaded {
        Ok(_) => {
            let window = epg::GuideWindow {
                since_ms: args.since_ms,
                until_ms: args.until_ms,
            };
            let parse_path = path.clone();
            tauri::async_runtime::spawn_blocking(move || epg::read_guide(&parse_path, &window))
                .await
                .map_err(|error| error.to_string())
                .and_then(|guide| guide)
                .and_then(|guide| serde_json::to_vec(&guide).map_err(|error| error.to_string()))
        }
        Err(error) => Err(error.to_string()),
    };
    let _ = std::fs::remove_file(&path);
    result.map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn open_playback(
    state: State<'_, AppState>,
    request: OpenSession,
) -> Result<SessionInfo, String> {
    // Only one playback session at a time: a channel change tears the previous one down.
    state.proxy.close_all();
    state
        .proxy
        .open(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn close_playback(state: State<'_, AppState>, id: String) -> bool {
    state.proxy.close(&id)
}

fn kv_path(state: &AppState, key: &str) -> Result<PathBuf, String> {
    if key.is_empty()
        || key.len() > 64
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("invalid key".into());
    }
    Ok(state.kv_dir.join(format!("{key}.json")))
}

#[tauri::command]
fn kv_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let path = kv_path(&state, &key)?;
    match std::fs::read_to_string(&path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn kv_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    if value.len() > MAX_KV_BYTES {
        return Err("value too large".into());
    }
    let path = kv_path(&state, &key)?;
    std::fs::create_dir_all(&state.kv_dir).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, value).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

#[tauri::command]
fn kv_delete(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let path = kv_path(&state, &key)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn proxy_options(dev: bool) -> ProxyOptions {
    let mut options = ProxyOptions::default();
    if !dev {
        options
            .allowed_origins
            .retain(|origin| origin.contains("tauri"));
    }
    options
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_orivue_native::init());
    let app = builder
        .invoke_handler(tauri::generate_handler![
            proxy_info,
            device_info,
            fetch_source,
            fetch_epg,
            open_playback,
            close_playback,
            kv_get,
            kv_set,
            kv_delete
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let cache_dir = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| data_dir.join("cache"));
            let proxy =
                tauri::async_runtime::block_on(ProxyServer::start(proxy_options(tauri::is_dev())))?;
            app.manage(AppState {
                proxy,
                kv_dir: data_dir.join("kv"),
                cache_dir,
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no se pudo construir Orivue");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.proxy.shutdown();
            }
        }
    });
}
