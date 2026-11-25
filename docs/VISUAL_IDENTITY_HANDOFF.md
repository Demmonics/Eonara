> **Branch Status**: Commit `7499721` passed full 72/72 Vitest + production build + Python visual audits. The follow-up Zen shader/UI WIP tweak (`a0a2502`) awaits final re-testing.

# Visual Identity, Colour Grading & Optical Grain — Codex Integration Handoff

- **Branch / Worktree**: `refinement/visual-identity`
- **Base Commit**: `cbbd0142` (`main`)
- **Scope Owner**: Antigravity (`src/color/*`, `src/ui.ts`, `src/style.css`, color/UI audit & test suites)
- **Status**: Ready for Codex visual + motion integration review on `refinement/native-motion` (**not** merged to `main`; `src/motion/`, `src-tauri/`, and `src/main.ts` were left untouched)

---

## 1. Summary of Changes Made on `refinement/visual-identity`

### Colour Grading & Background Shaders (`src/color/`)
- **[`src/color/palette.ts`](../src/color/palette.ts)**:
  - Calibrated all 13 `styleSeedSwatches` with higher tonal chroma separation for Demo mode, and updated `demoStylePalette()` to construct via `semanticPalette(..., true)` so curated Demo grades keep their signature hue saturation while `semanticPalette` preserves `>= 7:1` foreground and `>= 4.5:1` accent/muted contrast.
  - Preserved live OKLab artwork extraction (`paletteFromPixels`), grayscale cover handling, and manual swatch flows unchanged.
- **[`src/color/backgroundShaders.ts`](../src/color/backgroundShaders.ts)** & **[`src/color/BackgroundScene.ts`](../src/color/BackgroundScene.ts)**:
  - Decoupled `uTint` from linear background brightness modulation (`tintLustre = mix(0.94, 1.05, uTint)`) so default glass tint no longer crushes background glow by ~14%, and removed the vertical dark stripe (`centerShade = 1 - exp(-6.5 * p.x * p.x)`) down `p.x = 0`.
  - Softened the bottom vignette/feather (`smoothstep(-1.08, -0.18, p.y)`) and refined all 7 background modes (`atmospheric`, `liquid-glass`, `blurred-art`/`artwork`, `mesh`, `zen` automatic + interactive focal points, `minimal`, `manual`).
  - Calibrated `uLimit = 0.21` (with smooth shoulder highlight rolloff), `defaultBackgroundSettings.intensity = 0.78`, and `defaultBackgroundSettings.darkVeil = 0.36` so atmospheric highlight blooms remain luminous while center lyric zones hold crisp contrast.
  - Replaced screen-space `uv`-stretched grain with DPR-normalized sRGB-domain 35mm optical emulsion grain (`opticalEmulsionGrain(gl_FragCoord.xy, uDpr, uTime)`): unfloored native-pixel `hash3` micro-dither + continuous `valueNoise` octaves scaled continuously by `mix(1.0, 1.48, smoothstep(1.0, 2.0, uDpr))`, subtle dye chroma jitter, slow variance-compensated temporal evolution (`t * 2.4`), shadow-to-lit curve, and exact zero output when `uGrain == 0`.
- **[`src/color/materials.ts`](../src/color/materials.ts)**:
  - Tuned `toolbar`, `popover`, `gallery`, `cardBackdrop`, `border`, `specular`, and `shadow` derivations with verified WCAG `>= 4.5:1` muted-on-toolbar, `>= 4.5:1` muted-on-gallery, `>= 7:1` foreground-on-cardBackdrop, and `>= 4.5:1` accentInk-on-accent contrast across all 13 demo styles and bright/dark/busy album covers.

### Interface & Layout Refinement (`src/ui.ts`, `src/style.css`)
- **Frameless-ready header**: Changed `.top` to `<header class="top" data-tauri-drag-region>` and marked `.brand` and `.top-right` with `data-tauri-drag-region`; grouped `[Spotify · Apple Music · Other players | Refresh]` inside a single `.players.glass` capsule matching `.toolbar.glass`.
- **Stage-to-gallery transition**: Softened `.stage-lower` to `inset: 66% 0 0` feathering smoothly into `--env-gallery` with zero hard black seam.
- **Typography, transport & sliders**: Refined Playfair Display hero typography, `.live-empty` legibility shadow, pill button micro-hierarchy, and custom range slider track/thumb styling with crisp focus rings.
- **Whole-card gallery & expand grid (`src/ui.ts`, `src/style.css`)**:
  - Replaced clipped overflowing horizontal strip + scrollbar with exact whole-card column snaps (`2` cards `<= 900px`, `3` cards `901..1599px`, `4` cards `>= 1600px`, hidden scrollbar, accessible `gallery-prev` / `gallery-next` buttons, style count moved into `.gallery-head`).
  - Applied per-style palette CSS custom properties (`--tile-bg`, `--tile-p`, `--tile-s`, `--tile-a`) from `demoStylePalette` onto every `.tile`, added `.tile-category` eyebrow metadata, and added `object-fit: cover; object-position: center` on `.tile canvas` so cards never stretch or look unstyled.
