use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::SyncSender,
        Mutex,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    id: String,
    source: String,
    title: String,
    artist: String,
    album: String,
    duration_ms: i64,
    position_ms: i64,
    playing: bool,
    rate: f64,
    timeline_valid: bool,
    generation: u64,
    artwork_revision: u64,
}

#[derive(Clone, Copy)]
struct Clock {
    at: Instant,
    position: f64,
    raw_position: i64,
    raw_timestamp: i64,
    start: i64,
    end: i64,
    playing: bool,
    rate: f64,
}

impl Clock {
    fn current(self, now: Instant) -> f64 {
        let elapsed = if self.playing {
            now.saturating_duration_since(self.at).as_secs_f64() * 1000.0 * self.rate
        } else {
            0.0
        };
        (self.position + elapsed).clamp(self.start as f64, self.end as f64)
    }
}

#[derive(Clone, Default)]
struct Row {
    output: Session,
    clock: Option<Clock>,
    #[cfg(windows)]
    art: Option<std::sync::Arc<platform::ArtSlot>>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    sessions: Vec<Session>,
    active_id: Option<String>,
    revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    data_url: String,
    hash: String,
}

#[derive(Default)]
struct Feed {
    rows: Vec<Row>,
    active_id: Option<String>,
    override_id: Option<String>,
    revision: u64,
    error: Option<String>,
}

impl Feed {
    fn snapshot(&self) -> Snapshot {
        let now = Instant::now();
        Snapshot {
            sessions: self
                .rows
                .iter()
                .map(|row| {
                    let mut session = row.output.clone();
                    if let Some(clock) = row.clock {
                        session.position_ms =
                            (clock.current(now).round() as i64).saturating_sub(clock.start);
                    }
                    session
                })
                .collect(),
            active_id: self.active_id.clone(),
            revision: self.revision,
            error: self.error.clone(),
        }
    }

    fn choose(&mut self, windows_current: Option<&str>) {
        let by_id = |id: &str| self.rows.iter().find(|row| row.output.id == id);
        let ready = |row: &&Row| {
            row.output.playing
                && row.output.timeline_valid
                && !row.output.title.is_empty()
                && !row.output.artist.is_empty()
        };
        let playing_metadata = |row: &&Row| row.output.playing && !row.output.title.is_empty();
        let preferred = windows_current.and_then(by_id);
        let sticky = self.active_id.as_deref().and_then(by_id);
        if self
            .override_id
            .as_deref()
            .is_some_and(|id| by_id(id).is_none())
        {
            self.override_id = None;
        }
        self.active_id = self
            .override_id
            .as_deref()
            .and_then(by_id)
            .or_else(|| preferred.filter(ready))
            .or_else(|| sticky.filter(ready))
            .or_else(|| self.rows.iter().find(ready))
            .or_else(|| preferred.filter(playing_metadata))
            .or_else(|| sticky.filter(playing_metadata))
            .or_else(|| self.rows.iter().find(playing_metadata))
            .or(preferred)
            .or(sticky)
            .or_else(|| self.rows.first())
            .map(|row| row.output.id.clone());
    }
}

#[derive(Default)]
pub struct Media {
    feed: Mutex<Feed>,
    stop: AtomicBool,
    wake: Mutex<Option<SyncSender<()>>>,
    #[cfg(windows)]
    art: Mutex<std::collections::VecDeque<(u64, Option<Artwork>)>>,
}

impl Media {
    fn signal(&self) {
        if let Ok(sender) = self.wake.lock() {
            if let Some(sender) = sender.as_ref() {
                let _ = sender.try_send(());
            }
        }
    }
}

pub fn start(app: AppHandle) {
    #[cfg(windows)]
    {
        let worker_app = app.clone();
        if std::thread::Builder::new()
            .name("eonara-gsmtc".into())
            .spawn(move || {
                platform::watch(worker_app);
            })
            .is_err()
        {
            emit_error(&app, "Could not start the Windows media worker.");
        }
    }
    #[cfg(not(windows))]
    emit_error(
        &app,
        "Windows media sessions are unavailable on this operating system.",
    );
}

pub fn stop(app: &AppHandle) {
    let media = app.state::<Media>();
    media.stop.store(true, Ordering::Release);
    media.signal();
}

fn emit_error(app: &AppHandle, error: &str) {
    let media = app.state::<Media>();
    let Ok(mut feed) = media.feed.lock() else {
        return;
    };
    if feed.error.as_deref() == Some(error) && feed.rows.is_empty() {
        return;
    }
    feed.error = Some(error.into());
    feed.rows.clear();
    feed.active_id = None;
    feed.revision += 1;
    let snapshot = feed.snapshot();
    drop(feed);
    let _ = app.emit("media_changed", snapshot);
}

#[tauri::command]
pub fn media_snapshot(media: State<'_, Media>) -> Result<Snapshot, String> {
    Ok(media
        .feed
        .lock()
        .map_err(|_| "Media sessions are unavailable.")?
        .snapshot())
}

#[tauri::command]
pub fn media_select(app: AppHandle, id: Option<String>) -> Result<(), String> {
    let media = app.state::<Media>();
    let mut feed = media
        .feed
        .lock()
        .map_err(|_| "Media sessions are unavailable.")?;
    if id
        .as_deref()
        .is_some_and(|id| !feed.rows.iter().any(|row| row.output.id == id))
    {
        return Err("That media session is no longer available.".into());
    }
    feed.override_id = id;
    drop(feed);
    media.signal();
    Ok(())
}

#[tauri::command]
pub fn media_refresh(media: State<'_, Media>) {
    media.signal();
}

#[tauri::command]
pub async fn media_artwork(app: AppHandle, id: String) -> Option<Artwork> {
    #[cfg(windows)]
    {
        if id.len() > 64 {
            return None;
        }
        tauri::async_runtime::spawn_blocking(move || platform::artwork(&app, &id))
            .await
            .ok()
            .flatten()
    }
    #[cfg(not(windows))]
    {
        let _ = (app, id);
        None
    }
}

#[cfg(windows)]
#[path = "media_windows.rs"]
mod platform;

#[cfg(test)]
mod tests {
    use super::{Feed, Row, Session};

    fn row(id: &str, playing: bool) -> Row {
        Row {
            output: Session {
                id: id.into(),
                title: "Fixture track".into(),
                artist: "Fixture artist".into(),
                playing,
                timeline_valid: true,
                ..Session::default()
            },
            ..Row::default()
        }
    }

    #[test]
    fn keeps_playable_source_until_windows_has_a_ready_current_source() {
        let mut feed = Feed {
            rows: vec![row("one", true), row("two", true), row("paused", false)],
            active_id: Some("two".into()),
            ..Feed::default()
        };
        feed.choose(Some("paused"));
        assert_eq!(feed.active_id.as_deref(), Some("two"));
        feed.choose(Some("one"));
        assert_eq!(feed.active_id.as_deref(), Some("one"));
        feed.override_id = Some("paused".into());
        feed.choose(Some("one"));
        assert_eq!(feed.active_id.as_deref(), Some("paused"));
        feed.rows.pop();
        feed.choose(Some("one"));
        assert!(feed.override_id.is_none());
        assert_eq!(feed.active_id.as_deref(), Some("one"));
    }
}
