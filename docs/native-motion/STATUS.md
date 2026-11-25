# Native/motion refinement lane

Branch: `refinement/native-motion`, worktree: `../Lyrics-native-motion`, base: `cbbd014`.
Do not merge into main without review of Gemini's visual branch and a dedicated integration branch.
No edits to `src/color/`, `src/style.css`, `src/ui.ts`, or the unrelated dirty media probe in the primary worktree.
User explicitly authorized only the native visibility integration in `src/main.ts` after a measured regression was found.

## Latest qualification state

- See [actual session evidence and performance](SESSION_01.md), not the historical pending gates below.
- Both Thread overlap and hidden main rendering were corrected. Tested fixed application source: `fcbb47d`.
- Native actual-receiver input/focus/shortcut/tray checks and controlled native media integration passed again on the fixed candidate. Zero main WebGL submissions while hidden/minimized; tray reopen resumes.
- Native Ship/Fisheye/Thread screenshots and clips, Spotify artwork/transport and distinct plain/line/word lyric coverage evidence are retained locally.
- Fixed hidden-playing and overlay-only resource remeasurement is underway; final cleanup still pending. Comprehensive animation refinement and Gemini integration remain deferred as requested.
- Canonical `main` and all original release artifacts remain untouched.

## Baseline provenance — read-only, 2026-11-25

Two running host processes were found:

- PID 36272: primary checkout `src-tauri/target/v03-staging/release/deps/lyricmotion.exe`, start `2026-11-25T23:24:28.006202+05:30`.
- PID 10172: primary checkout `artifacts/v0.3-migrated/lyricmotion.exe`, start `2026-11-25T23:33:17.131283+05:30`.

Both file paths currently contain version 0.3.0, 10,061,312 bytes,
SHA-256 `8d54caab01eb9699db9625d2ad5fb3b8e7f9a70ef45c43eccc5da9cbece98955`.
The staging release EXE has the same hash. Canonical `target/release/lyricmotion.exe`
remains version 0.1.0, hash `bf89c9bf00febbd6e32633f242d7e36dfc134c848517d78e20f0fdf41a555265`.
Process path/current-file identity is evidence, not a cryptographic attestation of mapped pages.
There is no single-instance plugin or guard in the checked native host; multiple hosts coexist,
so tray and recovery-shortcut ownership can be ambiguous. Screenshot process identity is unknown.

## Active tasks and commands

1. Record/reproduce provenance and prepare a consolidated native qualification session.
   Do not close hosts, foreground windows, synthesize input, change Spotify, or start controlled
   benchmarks before the user's desktop-window approval. Gate includes isolating the two hosts
   gracefully so only the selected build owns the tray/shortcut.
2. Audit/improve `spikes/qa/benchmark_process.py` process attribution and CPU accounting, add
   pure attribution regression tests. Acceptance: do not count unrelated browser or unrelated desktop processes;
   report ambiguous WebView ownership, inaccessible processes, identity, host vs inclusive memory.
3. Refine connected Ship wall, Fisheye staging, Message Thread weight/geometry while retaining
   deterministic seek, Unicode and reduced-motion infrastructure. Capture headless baseline and
   two candidate visual passes at matched dimensions/DPR. These do not qualify native composition.
4. Build in this worktree using an independent target and artifact folder, retain exact hashes.
   Native activation/desktop captures are pending approval. Integration is separate from lane build.

No native input/performance pass is claimed. Canonical handoff files are deliberately unchanged
while the other agent owns the visual lane. This status document is the lane handoff.

## Recovery checkpoint

- `f2b026c`: native self-provenance IPC, read-only inventory, attribution sampler and qualification instructions.
- Pending motion increment: neutral global weight dial now retains per-scene roles; narrower Ship registration, bounded cached rail plans, larger Fisheye type/history, cached speaker-side runs.
- Baseline frontend: 71 tests and production build passed; 75 headless frames captured.
- Candidate pass one: 72 tests and production build passed; 36 priority/font frames captured and priority contact sheets inspected. These are browser fixtures, not native evidence.
- Message Thread at 5600 ms still visibly overlaps during entry. Two-pass visual acceptance is **not complete**; do not package this as qualified.
- Mock-only input guard tests do not send desktop input. Real input/self-test, native benchmark and Gemini integration remain unrun.
- Six Python mock/pure tests passed (three input guard, three attribution). `git diff --check` passed. Independent Cargo check was restarted after an initial one-second timeout; result pending.

## Authorized session 01

- User approved one exclusive desktop session, including Spotify and controlled publisher. Independent Cargo check completed successfully.
- Disposable native input self-test passed (physical coordinates, pass/block control); independent SMTC/GSMTC control passed all six stages. Evidence: `artifacts/native-motion/session-01/{input-control,smtc-control}/`.
- Thread fix translates the measured stack together and reserves rotated incoming bounds; phase regression initially failed without rotation clearance, then all 72 unit tests and production build passed after compensation.
- Next command: independent release build with two Cargo jobs and `CARGO_TARGET_DIR=src-tauri/target/native-motion`. No benchmarks until compilation/capture jobs end and process inventory confirms a quiet baseline.
- Initial release/NSIS build completed. Before native launch, corrected a checkpoint mistake: actual model default weight is 600, not 700; the relative dial now uses 600 and a test references `defaults.weight`. Rebuild is required and will identify the tested candidate separately.
- Both original hosts were gracefully exited through their validated native tray Quit menus to release shortcut ownership. Spotify's first URI launch exited before testing; a normal app launch exposed its existing paused Reflections session. No playback controls have been sent yet.
- Thread's second inspected headless pass no longer overlaps at 5600 ms (36 frames); this remains supplemental to native capture.

- Follow-up ench-hidden-playing and ench-overlay-only 3-repetition raw captures completed cleanly (postflight-3.json reported zero blockers) before the qualification session was halted for release recovery. Summarization and final parity re-test were paused; lingering native test processes were closed gracefully.
