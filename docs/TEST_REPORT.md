# QA test report

## Observed on Windows, 2026-11-24

| Check | Actual result | Evidence |
| --- | --- | --- |
| Desktop input oracle control, native Win32 fixtures in separate Python processes | Pass. The same `SendInput` click was delivered (both down and up) to the layered control with pass-through disabled, to the receiver with pass-through enabled, and to the layered control again after disabling pass-through. | `%TEMP%\opencode\lyrics-oracle-selftest-3\oracle.json` |
| Controlled local SMTC publisher vs independent GSMTC reader | Pass. GSMTC reported the muted 60 s fixture as playing with the expected local metadata; observed pause, a seek to 31 s while paused, resume, title change, and session removal. No Spotify controls or web requests were used. | `%TEMP%\opencode\lyrics-smtc-3\smtc.json` |
| HWND-only visual capture against native Win32 fixture | Pass. FFmpeg encoded a 320 × 220 PNG and an eight-frame, 320 × 220 MP4. The video contained zero flat frames by the capture tool’s check. | `%TEMP%\opencode\lyrics-qa-fixture-tools-1\fixture.png`, `fixture.mp4`, `fixture.mp4.json` |

The input oracle re-run at `lyrics-oracle-selftest-4` did not pass: Windows reported the click at a different screen coordinate from the point requested, so that run is not evidence about hit testing. Use a dedicated interactive desktop during input tests. An initial SMTC run showed that the default `MediaPlayer` publisher did not report a paused seek; the passing fixture waits for the local seek to complete and explicitly updates the SMTC timeline.

No Eonara / LyricMotion Tauri click-through, native visual, or media integration result has been recorded in this log. The passing fixture checks do not establish native desktop behaviour. Browser preview and native benchmarks are separate; see [BENCHMARKS.md](BENCHMARKS.md).

## Reproduce

Run from the repository root in PowerShell on an unlocked interactive Windows desktop. Select fresh output paths for each run. Use the same integrity level for app and test runner; injected input cannot reach an elevated app from a normal shell. Don’t move the pointer, type, or run another desktop automation while the oracle is clicking.

```powershell
$qa = Join-Path $env:TEMP ("eonara-qa-" + (Get-Date -Format yyyyMMdd-HHmmss))
python -B tests/overlay_input_oracle.py self-test --out "$qa\oracle-control"
python -B tests/smtc_fixture_regression.py --out "$qa\smtc-control"
```

### Eonara native input

1. In an already running Windows build, open **Screen**. Turn **Show desktop lyrics** and **Click-through** on. Use demo playback so the lyric area is visibly populated, choose a non-fullscreen overlay size and make sure the overlay is entirely on one monitor. Keep the console accessible for the two test prompts.
2. Confirm the exact title with the following `list` command. Run the plan; at each prompt the receiver hides so you can use the app, then returns when you press Enter.

```powershell
python -B tests/overlay_input_oracle.py list --title '^Eonara'
python -B tests/overlay_input_oracle.py app --title '^Eonara Overlay$' `
  --plan tests/overlay_input_plan.json --out "$qa\oracle-app"
```

The plan tests the lyric area and an empty corner, with pass-through on and off; the foreground process must stay the receiver. `Ctrl+Alt+Shift+L` must hide the still-existing overlay HWND, restore the passive style and let the same pixel receive a click. Reopen using **Open Eonara** / **Show / Hide Overlay** in the tray at the last prompt. The target coordinates are fractions of the physical overlay client rect, so the plan avoids baked-in DPI assumptions. The background fixture receives the actual mouse messages and logs physical screen coordinates. Before each case the oracle clicks its visible uncovered area as a positive control. `WindowFromPoint`, overlay extended styles, focus and bounds are corroborating observations, not a substitute for receipt. The plan asserts whole-window blocking when disabled; it does not claim selective interaction.

### Eonara local SMTC integration

Keep other players untouched; in Eonara disable **Look up lyrics with LRCLIB** before following the fixture. In one PowerShell window:

```powershell
New-Item -ItemType Directory -Force "$qa" | Out-Null
$cmd = Join-Path $qa "smtc-app-commands.txt"
New-Item -ItemType File $cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -File spikes/qa/smtc_publisher.ps1 `
  -HoldSeconds 180 -CommandsFile $cmd
```

In another PowerShell using the same absolute `$cmd`, explicitly select **Eonara QA Local Track · Eonara QA** in **Other players → Follow player**. Select **Live** and import `tests/fixtures/smtc_local.lrc` for that recording. Observe title, artist, timing quality, and the live lyric view. Append commands one at a time and inspect before continuing:

```powershell
Add-Content -LiteralPath $cmd 'pause'
Add-Content -LiteralPath $cmd 'seek 31'
Add-Content -LiteralPath $cmd 'play'
Add-Content -LiteralPath $cmd 'title Eonara QA Local Track next'
Add-Content -LiteralPath $cmd 'exit'
```

The expected sequence is paused motion, the seek cue `Seek landed here`, continued motion after play, metadata title change without stale lyrics from the old title, then no fixture session. `spikes/qa/smtc_probe.ps1 -Title '<exact title>'` reads only matching Windows PowerShell SMTC entries and can independently log each step. These are checks to perform, not results.

### App-only visual capture

