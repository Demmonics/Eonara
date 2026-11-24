use super::{emit_error, Artwork, Clock, Media, Row, Session};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::{AgileReference, IUnknown, Interface, RuntimeType},
    Foundation::TypedEventHandler,
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as SessionRef,
        GlobalSystemMediaTransportControlsSessionManager as ManagerRef,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    },
    Storage::Streams::{DataReader, IRandomAccessStreamReference},
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};
use windows_future::{AsyncStatus, IAsyncOperation};

const MAX_SESSIONS: usize = 32;
const WATCHDOG: Duration = Duration::from_millis(750);
const IDLE: Duration = Duration::from_secs(12);
const MAX_ART_BYTES: usize = 2 * 1024 * 1024;
const WINDOWS_UNIX_OFFSET_MS: i64 = 11_644_473_600_000;

struct Apartment;

impl Apartment {
    fn enter() -> windows::core::Result<Self> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        Ok(Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

fn await_result<T: RuntimeType + 'static>(
    operation: IAsyncOperation<T>,
    deadline: Instant,
    cancelled: impl Fn() -> bool,
) -> Option<T> {
    loop {
        if cancelled() {
            let _ = operation.Cancel();
            return None;
        }
        match operation.Status().ok()? {
            AsyncStatus::Started => {
                if Instant::now() >= deadline {
                    let _ = operation.Cancel();
                    return None;
                }
                thread::sleep(Duration::from_millis(8));
            }
            AsyncStatus::Completed => return operation.GetResults().ok(),
            _ => return None,
        }
    }
}

fn identity(reference: &SessionRef) -> Option<usize> {
    reference
        .cast::<IUnknown>()
        .ok()
        .map(|id| id.as_raw() as usize)
}

struct ManagerWatch {
    reference: ManagerRef,
    sessions: Option<i64>,
    current: Option<i64>,
}

impl ManagerWatch {
    fn attach(reference: ManagerRef, wake: &SyncSender<()>) -> Self {
        let wake_sessions = wake.clone();
        let wake_current = wake.clone();
        let sessions = reference
            .SessionsChanged(&TypedEventHandler::new(move |_, _| {
                let _ = wake_sessions.try_send(());
                Ok(())
            }))
            .ok();
        let current = reference
            .CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
                let _ = wake_current.try_send(());
                Ok(())
            }))
            .ok();
        Self {
            reference,
            sessions,
            current,
        }
    }
}

impl Drop for ManagerWatch {
    fn drop(&mut self) {
        if let Some(token) = self.sessions {
            let _ = self.reference.RemoveSessionsChanged(token);
        }
        if let Some(token) = self.current {
            let _ = self.reference.RemoveCurrentSessionChanged(token);
        }
    }
}

struct SessionWatch {
    reference: SessionRef,
    metadata_epoch: Arc<AtomicU64>,
    seen_epoch: u64,
    last_attempt: Option<Instant>,
    metadata_failed: bool,
    blocked_anchor: Option<(i64, i64)>,
    tokens: [Option<i64>; 3],
    row: Row,
}

