#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod media;
mod overlay;
mod settings;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
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
            let open = MenuItem::with_id(app, "open", "Open LyricMotion", true, None::<&str>)?;
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
            TrayIconBuilder::with_id("lyricmotion")
                .icon(tray_icon())
                .tooltip("LyricMotion")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
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
                        api.prevent_close();
                    }
                }
            } else if window.label() == "overlay"
                && matches!(event, WindowEvent::ScaleFactorChanged { .. })
            {
                overlay::reapply_placement(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
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
        .expect("could not start LyricMotion")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                media::stop(app);
            }
        });
}

fn tray_icon() -> Image<'static> {
    let mut rgba = vec![0; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let (dx, dy) = (x as i32 - 15, y as i32 - 15);
            if dx * dx + dy * dy < 211 {
                let color = if (x == 8 && (14..=20).contains(&y))
                    || ((11..=13).contains(&x) && (10..=23).contains(&y))
                    || ((16..=18).contains(&x) && (7..=25).contains(&y))
                    || ((21..=23).contains(&x) && (11..=21).contains(&y))
                {
                    [232, 220, 199, 255]
                } else {
                    [37, 33, 30, 255]
                };
                let i = (y * 32 + x) * 4;
                rgba[i..i + 4].copy_from_slice(&color);
            }
        }
    }
    Image::new_owned(rgba, 32, 32)
}
