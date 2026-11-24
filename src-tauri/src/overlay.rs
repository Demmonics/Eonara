use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const LABEL: &str = "overlay";

#[derive(Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum Position {
    Preset(PositionPreset),
    Normalized { x: f64, y: f64 },
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PositionPreset {
    Center,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum Size {
    Preset(SizePreset),
    Logical { width: f64, height: f64 },
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SizePreset {
    Compact,
    Medium,
    Large,
    Fullscreen,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Display {
    id: String,
    name: String,
    primary: bool,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    visible: bool,
    click_through: bool,
    shortcut_available: bool,
    shortcut: &'static str,
    monitor: String,
    resolved_monitor: Option<String>,
    monitors: Vec<Display>,
    position: Position,
    size: Size,
    mode: &'static str,
    error: Option<String>,
}

impl Default for OverlayState {
    fn default() -> Self {
        Self {
            visible: false,
            click_through: true,
            shortcut_available: false,
            shortcut: crate::RECOVERY_SHORTCUT,
            monitor: "primary".into(),
            resolved_monitor: None,
            monitors: Vec::new(),
            position: Position::Preset(PositionPreset::Bottom),
            size: Size::Preset(SizePreset::Medium),
            mode: "always-on-top",
            error: None,
        }
    }
}

#[derive(Default)]
pub struct Overlay(Mutex<OverlayState>);

fn overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| "The overlay window is unavailable.".into())
}

pub fn initialize(app: &AppHandle) {
    let result =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?overlay=1".into()))
            .title("LyricMotion Overlay")
            .inner_size(760.0, 260.0)
            .visible(false)
            .focused(false)
            .focusable(false)
            .resizable(false)
            .transparent(true)
            .background_color(tauri::window::Color(0, 0, 0, 0))
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .disable_drag_drop_handler()
            .devtools(false)
            .build()
            .map_err(|_| "Could not create the transparent overlay.".to_string())
            .and_then(|window| apply_platform(&window, &mut OverlayState::default()));
    if let Err(err) = result {
        let state = app.state::<Overlay>();
        if let Ok(mut state) = state.0.lock() {
            state.error = Some(err);
        };
    }
}

pub fn set_shortcut_available(app: &AppHandle, registered: bool) {
    let state = app.state::<Overlay>();
    if let Ok(mut state) = state.0.lock() {
        state.shortcut_available = registered;
    };
}

fn monitor_id(monitor: &Monitor, index: usize) -> String {
    monitor
        .name()
        .filter(|name| !name.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("display-{index}"))
}

fn enumerate(window: &WebviewWindow, state: &mut OverlayState) -> Result<Monitor, String> {
    let primary = window.primary_monitor().ok().flatten();
    let is_primary = |m: &Monitor| {
        primary
            .as_ref()
            .is_some_and(|p| p.position() == m.position() && p.size() == m.size())
    };
    let mut monitors = window
        .available_monitors()
        .map_err(|_| "Could not enumerate displays.")?;
    if monitors.is_empty() {
        monitors.extend(primary.clone());
    }
    state.monitors = monitors
        .iter()
        .enumerate()
        .map(|(i, m)| Display {
            id: monitor_id(m, i),
            name: m
                .name()
                .filter(|name| !name.is_empty())
                .cloned()
                .unwrap_or_else(|| format!("Display {}", i + 1)),
            primary: is_primary(m),
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
        })
        .collect();
    let index = if state.monitor == "primary" {
        None
    } else {
        state.monitors.iter().position(|m| m.id == state.monitor)
    }
    .or_else(|| state.monitors.iter().position(|m| m.primary))
    .unwrap_or(0);
    state.resolved_monitor = state.monitors.get(index).map(|m| m.id.clone());
    monitors
        .into_iter()
        .nth(index)
        .ok_or_else(|| "No display is available for the overlay.".into())
}

fn geometry(monitor: &Monitor, position: &Position, size: &Size) -> (i32, i32, i32, i32) {
    let work = monitor.work_area();
    let scale = monitor.scale_factor();
    let (full_w, full_h) = (work.size.width as f64, work.size.height as f64);
    let (width, height) = match size {
        Size::Preset(SizePreset::Fullscreen) => (full_w, full_h),
        Size::Preset(SizePreset::Compact) => (480.0 * scale, 160.0 * scale),
        Size::Preset(SizePreset::Medium) => (760.0 * scale, 260.0 * scale),
        Size::Preset(SizePreset::Large) => (1050.0 * scale, 400.0 * scale),
        Size::Logical { width, height } => (*width * scale, *height * scale),
    };
    let (width, height) = (width.min(full_w).round(), height.min(full_h).round());
    let (x, y) = match position {
        Position::Preset(PositionPreset::Center) => (0.5, 0.5),
        Position::Preset(PositionPreset::Top) => (0.5, 0.06),
        Position::Preset(PositionPreset::Bottom) => (0.5, 0.92),
        Position::Preset(PositionPreset::TopLeft) => (0.035, 0.06),
        Position::Preset(PositionPreset::TopRight) => (0.965, 0.06),
        Position::Preset(PositionPreset::BottomLeft) => (0.035, 0.92),
        Position::Preset(PositionPreset::BottomRight) => (0.965, 0.92),
        Position::Normalized { x, y } => (*x, *y),
    };
    (
        work.position
            .x
            .saturating_add(((full_w - width) * x).round() as i32),
        work.position
            .y
            .saturating_add(((full_h - height) * y).round() as i32),
        width as i32,
        height as i32,
    )
}

#[cfg(windows)]
fn apply_platform(window: &WebviewWindow, state: &mut OverlayState) -> Result<(), String> {
    use windows::Win32::{
        Foundation::{GetLastError, SetLastError, ERROR_SUCCESS, HWND},
        UI::WindowsAndMessaging::{
            GetWindowLongW, IsWindowVisible, SetWindowLongW, SetWindowPos, GWL_EXSTYLE,
            HWND_TOPMOST, SWP_FRAMECHANGED, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SWP_NOZORDER, SWP_SHOWWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
            WS_EX_TRANSPARENT,
        },
    };
    let hwnd = HWND(
        window
            .hwnd()
            .map_err(|_| "No overlay window handle is available.")?
            .0,
    );

    // Hide first on recovery so an error changing styles cannot leave an input-blocking window.
    if !state.visible {
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            )
        }
        .map_err(|_| "Could not hide the overlay.")?;
    }
    let pass_through = (WS_EX_LAYERED | WS_EX_TRANSPARENT).0;
    let required = (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW).0;
    let styles = unsafe {
        let old = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let styles =
            (old & !pass_through) | required | if state.click_through { pass_through } else { 0 };
        if styles != old {
            SetLastError(ERROR_SUCCESS);
            if SetWindowLongW(hwnd, GWL_EXSTYLE, styles as i32) == 0
                && GetLastError() != ERROR_SUCCESS
            {
                return Err("Could not apply the overlay's input mode.".into());
            }
        }
        GetWindowLongW(hwnd, GWL_EXSTYLE) as u32
    };
    if (styles & (required | pass_through))
        != (required | if state.click_through { pass_through } else { 0 })
    {
        return Err("Windows did not accept the overlay's input mode.".into());
    }
    let monitor = match enumerate(window, state) {
        Ok(monitor) => monitor,
        Err(_) if !state.visible => return Ok(()),
        Err(err) => return Err(err),
    };
    let (x, y, w, h) = geometry(&monitor, &state.position, &state.size);
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            x,
            y,
            w,
            h,
            SWP_NOACTIVATE
                | SWP_FRAMECHANGED
                | if state.visible {
                    SWP_SHOWWINDOW
                } else {
                    SWP_HIDEWINDOW
                },
        )
    }
    .map_err(|_| "Could not place the overlay.")?;
    if unsafe { IsWindowVisible(hwnd).as_bool() } != state.visible {
        return Err("Windows did not accept the overlay visibility change.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_platform(_: &WebviewWindow, _: &mut OverlayState) -> Result<(), String> {
    Err("The passive overlay is only supported on Windows.".into())
}

fn update(app: &AppHandle, change: impl FnOnce(&mut OverlayState)) -> Result<OverlayState, String> {
    let state = app.state::<Overlay>();
    let mut previous = state
        .0
        .lock()
        .map_err(|_| "Overlay state is unavailable.")?;
    let mut next = previous.clone();
    change(&mut next);
    let window = overlay_window(app)?;
    match apply_platform(&window, &mut next) {
        Ok(()) => {
            next.error = None;
            *previous = next.clone();
            drop(previous);
            let _ = app.emit("overlay_state", &next);
            Ok(next)
        }
        Err(err) => {
            // If we cannot confirm the requested atomic state, fail closed.
            previous.visible = false;
            previous.click_through = true;
            let _ = apply_platform(&window, &mut previous);
            previous.error = Some(err.clone());
            let payload = previous.clone();
            drop(previous);
            let _ = app.emit("overlay_state", &payload);
            Err(err)
        }
    }
}

async fn dispatch(
    app: AppHandle,
    change: impl FnOnce(&mut OverlayState) + Send + 'static,
) -> Result<OverlayState, String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let copy = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.try_send(update(&copy, change));
    })
    .map_err(|_| "Could not access the overlay window thread.")?;
    rx.recv()
        .await
        .ok_or_else(|| "The overlay window thread is unavailable.".to_string())?
}