impl SessionWatch {
    fn attach(reference: SessionRef, serial: u64, wake: &SyncSender<()>) -> Self {
        let metadata_epoch = Arc::new(AtomicU64::new(1));
        let dirty = metadata_epoch.clone();
        let wake_meta = wake.clone();
        let wake_playback = wake.clone();
        let wake_timeline = wake.clone();
        let tokens = [
            reference
                .MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
                    dirty.fetch_add(1, Ordering::AcqRel);
                    let _ = wake_meta.try_send(());
                    Ok(())
                }))
                .ok(),
            reference
                .PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = wake_playback.try_send(());
                    Ok(())
                }))
                .ok(),
            reference
                .TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = wake_timeline.try_send(());
                    Ok(())
                }))
                .ok(),
        ];
        let source = reference
            .SourceAppUserModelId()
            .map(|s| bounded(s.to_string_lossy()))
            .unwrap_or_default();
        Self {
            reference,
            metadata_epoch,
            seen_epoch: 0,
            last_attempt: None,
            metadata_failed: false,
            blocked_anchor: None,
            tokens,
            row: Row {
                output: Session {
                    id: format!("gsm-{serial}"),
                    source,
                    rate: 1.0,
                    ..Session::default()
                },
                ..Row::default()
            },
        }
    }

    fn read_metadata(&mut self, deadline: Instant, stop: &AtomicBool, next_art: &mut u64) -> bool {
        let version = self.metadata_epoch.load(Ordering::Acquire);
        let now = Instant::now();
        let retry = (self.metadata_failed || self.tokens[0].is_none())
            && self
                .last_attempt
                .is_none_or(|at| now.duration_since(at) >= IDLE);
        if version == self.seen_epoch && !retry {
            return false;
        }
        if now >= deadline {
            // Do not preserve stale metadata while a different session used this pass's budget.
            if version != self.seen_epoch {
                self.metadata_failed = true;
                self.last_attempt = None;
                self.seen_epoch = version;
                return self.replace_metadata(String::new(), String::new(), String::new(), None);
            }
            return false;
        }
        self.seen_epoch = version;
        self.last_attempt = Some(now);
        let properties = self
            .reference
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|operation| {
                await_result(
                    operation,
                    deadline.min(now + Duration::from_millis(450)),
                    || {
                        stop.load(Ordering::Acquire)
                            || self.metadata_epoch.load(Ordering::Acquire) != version
                    },
                )
            });
        self.metadata_failed = properties.is_none();
        let Some(properties) = properties else {
            return self.replace_metadata(String::new(), String::new(), String::new(), None);
        };
        let title = properties
            .Title()
            .map(|s| bounded(s.to_string_lossy()))
            .unwrap_or_default();
        let artist = properties
            .Artist()
            .map(|s| bounded(s.to_string_lossy()))
            .unwrap_or_default();
        let album = properties
            .AlbumTitle()
            .map(|s| bounded(s.to_string_lossy()))
            .unwrap_or_default();
        let art = properties
            .Thumbnail()
            .ok()
            .and_then(|reference| AgileReference::new(&reference).ok())
            .map(|reference| {
                *next_art += 1;
                Arc::new(ArtSlot {
                    reference,
                    revision: *next_art,
                    metadata_epoch: self.metadata_epoch.clone(),
                    version,
                    cancelled: AtomicBool::new(false),
                })
            });
        self.replace_metadata(title, artist, album, art)
    }

    fn replace_metadata(
        &mut self,
        title: String,
        artist: String,
        album: String,
        art: Option<Arc<ArtSlot>>,
    ) -> bool {
        let output = &mut self.row.output;
        let changed = output.title != title || output.artist != artist || output.album != album;
        if changed {
            (output.title, output.artist, output.album) = (title, artist, album);
            output.generation += 1;
            if let Some(previous) = self.row.clock {
                self.blocked_anchor = Some((previous.raw_timestamp, previous.raw_position));
            }
            self.row.clock = None;
        }
        if let Some(old) = self.row.art.take() {
            old.cancelled.store(true, Ordering::Release);
        }
        let revision = art.as_ref().map_or(0, |slot| slot.revision);
        let art_changed = output.artwork_revision != revision;
        output.artwork_revision = revision;
        self.row.art = art;
        changed || art_changed
    }

    fn read_clock(&mut self) -> bool {
        let previous = self.row.clock;
        let output = &mut self.row.output;
        let info = self.reference.GetPlaybackInfo().ok();
        let status = info.as_ref().and_then(|info| info.PlaybackStatus().ok());
        let playing = status == Some(PlaybackStatus::Playing);
        let paused = status == Some(PlaybackStatus::Paused);
        let reported_rate = info
            .and_then(|info| info.PlaybackRate().ok())
            .and_then(|rate| rate.Value().ok());
        let valid_rate = reported_rate.filter(|rate| (0.20..=5.0).contains(rate));
        let rate = valid_rate.unwrap_or(1.0);
        let timeline = self.reference.GetTimelineProperties().ok();
        let start = timeline
            .as_ref()
            .and_then(|t| t.StartTime().ok())
            .map_or(0, |t| t.Duration / 10_000);
        let end = timeline
            .as_ref()
            .and_then(|t| t.EndTime().ok())
            .map_or(0, |t| t.Duration / 10_000);
        // A zero or unbounded duration is not a usable music clock.
        let duration = end.saturating_sub(start);
        let valid_bounds = start >= 0 && (1..=86_400_000).contains(&duration);
        let duration = if valid_bounds { duration } else { 0 };
        let clock = if valid_bounds
            && !output.title.is_empty()
            && (playing || paused)
            && (!playing || reported_rate.is_none() || valid_rate.is_some())
        {
            timeline.and_then(|timeline| {
                let position = timeline.Position().ok()?.Duration / 10_000;
                let stamp = timeline.LastUpdatedTime().ok()?.UniversalTime / 10_000;
                if self.blocked_anchor == Some((stamp, position)) {
                    return None;
                }
                let now = Instant::now();
                let utc = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .ok()?
                    .as_millis() as i64;
                let age = (utc + WINDOWS_UNIX_OFFSET_MS).saturating_sub(stamp);
                ingest(
                    previous, now, start, end, position, stamp, age, playing, rate,
                )
            })
        } else {
            None
        };
        if clock.is_some() {
            self.blocked_anchor = None;
        }
        let anchor_changed = match (previous, clock) {
            (Some(a), Some(b)) => a.at != b.at,
            (None, None) => false,
            _ => true,
        };
        let changed = output.duration_ms != duration
            || output.playing != playing
            || output.rate != rate
            || output.timeline_valid != clock.is_some()
            || anchor_changed;
        output.duration_ms = duration;
        output.playing = playing;
        output.rate = rate;
        output.timeline_valid = clock.is_some();
        self.row.clock = clock;
        changed
    }
}

