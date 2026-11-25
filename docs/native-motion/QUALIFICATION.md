# Controlled Windows qualification — approval pending

These commands do **not** constitute passed tests. Keep Gemini, emulators, compilations,
capture and GPU test jobs idle before measuring. No synthetic input may reach study apps.
All outputs are private ignored artifacts, never uploaded. This lane cannot qualify or
benchmark the final integration build until it exists.

## Before the session (read-only, no focus changes)

```powershell
pwsh -NoProfile -File spikes/qa/native_inventory.ps1 `
  -Out artifacts/native-motion/session-01/inventory-before.json
python -B tests/overlay_input_oracle.py list --title '^LyricMotion'
```

Match the selected host's path, version and SHA-256. The preserved baseline is
`../Lyrics/artifacts/v0.3-migrated/lyricmotion.exe`; do not run canonical 0.1.0 by accident.
Two v0.3 hosts were found. During the **approved** session use each host's real tray Quit
to exit duplicates gracefully, then launch exactly the selected binary. Recovery shortcut
registration and tray identity must be confirmed in this single-host state. No source
single-instance mechanism was found, and no redirect is assumed. Closing main only hides it.

## Interactive input window

1. Confirm disposable receiver is the foreground target and pointer is idle elsewhere.
   Run the self-test into a fresh directory. If requested and received physical coordinates
   differ, stop input testing. Capture DPI contexts, virtual-screen bounds, client→screen
   mapping and received coordinates; don't waive a mismatch.
2. In the selected app enable a populated passive overlay. Follow the interactive plan.
   The harness validates actual receiver messages and focus, not only styles/hit-test queries.
3. Manual controlled follow-up: right-click and context menu, double-click, wheel, drag
   underlying disposable window, type into its field, taskbar, recovery and hide/show.
   The existing automated oracle covers left down/up, not these additional operations.
4. Native capture main, visible lyric and empty overlay areas over controlled light/dark
   receivers; note GDI GPU-frame/alpha limitations. Observe actual transparent holes.

```powershell
python -B tests/overlay_input_oracle.py self-test --out artifacts/native-motion/session-01/input-control
python -B tests/overlay_input_oracle.py app --title '^LyricMotion Overlay$' `
  --plan tests/overlay_input_plan.json --out artifacts/native-motion/session-01/input-app
python -B tests/smtc_fixture_regression.py --out artifacts/native-motion/session-01/smtc-control
```

Follow the existing `docs/TEST_REPORT.md` local SMTC publisher/import procedure against the
actual selected host: pause → seek 31 while paused → resume → title change → removal.
Source-specific Spotify tests need user-authorized playback, art and seek; do not control
Spotify implicitly. Record quality/provenance of lyric timing. Missing external monitors
and unavailable DPI configurations remain explicitly unverified.

## Benchmark window — no recording/input/compilation concurrently

Capture a new inventory and scenario notes first. Five seconds warmup, 30 seconds,
0.5-second interval; repeat each scenario three times. Use PID to disambiguate windows.

```powershell
python -B spikes/qa/benchmark_process.py --pid <selected-host-pid> `
  --label 'v0.3 hash; main open; demo paused; overlay hidden; Ship; Atmospheric; gallery collapsed' `
  --out artifacts/native-motion/session-01/paused-1.json
```

Repeat for main playing; overlay only (main hidden); tray idle; live main; live overlay;
gallery expanded/collapsed; Ship/Fisheye/one spatial style. Log exact dimensions, DPR,
display refresh, OS, WebView2 and playback state. Do not claim comparing unlabelled states.

The updated sampler reports host-only and inclusive working set/private bytes, CPU per
core and normalized to logical CPU count, process identities, WebView inventory, churn
and explicit scope limits. It follows creation-validated parent edges. If a proven app
WebView root is disjoint, explicitly pass `--renderer-root-pid <pid>`; arbitrary image-name
matches are forbidden. If ownership is ambiguous because two hosts share a WebView profile,
fix the test setup rather than combine their counters. CPU of between-sample exiting
processes can be missed; sums of working sets may duplicate shared pages.

GPU and real presentation: inspect available `wpr.exe -profiles` / ETW capabilities first.
Use trace collection only during the approved session with appropriate consent and keep
the file local (system traces may include unrelated metadata). PresentMon is not currently
on PATH. No GPU or presentation measurement is fabricated from rAF or capture FPS.
The collector does not collect either. Startup must separately measure launch→usable frame
under a controlled cold/warm host, without a dev server.

## Integration

Review Gemini's branch commits and shared interfaces, then merge both lanes into a new
integration branch (not main). Run tests, build, deterministic fixtures, native check and
package into a distinct directory with a build manifest. Repeat affected native gates on
that binary; native qualification of the preserved baseline does not transfer automatically.