For an existing loopback browser preview, the smoke/visual run opens its own local Edge context, blocks other page HTTP/WebSocket origins, and saves PNGs plus JSON. It doesn’t attach to Tauri or use external services.

```powershell
python -B tests/browser_visual.py --url http://127.0.0.1:1443/ --out "$qa\browser"
```

For a running native app, select a visible window by exact title; only that HWND is asked to render. No desktop recording is used. Don’t drag or resize while recording.

```powershell
python -B spikes/qa/capture_window.py --title '^Eonara$' --out "$qa\native-main.png"
python -B spikes/qa/capture_window.py --title '^Eonara Overlay$' `
  --out "$qa\native-overlay.mp4" --seconds 5 --fps 12
```

`PrintWindow(PW_RENDERFULLCONTENT)` may return flat or partial frames for GPU-driven WebView2 windows. The tool rejects all-flat capture, writes actual capture offsets, and does not preserve native window alpha. Inspect the output before using it as evidence of rendering; use the live desktop oracle to validate transparent-window input.

## Historical v0.3 LyricMotion checkpoints

- `npm.cmd test` passed 50 tests (initial v0.3) / 71 tests (Milestones 0–5, 2026-11-25) / 74 tests (cinematic refinement, `4211a5d`).
- Isolated pre-rebrand `v0.3.0` staging build (`src-tauri/target/v03-staging`) produced `lyricmotion.exe` (`10,061,312` bytes) and `LyricMotion_0.3.0_x64-setup.exe` (`2,593,563` bytes).

## Eonara Rebrand Verification (2026-11-26, `rebrand/eonara`)

| Check | Scope | Actual result | Evidence |
| --- | --- | --- | --- |
| `npm.cmd test` | 10 unit suites (`src/**/*.test.ts`) | **74/74 passed** (`1.48s` on final re-run): clock, parse, lookup (`Eonara/0.3.0` UA check), gradientState, transport, palette (cold/warm/deep-blue/high-pink/low-sat & 13 `demoStylePalette` grades), materials (WCAG `>=4.5:1` / `>=7:1`), foundations, fixture, and `heroGeometry.test.ts` (24 tests) | Vitest CLI output |
| `npm.cmd run build` | TypeScript + Vite production bundle | **Pass** (`tsc --noEmit` clean; `dist/assets/index-Bqt7Y7y8.js` `809.67 kB`) | Vite build output |
| `tests/visual_fixtures.py --styles all` | Headless Edge WebGL2 `?fixture=` against `127.0.0.1:1443` | **Pass**: **190/190** fixture frames across `760×530`, `1182×741`, `1280×800`, DPR `1 / 1.25 / 2`, all 13 edge-case fixtures, and all 13 styles | `artifacts/eonara/fixtures/` |
| `tests/color_grain_audit.py` | Optical grain & 8 demo colour grades against `127.0.0.1:1443` | **Pass**: calibrated silver-halide grain (`7.617` @ DPR 1.0, `7.567` @ DPR 1.25, `7.333` @ DPR 2.0, `0.135` temporal RMS); distinct per-style grades (`ship` ΔE `2.45`, `branches` `1.95`, `web` `1.03`) | `artifacts/eonara/color-audit/` |
| `tests/browser_v03.py --motion` | Simulated Tauri IPC in headless Edge + FFmpeg clips | **Pass**: live duration/pause/seek/stale-artwork rejection, Zen gradient editor, all 13 styles & 7 background modes rendered with top-left **Eonara** emblem, `ship.mp4` & `fisheye.mp4` | `artifacts/eonara/v03/`, `docs/screenshots/` |
| `tests/browser_visual.py --presentation-seconds 10` & Splash/About captures | Loopback preview smoke, `?splash=1`, `#about-modal` (`1280×800`, `760×530`) | **Pass**: `0` console/page errors, `0` blocked requests, razor-sharp splash & About modal renders | `artifacts/eonara/browser-visual/`, `artifacts/eonara/ui/` |
| Native Cargo `check` & isolated `release` | `scripts/build-native.ps1` (`CARGO_BUILD_JOBS=2`, `CARGO_TARGET_DIR=src-tauri/target/eonara-staging`) | **Pass**: `cargo check` clean (`2m 25s`); release + NSIS bundle finished in `5m 21s`: `eonara.exe` (`10,395,136` bytes, `ProductName: Eonara`, `0.3.0`, SHA-256 `1F42D181943317CE29E28920B13DDDC8AC72BC81DD1AE6839EEE20888CD8BFD3`), `Eonara_0.3.0_x64-setup.exe` (`3,003,562` bytes, SHA-256 `0B7859D64E125617A99373D2A8AB0D1935221592CB32160E84C20515175611E1`) | `src-tauri/target/eonara-staging/release/`, `artifacts/eonara-release/SHA256SUMS.txt` |

**Explicit boundaries**: All browser checks above ran headless against loopback `vite preview` (or simulated Tauri IPC in `browser_v03.py`). Packaged desktop launch of `eonara.exe`, live Windows GSMTC playback, transparent desktop overlay focus, click-through pass-through via `overlay_input_oracle.py app`, tray/`Ctrl+Alt+Shift+L` recovery, and mixed-DPI physical monitor behavior remain **pending a controlled interactive Windows session**.