impl Drop for SessionWatch {
    fn drop(&mut self) {
        let [media, playback, timeline] = self.tokens;
        if let Some(token) = media {
            let _ = self.reference.RemoveMediaPropertiesChanged(token);
        }
        if let Some(token) = playback {
            let _ = self.reference.RemovePlaybackInfoChanged(token);
        }
        if let Some(token) = timeline {
            let _ = self.reference.RemoveTimelinePropertiesChanged(token);
        }
        if let Some(art) = self.row.art.as_ref() {
            art.cancelled.store(true, Ordering::Release);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn ingest(
    previous: Option<Clock>,
    now: Instant,
    start: i64,
    end: i64,
    raw_position: i64,
    raw_timestamp: i64,
    age: i64,
    playing: bool,
    rate: f64,
) -> Option<Clock> {
    if raw_timestamp <= WINDOWS_UNIX_OFFSET_MS
        || age < -2_000
        || raw_position < start.saturating_sub(250)
        || raw_position > end.saturating_add(250)
    {
        return None;
    }
    let coherent = previous.filter(|clock| clock.start == start && clock.end == end);
    let mut position = raw_position as f64;
    if playing && (0..=2_000).contains(&age) {
        position += age as f64 * rate;
    }
    if let Some(before) = coherent {
        if before.raw_position == raw_position && before.raw_timestamp == raw_timestamp {
            if before.playing == playing && before.rate == rate {
                return Some(before);
            }
            // SMTC can change status without changing its timeline anchor.
            position = before.current(now);
        } else if playing && before.playing && before.rate == rate {
            let expected = before.current(now);
            if (position - expected).abs() <= 80.0 {
                // Keep the renderer's existing time origin for sub-frame/low-drift updates.
                return Some(Clock {
                    raw_position,
                    raw_timestamp,
                    ..before
                });
            }
        }
    }
    Some(Clock {
        at: now,
        position,
        raw_position,
        raw_timestamp,
        start,
        end,
        playing,
        rate,
    })
}

fn bounded(value: String) -> String {
    value.trim().chars().take(512).collect()
}

pub(super) fn watch(app: AppHandle) {
    let Ok(_apartment) = Apartment::enter() else {
        emit_error(
            &app,
            "Could not initialize Windows Runtime for media sessions.",
        );
        return;
    };
    let media = app.state::<Media>();
    let (sender, receiver) = sync_channel(1);
    if let Ok(mut wake) = media.wake.lock() {
        *wake = Some(sender.clone());
    }
    let mut manager = None;
    let mut sessions = HashMap::<usize, SessionWatch>::new();
    let mut next_session = 0;
    let mut next_art = 0;
    while !media.stop.load(Ordering::Acquire) {
        if manager.is_none() {
            manager = ManagerRef::RequestAsync()
                .ok()
                .and_then(|operation| {
                    await_result(operation, Instant::now() + Duration::from_secs(3), || {
                        media.stop.load(Ordering::Acquire)
                    })
                })
                .map(|reference| ManagerWatch::attach(reference, &sender));
        }
        let Some(connected) = manager.as_ref() else {
            emit_error(&app, "Windows did not provide access to media sessions. Retry after opening a compatible player.");
            let _ = receiver.recv_timeout(IDLE);
            continue;
        };
        let Ok(vector) = connected.reference.GetSessions() else {
            sessions.clear();
            manager = None;
            emit_error(&app, "Could not enumerate Windows media sessions.");
            let _ = receiver.recv_timeout(IDLE);
            continue;
        };
        let current_ref = connected.reference.GetCurrentSession().ok();
        let current = current_ref.as_ref().and_then(identity);
        let mut ordered = Vec::new();
        let mut present = HashSet::new();
        let count = vector.Size().unwrap_or(0).min(MAX_SESSIONS as u32);
        // Keep the current session visible even when it is outside our enumeration cap.
        for reference in (0..count)
            .filter_map(|i| vector.GetAt(i).ok())
            .chain(current_ref)
        {
            let Some(key) = identity(&reference) else {
                continue;
            };
            if present.insert(key) {
                sessions.entry(key).or_insert_with(|| {
                    next_session += 1;
                    SessionWatch::attach(reference, next_session, &sender)
                });
                ordered.push(key);
            }
        }
        let mut changed = sessions.keys().any(|key| !present.contains(key));
        sessions.retain(|key, _| present.contains(key));
        let deadline = Instant::now() + Duration::from_millis(500);
        let mut rows = Vec::with_capacity(ordered.len());
        for key in ordered {
            let Some(session) = sessions.get_mut(&key) else {
                continue;
            };
            changed |= session.read_metadata(deadline, &media.stop, &mut next_art);
            changed |= session.read_clock();
            rows.push(session.row.clone());
        }
        let current = current
            .and_then(|key| sessions.get(&key))
            .map(|s| s.row.output.id.as_str());
        let retry_unseen = sessions
            .values()
            .any(|s| s.metadata_failed && s.last_attempt.is_none());
        let mut timeout = IDLE;
        if let Ok(mut feed) = media.feed.lock() {
            changed |= feed.error.take().is_some()
                || !feed
                    .rows
                    .iter()
                    .map(|row| &row.output.id)
                    .eq(rows.iter().map(|row| &row.output.id));
            feed.rows = rows;
            let previous_id = feed.active_id.clone();
            feed.choose(current);
            if feed
                .active_id
                .as_ref()
                .and_then(|id| feed.rows.iter().find(|row| &row.output.id == id))
                .is_some_and(|row| row.output.playing)
                || retry_unseen
            {
                timeout = WATCHDOG;
            }
            if changed || previous_id != feed.active_id {
                feed.revision += 1;
                let snapshot = feed.snapshot();
                drop(feed);
                let _ = app.emit("media_changed", snapshot);
            }
        }
        let _ = receiver.recv_timeout(timeout);
    }
}

pub(super) struct ArtSlot {
    reference: AgileReference<IRandomAccessStreamReference>,
    revision: u64,
    metadata_epoch: Arc<AtomicU64>,
    version: u64,
    cancelled: AtomicBool,
}

impl ArtSlot {
    fn stale(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
            || self.metadata_epoch.load(Ordering::Acquire) != self.version
    }
}

pub(super) fn artwork(app: &AppHandle, id: &str) -> Option<Artwork> {
    let media = app.state::<Media>();
    let slot = media
        .feed
        .lock()
        .ok()?
        .rows
        .iter()
        .find(|row| row.output.id == id)?
        .art
        .clone()?;
    if slot.stale() {
        return None;
    }
    let mut cache = media.art.lock().ok()?;
    if slot.stale() {
        return None;
    }
    if let Some((_, result)) = cache.iter().find(|(cached, _)| *cached == slot.revision) {
        return result.clone();
    }
    let _apartment = Apartment::enter().ok()?;
    let result = load_art(&slot, &media.stop);
    if slot.stale() {
        return None;
    }
    // Cache at most four encoded covers and never persist media images to disk.
    if cache.len() == 4 {
        cache.pop_front();
    }
    cache.push_back((slot.revision, result.clone()));
    result
}

fn load_art(slot: &ArtSlot, stop: &AtomicBool) -> Option<Artwork> {
    let deadline = Instant::now() + Duration::from_secs(2);
    let cancelled = || slot.stale() || stop.load(Ordering::Acquire);
    let reference = slot.reference.resolve().ok()?;
    let stream = await_result(reference.OpenReadAsync().ok()?, deadline, cancelled)?;
    let bytes = usize::try_from(stream.Size().ok()?).ok()?;
    if bytes == 0 || bytes > MAX_ART_BYTES {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    let actual = await_result(reader.LoadAsync(bytes as u32).ok()?, deadline, cancelled)? as usize;
    if actual != bytes {
        return None;
    }
    let mut contents = vec![0; bytes];
    reader.ReadBytes(&mut contents).ok()?;
    let (mime, w, h) = image_header(&contents)?;
    if w == 0 || h == 0 || w > 4096 || h > 4096 || w as u64 * h as u64 > 8_000_000 {
        return None;
    }
    Some(Artwork {
        hash: format!("{:x}", Sha256::digest(&contents)),
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(&contents)),
    })
}

fn image_header(bytes: &[u8]) -> Option<(&'static str, u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(8..16)? == b"\x00\x00\x00\x0dIHDR" {
        let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
        let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
        return Some(("image/png", width, height));
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        let mut cursor = 2;
        while bytes.get(cursor) == Some(&0xff) {
            cursor += 1;
            let marker = *bytes.get(cursor)?;
            if marker == 0xff {
                continue;
            }
            cursor += 1;
            if matches!(marker, 0xda | 0xd9) {
                break;
            }
            let length =
                u16::from_be_bytes(bytes.get(cursor..cursor + 2)?.try_into().ok()?) as usize;
            let segment = bytes.get(cursor..cursor + length)?;
            if length < 2 {
                return None;
            }
            if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
                let h = u16::from_be_bytes(segment.get(3..5)?.try_into().ok()?);
                let w = u16::from_be_bytes(segment.get(5..7)?.try_into().ok()?);
                return Some(("image/jpeg", w as u32, h as u32));
            }
            cursor += length;
        }
    }
    // Do not put arbitrary MIME types (in particular SVG or HTML) into the webview.
    None
}

#[cfg(test)]
mod tests {
    use super::{
        await_result, image_header, ingest, load_art, Apartment, ManagerRef, SessionWatch,
        WINDOWS_UNIX_OFFSET_MS,
    };
    use std::{
        sync::{atomic::AtomicBool, mpsc::sync_channel},
        time::{Duration, Instant},
    };

