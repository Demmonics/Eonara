//! Read-only self-provenance. Never accepts a target PID or filesystem path.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    process_id: u32,
    app_version: &'static str,
    source_commit: &'static str,
    source_dirty_at_build: &'static str,
    executable_path: String,
    executable_sha256: String,
    executable_bytes: u64,
    note: &'static str,
}

fn own_identity() -> Result<Diagnostics, String> {
    let path = std::env::current_exe().map_err(|_| "Could not identify the running executable.")?;
    let mut file = File::open(&path).map_err(|_| "Could not read the running executable.")?;
    let size = file
        .metadata()
        .map_err(|_| "Could not inspect executable size.")?
        .len();
    if size > 128 * 1024 * 1024 {
        return Err("Self-provenance input exceeds the 128 MiB bound.".into());
    }
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "Could not hash the running executable.")?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(Diagnostics {
        process_id: std::process::id(),
        app_version: env!("CARGO_PKG_VERSION"),
        source_commit: option_env!("EONARA_SOURCE_COMMIT").unwrap_or("unknown"),
        source_dirty_at_build: option_env!("EONARA_SOURCE_DIRTY").unwrap_or("unknown"),
        executable_path: path.to_string_lossy().into_owned(),
        executable_sha256: format!("{:x}", hash.finalize()),
        executable_bytes: size,
        note: "File identity at query time; not a signature or attestation of in-memory pages.",
    })
}

#[tauri::command]
pub async fn native_diagnostics() -> Result<Diagnostics, String> {
    tauri::async_runtime::spawn_blocking(own_identity)
        .await
        .map_err(|_| "The provenance worker did not finish.".to_string())?
}

/// WebView2's document.hidden can remain false after a native hide. Report the
/// actual window state rather than relying on browser page visibility.
#[tauri::command]
pub fn native_window_visible(window: tauri::WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
}
