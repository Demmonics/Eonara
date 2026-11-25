# Dynamic color engine

The color engine uses the artwork bytes supplied by the native media session. It does not read Spotify styles, swatches, or UI state. The useful visual cue from the [reference study](VISUAL_ANALYSIS.md) is the hierarchy: neutral active lyrics, a subdued backdrop, and chromatic accents for selection and progress. The palette, rendering code, and test images are independent.

## Extraction and role selection

The palette worker decodes artwork into an sRGB thumbnail whose longest edge is at most 96 px. Pixels below 12% alpha are ignored; remaining pixels contribute by alpha. An RGB histogram groups neighboring 8-bit samples into five bits per channel, retaining average RGB values for each occupied bin. Those averages enter OKLab, a perceptual color space that makes hue and lightness differences easier to compare.

The quantizer seeds up to nine centers deterministically using distance to the nearest existing center and the fourth root of bin population. Up to ten weighted Lloyd iterations move the centers toward the actual pixel distribution. This gives both dense color fields and smaller, distinct colors a chance to be represented. When choosing roles, the engine balances coverage and chroma for the primary, adds distance from the primary for the secondary, and favors more chromatic colors for the accent. Very small clusters do not drive roles. If there are no distinct hues, a related tone gives the backdrop some range.

Desaturated artwork stays desaturated. If less than 3.5% of alpha-weighted pixels exceed OKLab chroma 0.035 **and** fewer than 1.2% exceed chroma 0.095, the engine derives an achromatic palette from mean lightness. Transparent or undecodable artwork uses the default palette instead.

The seven roles are opaque sRGB hex colors. Tone mapping keeps the backgrounds dark; out-of-gamut colors lose chroma rather than clipping individual channels. The engine checks the quantized, 8-bit output against both `surface` and `background`. Neutral `foreground` targets at least 7:1; `mutedForeground` and `accent` target at least 4.5:1. `primary` and `secondary` are decorative seeds, not text colors. The shader limits backdrop luminance after applying the grain and veil, so it does not defeat the generated text colors' contrast. Arbitrary user text overrides and translucent UI overlays need their own contrast checks.

## Quantizer comparison

Reproduce with `npm exec -- vitest bench --run src/color/quantizer.bench.ts`. The benchmark uses five generated 96×96 covers: a flat graphic, dark gradients with a small light, a high-color gradient, monochrome, and a monochrome field with a small vivid spot. It compares nine output colors, using identical input histograms. The quality measure is alpha-weighted RMS distance to the closest output color in OKLab (lower is better). This measures color reconstruction, not artistic suitability; semantic role tests separately check the spot-color and monochrome behavior.

| Candidate | Poster | Night | Spectra | Monochrome | Spot | Mean time / all five |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Most frequent RGB bins | 0.1567 | 0.0483 | 0.1452 | 0.1563 | 0.0485 | 0.43 ms |
| Weighted median cut in OKLab | 0.0216 | 0.0169 | 0.0921 | 0.0260 | 0.0110 | 3.27 ms |
| Weighted k-means in OKLab | **0.0121** | **0.0167** | **0.0799** | 0.0272 | **0.0065** | 7.37 ms |

Timing is one local Windows / Node.js 24 / Vitest 4 run, excluding artwork decode, histogram construction, and worker transport. Counting bins is cheap but often picks multiple near-identical representatives. Median cut gives useful coverage at a lower cost than k-means but did worse on the graphic, broad spectrum, and sparse accent. Bounded k-means was chosen for those cases; monochrome takes a separate fast path in production. No result from this synthetic suite is a guarantee about all cover art.

Method references: [Ottosson's OKLab conversion matrices](https://bottosson.github.io/posts/oklab/), [Heckbert's median-cut quantization](https://doi.org/10.1145/965145.80129), and [WCAG relative luminance and contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Background rendering

One Three.js mesh fills the viewport. A WebGL fragment shader paints the selected mode in linear light, with a darker reading area, fixed fine-grain noise, and an adjustable dark veil. No scene lights, post-processing passes, timer, or internal frame loop are needed.

| Mode | Rendered field |
| --- | --- |
| Atmospheric | Slow, broad pools of color with a dark center |
| Liquid Glass | Warped bands and highlights with adjustable reflection strength |
| Blurred art | Mipmapped blur of the actual cover, cropped to fill the viewport; atmospheric fallback until ready |
| Mesh | Overlapping, moving soft gradient sources |
| Minimal | Quiet static tint |
| Manual | Static gradient using a caller-provided manual palette |

Only Blurred art loads a texture. The canvas-backed texture has a longest edge of at most 192 px, is mipmapped, and is disposed when artwork changes or the scene is destroyed. Late image completions are ignored after a source change or disposal. The next valid image fades in over the procedural fallback; reduced motion displays it without a fade. The app owns the GPU renderer and should fall back to a solid `palette.background` if it cannot initialize WebGL.

Artwork changes should trigger a palette transition, not playback ticks. Transitions blend in OKLab and recalculate contrast as needed. If a track changes halfway through a transition, the next one starts at the sampled intermediate value rather than at either old endpoint. Reduced motion can snap palettes using a zero duration.

## v0.3 material and shader update

Palette hex values enter Three.js through its sRGB-aware colour conversion. The background fragment combines linear RGB values, applies the luminance roll-off and uses Three.js output colour-space conversion. The artwork texture is marked sRGB and enters the same linear pass. CPU palette transitions operate in OKLab and may gamut-map on conversion. This is separate from the fragment's linear spatial mixing.

For dark glass and light ink, the material helper bounds SDR contrast over a white backdrop, solves for sufficient opacity and falls back to an opaque dark material if the original tint and text cannot reach 4.5:1. Backed words choose the highest viable contrast among neutral inks. This analytical bound covers the specified base material and ink. Pixel-level contrast is still needed for additional overlays, custom lyric colour overrides and transient effects.