    #[test]
    fn unchanged_anchor_advances_then_pause_freezes() {
        let now = Instant::now();
        let stamp = WINDOWS_UNIX_OFFSET_MS + 10_000;
        let playing = ingest(None, now, 0, 300_000, 5000, stamp, 100, true, 1.0).unwrap();
        let later = now + Duration::from_secs(4);
        let playing = ingest(
            Some(playing),
            later,
            0,
            300_000,
            5000,
            stamp,
            4100,
            true,
            1.0,
        )
        .unwrap();
        assert_eq!(playing.current(later), 9100.0);
        let paused = ingest(
            Some(playing),
            later,
            0,
            300_000,
            5000,
            stamp,
            4100,
            false,
            1.0,
        )
        .unwrap();
        assert_eq!(paused.current(later + Duration::from_secs(10)), 9100.0);
    }

    #[test]
    fn backward_seek_hard_resets_and_impossible_source_time_is_rejected() {
        let now = Instant::now();
        let stamp = WINDOWS_UNIX_OFFSET_MS + 10_000;
        let clock = ingest(None, now, 0, 300_000, 60_000, stamp, 0, true, 1.0).unwrap();
        let later = now + Duration::from_secs(1);
        let reset = ingest(
            Some(clock),
            later,
            0,
            300_000,
            8000,
            stamp + 1000,
            40,
            true,
            1.0,
        )
        .unwrap();
        assert_eq!(reset.current(later), 8040.0);
        assert!(ingest(None, now, 0, 1000, 0, 0, 0, true, 1.0).is_none());
        assert!(ingest(None, now, 0, 1000, 0, stamp, -4_000, true, 1.0).is_none());
    }

