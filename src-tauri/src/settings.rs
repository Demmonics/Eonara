use serde_json::{Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};

const MAX_BYTES: u64 = 128 * 1024;
const MAX_DEPTH: usize = 16;
const MAX_NODES: usize = 8192;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct Settings(Mutex<()>);

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("settings-v1.json"))
        .map_err(|_| "The application settings location is unavailable.".into())
}

fn valid_settings(settings: &Value) -> bool {
    fn validate(value: &Value, depth: usize, nodes: &mut usize) -> bool {
        *nodes += 1;
        if depth > MAX_DEPTH || *nodes > MAX_NODES {
            return false;
        }
        match value {
            Value::Array(values) => values.iter().all(|v| validate(v, depth + 1, nodes)),
            Value::Object(values) => values.iter().all(|(k, v)| {
                k.len() <= 256
                    && !matches!(k.as_str(), "__proto__" | "prototype" | "constructor")
                    && validate(v, depth + 1, nodes)
            }),
            _ => true,
        }
    }
    settings.is_object() && validate(settings, 0, &mut 0)
}

fn read(path: &Path) -> Result<Value, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Value::Object(Map::new()))
        }
        Err(_) => return Err("Could not read Eonara settings.".into()),
    };
    let mut content = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut content)
        .map_err(|_| "Could not read Eonara settings.")?;
    if content.len() as u64 <= MAX_BYTES {
        if let Ok(value) = serde_json::from_slice(&content) {
            if valid_settings(&value) {
                return Ok(value);
            }
        }
    }
    Err("Eonara settings are invalid or too large.".into())
}

fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let result = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    let result = result.and_then(|_| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = app.state::<Settings>();
        let _lock = settings.0.lock().map_err(|_| "Settings are unavailable.")?;
        read(&settings_path(&app)?)
    })
    .await
    .map_err(|_| "Settings worker is unavailable.")?
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !valid_settings(&settings) {
            return Err("Settings must be a bounded JSON object.".into());
        }
        let bytes = serde_json::to_vec(&settings).map_err(|_| "Settings are invalid.")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Settings are larger than 128 KiB.".into());
        }
        let state = app.state::<Settings>();
        let _lock = state.0.lock().map_err(|_| "Settings are unavailable.")?;
        write(&settings_path(&app)?, &bytes).map_err(|_| "Could not save Eonara settings.")?;
        let _ = app.emit("settings_changed", &settings);
        Ok(())
    })
    .await
    .map_err(|_| "Settings worker is unavailable.")?
}

#[cfg(test)]
mod tests {
    use super::valid_settings;
    use serde_json::json;

    #[test]
    fn accepts_normal_settings_and_rejects_invalid_shape() {
        assert!(valid_settings(
            &json!({ "style": "ship", "pins": ["ship"] })
        ));
        assert!(!valid_settings(&json!({ "nested": {"__proto__": "bad"} })));
        assert!(!valid_settings(&json!([1, 2])));
        assert!(!valid_settings(&json!(null)));
    }
}
