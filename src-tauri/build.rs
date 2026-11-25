fn main() {
    // Emit build provenance without copying account data or a source tree into the release.
    // Resolve the worktree-specific Git paths so a ref change refreshes these fields.
    for item in ["HEAD", "index", "refs/heads/refinement/native-motion"] {
        if let Ok(output) = std::process::Command::new("git").args(["rev-parse", "--git-path", item]).output() {
            if output.status.success() {
                println!("cargo:rerun-if-changed={}", String::from_utf8_lossy(&output.stdout).trim());
            }
        }
    }
    for (name, args) in [
        ("LYRICMOTION_SOURCE_COMMIT", vec!["rev-parse", "HEAD"]),
        ("LYRICMOTION_SOURCE_DIRTY", vec!["status", "--porcelain", "--untracked-files=no"]),
    ] {
        let value = std::process::Command::new("git").args(args).output().ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string());
        let value = if name.ends_with("_DIRTY") {
            value.map(|s| if s.is_empty() { "false".into() } else { "true".into() })
        } else { value };
        println!("cargo:rustc-env={name}={}", value.unwrap_or_else(|| "unknown".into()));
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "media_snapshot",
            "media_artwork",
            "media_select",
            "media_refresh",
            "overlay_show",
            "overlay_hide",
            "overlay_click_through",
            "overlay_configure",
            "overlay_state",
            "get_settings",
            "save_settings",
            "native_diagnostics",
            "native_window_visible",
        ]),
    ))
    .expect("could not generate Tauri application metadata");
}
