# LyricMotion

LyricMotion is a Windows desktop app for synchronized lyrics, animated typography, and backgrounds shaped by album artwork. It includes 13 visual styles and an original demo with playback controls, so you can explore it before connecting a music session.

- Preview kinetic type, spatial scenes, and interface-inspired lyric treatments in the style gallery.
- Follow compatible Windows media sessions and place timed lyrics in a configurable desktop overlay. Use **Ctrl+Alt+Shift+L** or the tray menu to hide the overlay and restore click-through.
- Import your own `.lrc`, `.ttml`, Lyricsfile YAML, or plain-text lyrics. Highlighting follows available timing data. Line-only lyrics use line timing.
- Customize typography, background modes, and album-derived or manual colours.

## Run the demo

From the repository root, use Node.js 24 and npm.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the loopback URL shown by Vite. Choose **Demo** to explore the styles and use the timeline controls. This preview runs in the browser. The Windows build provides media-session access, the tray, and the desktop overlay.

## Build the Windows app

Use Windows 11 x64 with the WebView2 Evergreen Runtime, the stable Rust MSVC toolchain, and Visual Studio C++ Build Tools with a Windows SDK. Open a Developer PowerShell for Visual Studio and run these commands from the repository root.

```powershell
npm.cmd ci
.\scripts\build-native.ps1 -Mode dev
```

For the NSIS installer, run `.\scripts\build-native.ps1 -Mode release` from the same shell. This repository is a development snapshot. The staged desktop preview and deterministic browser fixtures have been exercised. Live playback compatibility, overlay input across other apps, and mixed-DPI setups still need broader Windows verification.

## Lyrics and privacy

The app uses Windows media metadata and artwork for live sessions. Optional LRCLIB lookup sends the current track's title, artist, album, and approximate duration. You can disable lookup in player diagnostics and use local lyric files. The project bundles an original demo and carries no third-party lyric catalog.

## Development

```powershell
npm.cmd test
npm.cmd run build
```

The TypeScript renderer uses Three.js for lyric and background scenes. The [Tauri host](src-tauri/README.md) handles Windows media-session events, overlay windows, and settings. The [lyrics module](src/lyrics/README.md) handles parsing, normalization, and lookup. The visual fixture runner in `tests/visual_fixtures.py` samples the renderer at fixed cue times.

Project-wide reuse terms have not been specified. The bundled font notices are in [public/licenses](public/licenses).