- **Popovers, Zen editor & toast**: Compacted `.zen-canvas` height (`96px`), added subtle studio rule-of-thirds grid, raised `.popover` max-height (`min(636px, calc(100vh - 82px))`) so the entire Zen editor fits cleanly on `1280x800` without losing controls below the fold, and moved `.notice` toast to `top: 68px; right: 18px` clear of `.players.glass`.

---

## 2. Recommended Follow-Up Edits in Codex-Owned Files

Per ownership rules, `src/main.ts`, `src/motion/`, and `src-tauri/` were **not** modified on `refinement/visual-identity`. When merging/integrating with `refinement/native-motion`, apply these coordinated updates:

### A. `src/main.ts` & `src/ui.ts` — Crisp High-Resolution Style Gallery Thumbnails
- Currently `src/ui.ts` creates `<canvas width="180" height="88">` inside `.tile`, and [`src/main.ts#L530-L544`](../src/main.ts#L530-L544) sizes `thumbRenderer.setSize(180, 88, false)` and paints an opaque `tilePalette.background` + radial gradient fill onto the 2D canvas behind the rendered text.
- Because the redesigned gallery displays 2–4 larger cards (`~350–445 x 114–128 px` CSS pixels), raising `thumbRenderer` / tile canvas resolution to e.g. `360 x 156` (or `384 x 160`) and omitting the redundant solid `ctx.fillRect(0, 0, ...)` (so `.tile`'s smooth CSS radial gradient + `mix-blend-mode: screen` blends cleanly with crisp `MotionScene` typography) will noticeably sharpen gallery cards without hurting GPU budgets.
- Also check [`src/main.ts#L546`](../src/main.ts#L546): on initial load when `.tiles` scrolls or filters, `galleryDirty` steps cleanly across visible cards so none stall half-drawn.

### B. `src/main.ts#L562-L565` — High-DPI Canvas Resolution During Native Qualification
- Non-fixture mode currently caps canvas DPR at `Math.min(devicePixelRatio, 1.5)`.
- Our shader optical grain (`opticalEmulsionGrain`) is normalized continuously across `DPR 1.0 .. 2.0`. When running Windows WebView2 GPU performance benchmarks on `1.25x` and `2.0x` displays, test whether allowing up to `2.0` DPI on desktop hardware (or keeping `1.5` cap per GPU budget) gives optimal sharpness vs frame pacing.

### C. `src-tauri/tauri.conf.json` & `src-tauri/src/` — Integrated Frameless Main Window Chrome
- [`src-tauri/tauri.conf.json#L13-L20`](../src-tauri/tauri.conf.json#L13-L20) currently leaves default Windows OS title bar decorations enabled on the `main` window.
- `src/ui.ts` already applies `data-tauri-drag-region` to `.top`, `.brand`, and `.top-right` with `user-select: none` and clean grid spacing.
- Recommended Tauri integration:
  1. Set `"decorations": false` on `app.windows[0]` (and keep `shadow: true` / Windows 11 rounded corners via window style or DWM attribute).
  2. When `isTauri` is true, mount compact Minimize / Maximize / Close caption buttons inside `.top-right` after `.players` (matching `.icon-button` glass geometry) and style hover/close states cleanly without `data-tauri-drag-region` swallowing button clicks.
  3. Qualify native Windows WebView2 frame pacing, DWM transparency on the separate `overlay` window, real GSMTC media + album artwork extraction, and optical grain visual fidelity on physical Windows DPI scales (`100%`, `125%`, `150%`, `200%`).

---

## 3. Qualification Boundaries

- All automated checks (`npm.cmd test`, `npm.cmd run build`, `tests/color_grain_audit.py`, `tests/ui_refinement_suite.py`, `tests/browser_v03.py`, `tests/visual_fixtures.py`) were executed against headless Edge WebGL2 serving the production Vite bundle on loopback port `1439`.
- **Headless browser WebGL2 checks do NOT prove native Tauri WebView2 overlay behavior, DWM composition, real `rAF` native FPS, or live GSMTC playback** — those remain Codex's native qualification gates on `refinement/native-motion`.