pub fn toggle(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = dispatch(app, |state| state.visible = !state.visible).await;
    });
}

pub fn recover(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = dispatch(app, |state| {
            state.visible = false;
            state.click_through = true;
        })
        .await;
    });
}

pub fn reapply_placement(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = dispatch(app, |_| {}).await;
    });
}

#[tauri::command]
pub fn overlay_state(app: AppHandle) -> Result<OverlayState, String> {
    let state = app.state::<Overlay>();
    let mut result = state
        .0
        .lock()
        .map_err(|_| "Overlay state is unavailable.")?
        .clone();
    if let Ok(window) = overlay_window(&app) {
        let _ = enumerate(&window, &mut result);
    }
    Ok(result)
}

#[tauri::command]
pub async fn overlay_show(app: AppHandle) -> Result<OverlayState, String> {
    dispatch(app, |state| state.visible = true).await
}

#[tauri::command]
pub async fn overlay_hide(app: AppHandle) -> Result<OverlayState, String> {
    dispatch(app, |state| state.visible = false).await
}

#[tauri::command]
pub async fn overlay_click_through(app: AppHandle, enabled: bool) -> Result<OverlayState, String> {
    dispatch(app, move |state| state.click_through = enabled).await
}

#[tauri::command]
pub async fn overlay_configure(
    app: AppHandle,
    monitor: Option<String>,
    position: Option<Position>,
    size: Option<Size>,
    mode: Option<String>,
) -> Result<OverlayState, String> {
    if monitor
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 256)
    {
        return Err("The monitor must be an ID from overlay_state.".into());
    }
    if let Some(Position::Normalized { x, y }) = position.as_ref() {
        if !(0.0..=1.0).contains(x) || !(0.0..=1.0).contains(y) {
            return Err("Overlay position coordinates must be between 0 and 1.".into());
        }
    }
    if let Some(Size::Logical { width, height }) = size.as_ref() {
        if !(120.0..=12_000.0).contains(width) || !(60.0..=8_000.0).contains(height) {
            return Err("Overlay size is outside the supported range.".into());
        }
    }
    if mode.as_deref().is_some_and(|mode| mode != "always-on-top") {
        return Err("Only the always-on-top overlay mode is currently supported.".into());
    }
    dispatch(app, move |state| {
        if let Some(monitor) = monitor {
            state.monitor = monitor;
        }
        if let Some(position) = position {
            state.position = position;
        }
        if let Some(size) = size {
            state.size = size;
        }
    })
    .await
}
