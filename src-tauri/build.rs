fn main() {
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
        ]),
    ))
    .expect("could not generate Tauri application metadata");
}