    #[test]
    fn only_supported_raster_headers_are_returned() {
        assert_eq!(
            image_header(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x02\x00\x00\x00\x01\x00"),
            Some(("image/png", 512, 256))
        );
        assert_eq!(
            image_header(b"\xff\xd8\xff\xc0\x00\x08\x08\x00\x10\x00\x20\x03"),
            Some(("image/jpeg", 32, 16))
        );
        assert_eq!(image_header(b"<svg></svg>"), None);
    }

    #[test]
    #[ignore = "requires a running compatible Windows media session"]
    fn probe_live_media_without_controlling_playback() {
        let _apartment = Apartment::enter().unwrap();
        let manager = await_result(
            ManagerRef::RequestAsync().unwrap(),
            Instant::now() + Duration::from_secs(3),
            || false,
        )
        .expect("GSMTC manager did not respond");
        let sessions = manager.GetSessions().unwrap();
        let count = sessions.Size().unwrap();
        println!("GSMTC enumerated {count} active session(s).");
        let (wake, _receiver) = sync_channel(1);
        let stop = AtomicBool::new(false);
        let mut art_serial = 0;
        for i in 0..count.min(32) {
            let mut session = SessionWatch::attach(sessions.GetAt(i).unwrap(), i as u64, &wake);
            session.read_metadata(
                Instant::now() + Duration::from_secs(1),
                &stop,
                &mut art_serial,
            );
            session.read_clock();
            let row = &session.row.output;
            let reference = session.row.art.is_some();
            let loaded = session
                .row
                .art
                .as_ref()
                .and_then(|slot| load_art(slot, &stop))
                .is_some();
            println!(
                "source={} title={} artist={} playing={} timeline={} thumbnail={} bounded_art={}",
                row.source,
                !row.title.is_empty(),
                !row.artist.is_empty(),
                row.playing,
                row.timeline_valid,
                reference,
                loaded
            );
        }
        assert!(
            count > 0,
            "Start a track in a compatible player, then rerun."
        );
    }
}
