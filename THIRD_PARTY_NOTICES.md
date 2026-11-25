# Third-Party Notices

## Project License

LyricMotion is dual-licensed under `MIT OR Apache-2.0` (see `LICENSE`, `LICENSE-MIT`, and `LICENSE-APACHE`).

## Bundled Fonts

- **Inter Variable** — SIL Open Font License 1.1 (`public/licenses/Inter-OFL.txt`)
- **Playfair Display** — SIL Open Font License 1.1 (`public/licenses/Playfair-Display-OFL.txt`)

## Major Open-Source Dependencies

Exact dependency versions and hashes are pinned in `package-lock.json` and `src-tauri/Cargo.lock`:

- **Frontend**: `three` (MIT), `@tauri-apps/api` (MIT OR Apache-2.0), `yaml` (ISC), `@fontsource-variable/inter` (OFL-1.1), `@fontsource-variable/playfair-display` (OFL-1.1)
- **Native Rust Host**: `tauri` & `tauri-plugin-global-shortcut` (MIT OR Apache-2.0), `windows` & `windows-future` (MIT OR Apache-2.0), `serde` & `serde_json` (MIT OR Apache-2.0), `sha2` (MIT OR Apache-2.0), `base64` (MIT OR Apache-2.0)

## Visual Inspiration & Clean-Room Attribution

- Choreographic styles and editorial visual treatments were originally designed and implemented in Three.js/WebGL2 for LyricMotion, taking visual inspiration from Verci's kinetic typography concepts. No third-party source code, proprietary fonts, or proprietary media assets are included.
- Album-wide colour adaptation draws conceptual inspiration from LiquidMusic; the OKLab/OKLCH palette extractor and shader pipeline are original implementations in `src/color/`.
- Lyrics lookup supports LRCLIB's public `/api/get` endpoint and parses `.lrc`, `.ttml`, and draft Lyricsfile YAML locally. The bundled demo (`Original demo · A room of blue`) is original content.
