# Palette integration protocol

The public entry point is [`src/color/index.ts`](../src/color/index.ts).

```ts
paletteFromArtwork(dataUrl: string, artworkHash?: string): Promise<DynamicPalette>
defaultPalette: DynamicPalette
manualPalette(primary: string, secondary: string, accent: string): DynamicPalette

new PaletteTransition(initial?: DynamicPalette, durationMs?: number)
transition.setTarget(target: DynamicPalette, timeMs: number, durationMs?: number): void
transition.sample(timeMs: number): DynamicPalette
transition.isActive(timeMs: number): boolean

new BackgroundScene(onInvalidate?: () => void)
background.scene  // Three.js Scene
background.camera // Three.js OrthographicCamera
background.update(width: number, height: number, timeMs: number,
                  palette?: DynamicPalette, settings?: BackgroundSettings): void
background.isAnimated(settings?: BackgroundSettings): boolean
background.dispose(): void
```

## Native artwork and cache

Pass the native artwork payload (`{ dataUrl, hash }`) as `paletteFromArtwork(dataUrl, hash)`. Pass the same `dataUrl` to `BackgroundSettings.artworkDataUrl` for Blurred art. The frontend accepts standard base64 raster image data URLs, not remote URLs or SVG. Payloads above 16 MiB encoded are rejected. The worker returns a default palette for invalid or unsupported images; calls also resolve to the default if the worker is unavailable or times out.

Use a stable **content** hash from the native interface, not the track ID or an artwork URL. When no native hash is supplied, the worker computes SHA-256 from decoded file bytes rather than from data-URL formatting. The native hash and SHA-256 paths use separate key namespaces. If hashing is unavailable and there is no native hash, extraction still works without caching. The worker holds a 64-entry least-recently-used cache of successful palettes, never cached artwork. Concurrent duplicates share a promise; one job runs at a time with at most four waiting. On overflow, the oldest waiting job resolves to the default. A job has five seconds to complete before the worker is reset.

An extraction promise is not tied to the current track or settings. Capture an artwork request generation or track key and ignore results from older generations, especially after a mode/lock change. Choose `defaultPalette` immediately for known missing artwork. In manual mode, call `manualPalette` with the settings swatches and skip extraction. `manualPalette` accepts three- or six-digit hex and falls back separately for invalid colors. It preserves valid primary and secondary colors and raises accent lightness if needed for contrast.

## Roles and transition

| `DynamicPalette` field | Intended use |
| --- | --- |
| `primary`, `secondary` | Decorative gradient and tint sources |
| `accent` | Focus, selection, highlight backing, and progress; use `background` for text on a solid `accent` fill |
| `background` | Opaque root fallback |
| `surface` | Opaque control, settings, and overlay surfaces |
| `foreground` | Neutral active lyric and other high-priority text |
| `mutedForeground` | Secondary text on a solid surface or the backdrop |

All roles are `#rrggbb` strings. For a manual active-lyric override, use the app's explicit text color control; the palette still supplies a contrast-safe neutral fallback.

Use monotonic time such as `performance.now()` consistently for transitions, not the track's seek position. The default duration is 850 ms; pass `0` to snap when reduced motion is enabled. Sampling at completion returns the target unchanged. Sending the same target repeatedly does not restart an active blend.

## Renderer and settings

Use a single existing renderer and frame loop. Pass the size of the region being rendered; drawing-buffer pixels keep grain at pixel size on high-DPI screens. Update before calling `renderer.render(background.scene, background.camera)`. The constructor invalidation callback can request a frame after asynchronous artwork decoding (required when static and demand-rendered). A paused app can stop its loop when playback, lyrics, palette transition, and `background.isAnimated()` no longer require updates. Call `background.dispose()` to release scene resources, and dispose of the renderer separately when the view owns it.

| `BackgroundSettings` key | Type / interpretation | Default |
| --- | --- | --- |
| `mode` | `atmospheric`, `liquid-glass`, `blurred-art` (`artwork` alias), `mesh`, `minimal`, `manual` | `atmospheric` |
| `intensity` | Visual field strength, 0–1 | 0.76 |
| `motion` | Ambient movement speed, 0–1 | 0.46 |
| `grain` | Static grain, 0–1 | 0.23 |
| `darkVeil` | Dark overlay strength, 0–1 | 0.39 |
| `blur` | Artwork blur, 0–1 | 0.73 |
| `saturation` | Backdrop saturation from grayscale to palette chroma, 0–1 | 1 |
| `brightness` | Brightness of decorative fields, 0–1 | 1 |
| `tint` | Palette tint contribution, 0–1 | 0.76 |
| `glass` | Highlight strength in Liquid Glass mode, 0–1 | 0.64 |
| `contrast` | Strength of the dark reading area, 0–1; does not disable the contrast guard | 0.5 |
| `artworkDataUrl` | Native image data URL or `null` | Not set |
| `reducedMotion` | Disables shader movement and artwork fades | `false` |

All settings fields are optional. Convert percentages in app settings by dividing by 100. `defaultBackgroundSettings` exports the defaults, and `BackgroundMode` and `BackgroundSettings` export the mode and control types. Manual mode changes how the supplied colors are drawn; it does not call `manualPalette` for you.
