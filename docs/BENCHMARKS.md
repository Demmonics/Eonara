# Benchmarks

## Observed

On Windows, 2026-11-24, a three-second sampler check against the idle standalone Python Win32 receiver (six half-second intervals, no warmup) reported **0.0% time-weighted CPU** relative to one logical core, **19.27 MiB median working set** and **10.10 MiB median private bytes**. It observed only the fixture `python.exe` and reported no inaccessible PIDs. Raw artifact: `%TEMP%\opencode\lyrics-qa-fixture-tools-1\benchmark.json`. This validates collection on the fixture; it is not an app measurement.

No post-migration native LyricMotion resource, native animation presentation, GPU, power, or transport latency figures have been recorded here.

## Reproduce on LyricMotion

Prepare the scenario in an already-running app; this sampler does not launch, restart, debug, or change it. Use a release build for release claims. Use new paths for each run. Record the app build, Windows/WebView2 versions, display resolution, scale and refresh rate, active style/background, playback, and overlay dimensions. Keep them fixed within a comparison.

```powershell
$qa = Join-Path $env:TEMP ("opencode\lyrics-bench-" + (Get-Date -Format yyyyMMdd-HHmmss))
python -B spikes/qa/benchmark_process.py --title '^LyricMotion$' `
  --label 'release, demo paused, overlay hidden' --out "$qa\idle.json"
# Prepare each scenario before running its command:
python -B spikes/qa/benchmark_process.py --title '^LyricMotion$' `
  --label 'release, demo playing, overlay hidden' --out "$qa\main-playing.json"
python -B spikes/qa/benchmark_process.py --title '^LyricMotion Overlay$' `
  --label 'release, demo playing, passive overlay only, main window hidden' --out "$qa\overlay-playing.json"
```

Defaults are five seconds warmup, 30 seconds measurement, and 0.5 s interval. Repeat three times per scenario before quoting a comparison. Do not run video capture or the input oracle during sampling. CPU is process-tree kernel + user time per wall time; 100% is one logical core and values can exceed 100%. Working-set totals can count shared pages twice; use private bytes for committed private memory. The sampler lists process names and unavailable PIDs; disjoint WebView2 trees are not included, and CPU between process birth/exit and the next sample may be missed. Verify that the tree lists `msedgewebview2.exe` before treating a result as app plus renderer; if it does not, label the narrower scope as such.

For exploratory browser preview frame pacing (not native presentation), run against an already-running loopback preview:

```powershell
python -B tests/browser_visual.py --url http://127.0.0.1:1428/ `
  --presentation-seconds 10 --out "$qa\browser-frame-pacing"
```

The report retains raw headless `requestAnimationFrame` intervals, callback rate, p95 interval and counts above 20 and 33 ms for the selected preview style. This measures callback scheduling in a separate Edge context, not WebView2, GPU frame time, monitor presentation, or overlay smoothness. Do not use the FFmpeg capture frame rate as a render-performance figure either.

## v0.3 measurements

| Run | Actual result | Scope |
| --- | --- | --- |
| Headless Edge `158.0.4370.33`, 1280×800, Fisheye demo, 10 s (post-M5) | **144.02** `requestAnimationFrame` callbacks/s; **7.20 ms** p95 interval; **0** intervals above 20 ms or 33 ms | Browser scheduling only against local `vite preview` (`127.0.0.1:1428`). Application gates rendering at 60 Hz. Raw data in `.playwright/fixtures/final-visual/browser.json`. |
| Headless Edge shader optical grain check (`1182×741`, `gaps` @ 2400 ms, M5) | DPR 1.0 grain 23: **1.0297** 8-bit BoxBlur(2) luma residual std dev (`p95 |res| = 2.1404`) vs **0.0018** at grain 0; DPR 2.0 grain 23: **0.6859** (`p95 |res| = 1.2126`) | Headless WebGL2 pixel readback of `backgroundShaders.ts` atmospheric stage (`left_upper=[13.66, 33.96, 47.63]`, `right_upper=[39.9, 55.51, 67.25]`, `lower_band=[7.6, 19.36, 27.35]`). Raw data in `.playwright/fixtures/m5-color-ui/m5_metrics.json`. |
| Earlier pre-migration Headless Edge, 1280×800, Fisheye demo, 10 s | 144.02 callbacks/s; 7.10 ms p95; 0 above 20 ms | Baseline pre-migration browser scheduling (`%TEMP%/lyricmotion-v03-final-020758-bench/browser.json`). |
| Existing v0.1.0 process tree, 15 s | 72.91% of one core time-weighted; median 611.77 MiB working set and 546.61 MiB private | Older host and its WebView2 subprocesses, sampled without interacting. Playback, overlay and gallery state unknown. The staging build was active. Raw data in `%TEMP%/lyricmotion-v01-existing-021135.json`. |

GPU utilization, startup latency, and controlled native v0.3.0 scenarios (main host + overlay + WebView2) remain pending an approved physical desktop session.
