# Changelog

## 0.3.0-eonara

- Officially rebranded to **Eonara** (*The Art of Sound*).
- Generated unified Eonara visual identity: multi-resolution Windows `icon.ico` (`16`–`256 px`), `tray.png` + `tray-32x32.rgba`, NSIS installer `header.bmp` & `sidebar.bmp`, SVG wordmarks/marks, and GitHub hero/social preview banners.
- Added animated Eonara Splash Curtain (1.08 s non-blocking intro, inspectable with `?splash=1`, skipped in overlay/reduced-motion/fixture modes) and clickable **Eonara** top-left emblem opening the **About Eonara** modal.
- Updated tray controls (`Open Eonara`), overlay title (`Eonara Overlay`), `User-Agent` (`Eonara/0.3.0`), documentation, and `README.md` while keeping `app.lyricmotion.desktop` settings paths, local storage keys, and dynamic OKLab album shaders unchanged.

## 0.3.0

- Live progress uses the media session clock and duration. Lyric timing offsets affect cue selection. Imported rehearsal lyrics stay scoped to rehearsal.
- Ship uses measured word slabs and camera reframing. Fisheye deforms glyph geometry through a nonlinear lens. Visual variants use original contextual line drawings.
- Zen point layouts support keyboard entry, pointer positioning, rotation, presets and album-derived colours. Gallery and glass surfaces adapt to the palette.
- Refined default lyric weight and gallery spacing. The package includes Inter and Playfair Display SIL Open Font License notices.
- Added transport, gradient, contrast, motion geometry and offscreen fixture coverage. See [verification](docs/TEST_REPORT.md) for the native and visual test status.
