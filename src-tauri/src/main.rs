#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod diagnostics;
mod media;
mod overlay;
mod settings;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const RECOVERY_SHORTCUT: &str = "Ctrl+Alt+Shift+L";

fn main() {
    tauri::Builder::default()
        .manage(media::Media::default())
        .manage(overlay::Overlay::default())
        .manage(settings::Settings::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        overlay::recover(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Eonara", true, None::<&str>)?;
            let toggle =
                MenuItem::with_id(app, "toggle", "Show / Hide Overlay", true, None::<&str>)?;
            let recovery = MenuItem::with_id(
                app,
                "recover",
                "Restore Click-through / Hide",
                true,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &toggle, &recovery, &separator, &quit])?;
            TrayIconBuilder::with_id("eonara")
                .icon(tray_icon())
                .tooltip("Eonara")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("native_visibility", true);
                        }
                    }
                    "toggle" => overlay::toggle(app),
                    "recover" => overlay::recover(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            let registered = app.global_shortcut().register(RECOVERY_SHORTCUT).is_ok();
            overlay::set_shortcut_available(app.handle(), registered);
            overlay::initialize(app.handle());
            media::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if window.hide().is_ok() {
                        let _ = window.emit("native_visibility", false);
                        api.prevent_close();
                    }
                } else if matches!(event, WindowEvent::Resized(_) | WindowEvent::Focused(_)) {
                    let visible = window.is_visible().unwrap_or(false)
                        && !window.is_minimized().unwrap_or(false);
                    let _ = window.emit("native_visibility", visible);
                }
            } else if window.label() == "overlay"
                && matches!(event, WindowEvent::ScaleFactorChanged { .. })
            {
                overlay::reapply_placement(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            diagnostics::native_diagnostics,
            diagnostics::native_window_visible,
            media::media_snapshot,
            media::media_artwork,
            media::media_select,
            media::media_refresh,
            overlay::overlay_show,
            overlay::overlay_hide,
            overlay::overlay_click_through,
            overlay::overlay_configure,
            overlay::overlay_state,
            settings::get_settings,
            settings::save_settings,
        ])
        .build(tauri::generate_context!())
        .expect("could not start Eonara")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                media::stop(app);
            }
        });
}

fn tray_icon() -> Image<'static> {
    Image::new_owned(include_bytes!("../icons/tray-32x32.rgba").to_vec(), 32, 32)
}
