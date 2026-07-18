use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceConnection {
    base_url: String,
    token: String,
}

#[derive(Deserialize)]
struct ReadyEvent {
    event: String,
    port: u16,
}

#[derive(Default)]
struct ServiceState {
    child: Mutex<Option<CommandChild>>,
    connection: RwLock<Option<ServiceConnection>>,
    token: String,
}

impl ServiceState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            connection: RwLock::new(None),
            token: Uuid::new_v4().simple().to_string(),
        }
    }
}

#[tauri::command]
fn service_connection(state: State<'_, ServiceState>) -> Result<ServiceConnection, String> {
    state
        .connection
        .read()
        .map_err(|_| "No se pudo leer el estado del servicio".to_string())?
        .clone()
        .ok_or_else(|| "El servicio local todavía no está disponible".to_string())
}

#[cfg(not(debug_assertions))]
fn start_service(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let database_path: PathBuf = data_dir.join("orivue.sqlite");
    let token = app.state::<ServiceState>().token.clone();

    let sidecar = app
        .shell()
        .sidecar("orivue-service")?
        .env("ORIVUE_HOST", "127.0.0.1")
        .env("ORIVUE_PORT", "0")
        .env("ORIVUE_LOCAL_TOKEN", &token)
        .env("ORIVUE_DATA_DIR", data_dir.as_os_str())
        .env("ORIVUE_DB_PATH", database_path.as_os_str());

    let (mut events, child) = sidecar.spawn()?;
    app.state::<ServiceState>()
        .child
        .lock()
        .map_err(|_| "No se pudo guardar el proceso del servicio")?
        .replace(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let Ok(line) = std::str::from_utf8(&bytes) else {
                        continue;
                    };
                    let Ok(ready) = serde_json::from_str::<ReadyEvent>(line.trim()) else {
                        continue;
                    };
                    if ready.event != "ready" || ready.port == 0 {
                        continue;
                    }

                    if let Ok(mut connection) = app_handle
                        .state::<ServiceState>()
                        .connection
                        .write()
                    {
                        connection.replace(ServiceConnection {
                            base_url: format!("http://127.0.0.1:{}", ready.port),
                            token: token.clone(),
                        });
                    }
                    let _ = app_handle.emit("orivue-service-status", "ready");
                }
                CommandEvent::Terminated(_) => {
                    if let Ok(mut connection) = app_handle
                        .state::<ServiceState>()
                        .connection
                        .write()
                    {
                        connection.take();
                    }
                    let _ = app_handle.emit("orivue-service-status", "stopped");
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg(debug_assertions)]
fn start_service(_app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn stop_service(app: &tauri::AppHandle) {
    let state = app.state::<ServiceState>();
    if let Ok(mut child) = state.child.lock() {
        if let Some(mut child) = child.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut connection) = state.connection.write() {
        connection.take();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServiceState::new())
        .invoke_handler(tauri::generate_handler![service_connection])
        .setup(|app| {
            start_service(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no se pudo construir Orivue");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_service(app_handle);
        }
    });
}
