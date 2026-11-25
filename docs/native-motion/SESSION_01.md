# Native session 01 — in progress

User authorized one exclusive session on 2026-11-25/26. Branch remains
`refinement/native-motion`. No merge/publication. Original checkpoint `ae52a5c`
and migrated release files preserved.

## Tested candidate

- Native Windows release + NSIS build passed, independently in `src-tauri/target/native-motion`.
- Embedded source commit: `1f8d0d468d3d375686214d5689687ab10f9f1d4d`; clean application source at build.
- Executable: `artifacts/native-motion/session-01/candidate/lyricmotion.exe`,
  10,117,632 bytes; SHA-256 `f5c5aedcf3032661677c8ef6d7eba4eb3e9fa5cbf10f30caf2e1406ac50f1d82`.
- Installer SHA-256 `4e3d5a828be6f9f506ff1419c806f028532df6cbb8ad88e82db8ba23237a2520`.
- Native self-provenance agrees with the external hash. Main + overlay use
  WebView2 `158.0.4370.33`, one 1920×1080 display, 125% scaling.
- Test-only process-local WebView2 debugging on **127.0.0.1:14626**, isolated
  ignored WebView profile. No Spotify debugger or global configuration changes.
  CDP drives setup/reads IPC and DOM; actual input receipts are independently
  proved by Win32 receiver processes. Benchmark runs disconnect CDP.

## Results so far

| Gate | Actual evidence | Result / scope |
|---|---|---|
| Build | Independent Cargo check, release + NSIS; frontend production build | Passed; no installer installation claim |
| Thread entry regression | `heroGeometry.test.ts` early/settled rotated bounds, 72 unit tests | Passed after common-stack translation + rotation clearance |
| Visual comparison | `thread-fixed/contact-message-thread.png` vs `pass1/contact-message-thread.png` | 5600 ms card overlap removed; browser supplement, not native proof |
| Disposable input control | `session-01/input-control/oracle.json` | Native cross-process pass/block self-test passed, exact received coordinates |
| Populated application overlay | `input-app-populated/oracle.json`, `overlay-lyrics.png` | All six plan cases passed on candidate PID 35900; real receiver down/up and foreground PIDs |
| Emergency recovery | Same oracle | `Ctrl+Alt+Shift+L` hid overlay and restored pass-through; actual receiver received click afterward |
| Native tray | Validated native menu owner/labels; oracle reopened through tray | Quit gracefully exited both old hosts; candidate Open and overlay toggle exercised |
| Independent GSMTC control | `smtc-control/smtc.json` | Playing, pause, paused seek 31 s, resume, metadata replacement and removal passed |
| Candidate native media integration | `native-media-03/native-media.json` | Host + UI playing/paused/31 s seek/freeze/resume/track-clear checks passed using muted local publisher and original imported author-stamped lyrics |
| Spotify native transport | `spotify-native-02/spotify-native.json` | Real resume, seek 60 s, pause/freeze/resume and title/duration generation switch passed |
| Real artwork | Same file, native `media_artwork` hashes + rendered CSS surface tokens + app-only captures | Different real covers changed semantic atmosphere/surfaces; no fabricated artwork |
| Real lyric coverage | Diagnostics in same directory | Original Reflections album returned **plain/unsynchronized**; Stop The Wedding! returned **line** timing; Reflections compilation returned **word** timing. Estimates disabled |

Real album hashes observed:

- Original Reflections: `7bcfab2df8863234d4975b1e693c8efb28047598edc115da761e51e19b603ab9`;
  accent `#b69786`, glass `#1d1c1e`.
- Stop The Wedding!: `25fc4d512058f49b690fa70b4a1ca1b6b49a5b5b997403d4c6aa001aad0b6c19`;
  accent `#9697d7`, glass `#1c1c24`.

`spotify-native-02/live-line-animation.mp4` actually records the Reflections
**compilation** native word-timed view (the requested URI navigated but did not
select the intended song). Its name is historical, not evidence of the Ashe track.
Capture is app-HWND PrintWindow at nominal 15 samples/s, silent; neither alpha
preservation nor native presented FPS/audio latency is established by that method.

## Findings and limits

- A raw `ShowWindow(SW_HIDE)` in initial QA setup left Tauri's visibility cache
  stale, so tray Open did not restore the HWND. This was a **test-tool issue**:
  use the application's `WM_CLOSE` → hide-to-tray path instead. Tool updated.
- Fresh-profile settings were initially patched with an incomplete object by the
  CDP adapter. Tool now initializes through the real UI save path and rejects
  incomplete settings. Populated tests were rerun after correction.
- CSP correctly rejected Playwright's string-based `wait_for_function`; QA uses
  bounded explicit DOM sampling instead. No CSP weakening.
- Spotify previous/next restoration did not return to the original recording;
  further restoration is tracked separately. Do not interpret the original
  script's “restored state” label as a successful assertion.
