# Eonara native host

Tauri 2 serves the Vite renderer at `http://localhost:5173` in dev and bundles `../dist` for a production build. The hidden overlay opens the same renderer at `index.html?overlay=1` and does **not** show on initial launch. Settings and playback integration require the Tauri host; a standalone browser has no access to GSMTC.

## IPC contract

All native commands use `invoke` from `@tauri-apps/api/core`. Listen using `listen` from `@tauri-apps/api/event`; on startup subscribe first, then fetch the initial state. `media_changed`, `overlay_state`, and `settings_changed` payloads are the complete new state.

| Command | Argument object | Result |
| --- | --- | --- |
| `media_snapshot` | — | `{ sessions, activeId: string \| null, revision: number, error?: string }` |
| `media_artwork` | `{ id: string }` | `{ dataUrl: string, hash: string } \| null`. Hash is lowercase SHA-256 of the original artwork bytes. |
| `media_select` | `{ id: string \| null }` | Requests a session override; `null` returns to automatic selection. Confirmation is the `media_changed` event or next snapshot. |
| `media_refresh` | — | Wakes the GSMTC worker to immediately re-enumerate. |
| `overlay_state` | — | `OverlayState` (below) |
| `overlay_show`, `overlay_hide` | — | `OverlayState` |
| `overlay_click_through` | `{ enabled: boolean }` | `OverlayState` |
| `overlay_configure` | `{ monitor?, position?, size?, mode? }` | `OverlayState`; all fields optional |
| `get_settings` | — | JSON object, `{}` if no settings have been saved |
| `save_settings` | `{ settings: object }` | Replaces the entire bounded JSON object and emits `settings_changed`. |

A `Session` is `{ id, source, title, artist, album, durationMs, positionMs, playing, rate, timelineValid, generation, artworkRevision }`. `source` is Windows' raw source-app identifier, not a verified website or account. IDs are opaque and valid for the current running host only. `generation` changes when title, artist or album changes in that session. `artworkRevision` changes when the native thumbnail reference is replaced; `0` means none is advertised. Guard async results with both the session ID and requested revision. Art only comes from `GSMTC.Thumbnail`; it is never downloaded from another service or written to disk. JPEG/PNG are limited to 2 MiB and 8 MP with a 4096 px dimension cap.

`positionMs` is a renderer-facing monotonic-anchored sample clamped to the session duration. Ignore it if `timelineValid` is false. Extrapolate from arrival with `performance.now()` and `rate` only when `playing` and `timelineValid`; handle seeks by replacing the anchor. This first slice does not compensate for playback device or IPC latency. `media_changed` fires when the session/track/art/clock anchor changes, not on every progression tick. `revision` can prevent reordering between an event and the response to an initial snapshot.

`OverlayState` contains `visible`, `clickThrough`, `shortcutAvailable`, `shortcut`, `monitor`, `resolvedMonitor`, `monitors`, `position`, `size`, `mode`, and `error`. `monitors` contains `{ id, name, primary, x, y, width, height, scaleFactor }` (physical coordinates). Use `"primary"` or an `id` from `monitors`; missing displays fall back to primary. `position` accepts `"center"`, `"top"`, `"bottom"`, `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`, or `{x,y}` normalized in `[0,1]` over the free working area. `size` accepts `"compact"`, `"medium"`, `"large"`, `"fullscreen"` (work area, excluding taskbar), or `{width,height}` in device-independent pixels. Only `"always-on-top"` mode is implemented. The main window may write state; the overlay capabilities are read-only. Frontend should stop drawing when `visible` is false.

The tray's **Restore Click-through / Hide** and **Ctrl+Alt+Shift+L** (if registered) restore click-through and hide the overlay. Main-window close hides to tray; **Quit** exits. The host verifies no-activation/tool-window and layered+transparent styles, and uses the Win32 no-activate placement flag. That is not a substitute for the cross-process input and GPU alpha qualification gates. Desktop-only mode, fullscreen suppression, live topology recovery, multi-surface overlay, per-monitor qualification, and production packaging remain separate work.

Settings are stored under Tauri's application config directory in `settings-v1.json`. There is no caller-supplied filesystem path, automatic overlay show, or automatic startup.
