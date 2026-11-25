# LyricMotion architecture

The two surface types share a TypeScript/Vite/Three.js renderer. The main surface has an atmospheric shader pass, a typography pass and an accessible DOM interface. The transparent surface has only the typography pass unless the user explicitly increases backdrop opacity. On playback both surfaces derive time from a native timeline snapshot plus a local monotonic clock; they don't independently guess what is playing. Rust/Tauri owns Windows integration and OS window lifetime.

| Path | Responsibility |
|---|---|
| `src-tauri/` | WinRT/GSMTC session inventory and thumbnail streams, Tauri windows, tray and native recovery |
| `src/model.ts`, `src/main.ts` | Clock anchoring, session selection, cancellation, demo/live split, renderer lifecycle and typed events |
| `src/lyrics/` | Independent timed-document providers, lookup and matching, parsing and estimates |
| `src/motion/` | Deterministic geometry, shaped typography, animation scene selection |
| `src/color/` | Independent artwork decode and palette extraction, semantic colours, interpolation and background GPU pass |
| `src/ui.ts`, `src/style.css` | Preview, gallery, floating controls, accessibility and status interaction |
| `src/storage.ts` | Local IndexedDB font and user-supplied lyric persistence |
| `spikes/`, `tests/` | Feasibility, Windows input/timing probes and verification |

The artwork cache never drives the transport clock. Palette transitions and style switches do not change the playback time, and asynchronous art or lyrics from old track generations are discarded. `src/model.ts` separates platform snapshots from rendering. No remote browser content is needed. A permitted lyrics lookup sends only track identification fields to the provider. There is no Spotify authentication, Spotify Web API, Spicetify runtime dependency or backend.

Provisional decision: Windows x64 using MSVC-target Rust and an accelerated WebView2 transparent surface. The DLL/graphics trust gate and cross-process input probe determine whether this is fit for release. Browser previews do not prove either property.

## v0.3 implementation update

`src/transport.ts` projects player position, known duration and offset cue time from the same clock. Lyrics lookup cancels superseded requests and checks the generation before publishing. Artwork separately checks the generation and request sequence, including after decode. `src/color/gradientState.ts` validates persisted points and presets. `src/color/materials.ts` maps the palette to toolbar, popover, gallery and ink roles.