- No actual audio-ground-truth latency measurement, native presentation trace,
  external monitor/mixed-DPI, right-button/wheel/keyboard/drag oracle, installer
  installation or full 13-style native qualification is claimed.
- Benchmark preflight rejected an unrelated Android Cargo build. User confirmed
  that agent was paused; all runs must pass the process gate again. No unrelated
  build/process was stopped by this lane.

## Measurement protocol

`spikes/qa/session_benchmark.py` checks for compiler/emulator/capture/browser-test
processes before and after every repetition. Each scenario uses three repetitions,
5 s CPU warmup + 30 s measurement, CPU/memory sampled every 0.5 s.
Windows GPU Engine and GPU Process Memory counters run alongside at 1 Hz; the
first five GPU observations are omitted in the summary as warmup. Their exact
timestamps and counter status remain in the raw files.

The selected host has seven creation-validated descendant WebView2 processes,
including its unique test-profile browser root; no disjoint renderer PID was
added. Inventory includes the profile identity. GPU results retain only those
explicit process IDs. One child command-line parser produced a truncated profile
string (`C:\D`); ancestry/creation identity, not that truncated string, establishes
inclusion.

CPU is reported both as one-core percent and normalized across 20 logical CPUs.
Working-set sums can duplicate shared pages. Private bytes are committed process
memory, not resident RAM. GPU engine percent is not whole-GPU percent or presented
FPS; the summary reports the busiest physical 3D engine after aggregating app
process contributions for that engine, plus summed process dedicated/shared
GPU-memory counters (not unique physical allocations).

## Pre-fix performance

Three repetitions passed the quiet-process gate per state, all seven WebView
processes readable. Median of per-run CPU averages and memory medians:

| State | CPU, total machine | Working set MiB | Private MiB | Busiest app 3D engine | Shared GPU MiB |
|---|---:|---:|---:|---:|---:|
| Main live paused | 0.16% | 728.0 | 526.2 | 0.02% | 61.7 |
| Main live playing | 1.88% | 828.9 | 575.8 | 40.27% | 163.0 |
| Both native HWNDs hidden, source paused | 0.15% | 830.2 | 573.0 | 0.07% | 186.5 |
| Overlay only, muted fixture playing | 1.94% | 861.3 | 581.0 | 48.96% | 163.2 |

These are **pre-fix** results on `f5c5aedc…`, not a successful overlay-only budget.
The native state snapshots proved HWND main hidden while `document.hidden` stayed
false even through the normal close-to-tray path. Therefore the hidden main could
render when its live source played. Low paused GPU alone did not qualify hidden
playing behavior. Memory differs across sequential warm-cache states and is not
a cold-start/like-for-like scene comparison or evidence of a leak.

User explicitly authorized the narrow shared `src/main.ts` correction: Rust
reports actual visible/non-minimized window state through a main-only command and
visibility events; main uses its existing `showing` guard and cancels pending draw
when hidden. This also suspends gallery scheduling. Rebuilt qualification follows below.

Native priority screenshots and 6-second clips for Ship, Fisheye and Message
Thread were captured from the compiled first candidate using the original muted
demo (`native-priority/manifest.json`). Raw artifacts are local/ignored and not
uploaded or committed. No remote publication.

## Fixed candidate — follow-up within the same authorized desktop window

Directory `artifacts/native-motion/session-02/` is a follow-up artifact set, **not**
a second independently authorized desktop session.

- Embedded application source commit: `fcbb47d3c2d4319d827dd258ee82565596aec6c9`.
- Executable 10,132,992 bytes; SHA-256
  `466fca1b1a9d886ad7c57b0bde92f277c80fc55281ff97ec3366df8a4f82071e`.
- Installer SHA-256
  `622040fcca63d95605dec0e76a902bc670dfe01d05f683ecbbbffa44437efd1d`.
- Isolated release/NSIS build, 72 unit tests, frontend build and six pure/mock
  Python tests passed. Existing original releases and first candidate retained.
- Native media integration repeated successfully (`session-02/native-media/`).
- All six populated overlay input/focus/shortcut/tray-reopen cases repeated
  successfully (`session-02/input-app/oracle.json`).

`session-02/visibility.json` counts actual main-context WebGL submissions over
one-second observations, with temporary wrappers removed before benchmarks:

| Native state | Submitted draw calls | Host visible | Browser `document.hidden` |
|---|---:|---|---|
| Visible, playing | 412 | true | false |
| Close-to-tray, playing | **0** | false | false |
| Tray reopened, playing | 425 | true | false |
| Minimized, playing | **0** | false | false |
| Tray restores minimized main | 372 | true | false |

These are draw-call counts, **not FPS**. They directly confirm the renderer stops
even though WebView2 still reports page visibility incorrectly. Native visible
state comes from the host's own window API, not a fake browser visibility flag.
Follow-up resource runs and final cleanup audit are pending.
