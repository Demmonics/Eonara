"""Render and measure 4+ optical grain candidates (across DPR 1, 1.25, 2) and colour-grade candidates
using real WebGL2 fragment shaders in headless Edge, saving contact sheets and 4x grain crops.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

GRAIN_TEST_HTML = r"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>html,body,canvas{margin:0;padding:0;width:100%;height:100%;display:block;overflow:hidden;background:#090b10;}</style></head>
<body>
<canvas id="c"></canvas>
<script>
const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON_FN = `
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float hash3(vec2 p, float z) {
  vec3 q = fract(vec3(p.x, p.y, z) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) - 0.5;
}
float lightPool(vec2 p, vec2 center, vec2 squash, float scale) {
  vec2 d = (p - center) * squash;
  return exp(-dot(d, d) * scale);
}
vec3 linearToSrgb3(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
vec3 srgbToLinear3(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}
`;

function makeFS(gradeVariant, grainVariant) {
  const gradeCode = gradeVariant === 'baseline' ? `
    vec2 a = vec2(-0.56, 0.24);
    vec2 b = vec2(0.58, 0.34);
    vec2 c = vec2(0.45, 0.54);
    float dusk = lightPool(p, a, vec2(0.86, 1.22), 1.25);
    float tide = lightPool(p, b, vec2(1.05, 0.96), 1.48);
    float highlight = lightPool(p, c, vec2(0.95, 1.55), 2.75);
    float lowerShadow = mix(0.46, 1.0, smoothstep(-0.92, 0.38, p.y));
    vec3 color = (uPrimary * (0.54 * dusk) + uSecondary * (0.48 * tide) + uAccent * (0.16 * highlight)) * lowerShadow;
    float radial = smoothstep(0.25, 1.7, length(p));
    float centerShade = 1.0 - (0.10 + 0.16 * 0.80) * exp(-6.5 * p.x * p.x);
    vec3 linear = uBackground + color * (0.739 * centerShade * (1.0 - 0.38 * 0.72 * radial));
    linear *= 1.0 - 0.36 * 0.58;
  ` : gradeVariant === 'balanced' ? `
    // Candidate 1: Restrained studio diagonal sweep + warm focal rim
    vec2 a = vec2(-0.62, 0.18);
    vec2 b = vec2(0.42, 0.26);
    vec2 c = vec2(0.92, 0.22);
    float dusk = lightPool(p, a, vec2(0.75, 1.05), 1.05);
    float tide = lightPool(p, b, vec2(0.82, 0.92), 1.05);
    float highlight = lightPool(p, c, vec2(0.90, 1.15), 1.45);
    float lowerFeather = mix(0.24, 1.0, smoothstep(-1.02, -0.05, p.y));
    vec3 baseWash = mix(uBackground, uPrimary * 0.55, 0.65);
    vec3 color = (uPrimary * (0.68 * dusk) + uSecondary * (0.95 * tide) + uAccent * (0.42 * highlight)) * lowerFeather;
    float radial = smoothstep(0.45, 1.85, length(p));
    vec3 linear = baseWash * lowerFeather + color * (1.0 - 0.22 * 0.72 * radial);
    linear *= mix(1.0, 0.74, 0.58);
  ` : `
    // Candidate 2: Verci-calibrated diagonal cyan/magenta studio field + subtle amber edge bloom
    vec2 a = vec2(-0.68, 0.12);
    vec2 b = vec2(0.32, 0.22);
    vec2 c = vec2(1.06, 0.18);
    float dusk = lightPool(p, a, vec2(0.72, 1.0), 0.95);
    float tide = lightPool(p, b, vec2(0.78, 0.92), 0.92);
    float highlight = lightPool(p, c, vec2(0.92, 1.08), 1.35);
    float lowerFeather = mix(0.22, 1.0, smoothstep(-1.06, -0.10, p.y));
    vec3 baseWash = mix(uBackground, uPrimary * 0.58, 0.72);
    vec3 color = (uPrimary * (0.76 * dusk) + uSecondary * (1.12 * tide) + uAccent * (0.52 * highlight)) * lowerFeather;
    float radial = smoothstep(0.50, 1.90, length(p));
    vec3 linear = baseWash * mix(0.32, 1.0, smoothstep(-1.05, -0.20, p.y)) + color * (1.0 - 0.20 * 0.72 * radial);
    linear *= mix(1.0, 0.80, 0.58);
  `;

  let grainCode = '';
  if (grainVariant === 'A_baseline') {
    grainCode = `
      float fhdScale = clamp(min(uSize.x, uSize.y) / 720.0, 0.72, 1.5);
      vec2 grainUv = (vUv * uSize) / (1.35 * fhdScale);
      vec2 microUv = (vUv * uSize * uDpr) * 0.42;
      float g = valueNoise(grainUv * 0.78 + 17.3) * 0.62 + valueNoise(grainUv * 1.54 - 11.1) * 0.26 + valueNoise(microUv + 7.1) * 0.12;
      float lumBase = dot(linear, vec3(0.2126, 0.7152, 0.0722));
      float gs = uGrain * (0.015 + 0.044 * sqrt(max(lumBase, 0.005)));
      linear = max(vec3(0.0), linear + clamp(g, -0.5, 0.5) * gs);
      vec3 srgb = linearToSrgb3(linear);
    `;
  } else if (grainVariant === 'B_fine_dither') {
    grainCode = `
      vec3 srgb = linearToSrgb3(linear);
      float lumS = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
      vec2 px = gl_FragCoord.xy / mix(1.0, 1.45, smoothstep(1.0, 2.0, uDpr));
      float n1 = hash3(floor(px), 3.0) - 0.5;
      float n2 = valueNoise(px * 0.82 + 19.7);
      float g = n1 * 0.55 + n2 * 0.45;
      float amp = (uGrain / 0.23) * 0.048 * mix(0.65, 1.10, smoothstep(0.06, 0.42, lumS));
      srgb = clamp(srgb + vec3(g * amp), 0.0, 1.0);
    `;
  } else if (grainVariant === 'C_optical_35mm') {
    grainCode = `
      vec3 srgb = linearToSrgb3(linear);
      float lumS = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
      float dprNorm = mix(1.0, 1.55, smoothstep(1.0, 2.0, uDpr));
      vec2 px = gl_FragCoord.xy / dprNorm;
      float fine = hash3(floor(px), 7.0) - 0.5;
      float med = valueNoise(px * 0.62 + vec2(11.3, 5.7));
      float soft = valueNoise(px * 0.28 - vec2(4.1, 13.9));
      float lumaNoise = fine * 0.58 + med * 0.30 + soft * 0.12;
      float chromaJitter = (hash3(floor(px * 0.85), 29.0) - 0.5) * 0.08;
      // Photographic shadow rolloff + crisp lit texture matching ~6.5..10 sRGB levels
      float amp = (uGrain / 0.23) * 0.108 * mix(0.66, 1.18, smoothstep(0.05, 0.36, lumS));
      vec3 gVec = vec3(lumaNoise + chromaJitter, lumaNoise - chromaJitter * 0.35, lumaNoise - chromaJitter * 0.65);
      srgb = clamp(srgb + gVec * amp, 0.0, 1.0);
    `;
  } else {
    grainCode = `
      vec3 srgb = linearToSrgb3(linear);
      float lumS = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
      float dprNorm = mix(1.0, 1.60, smoothstep(1.0, 2.0, uDpr));
      vec2 px = gl_FragCoord.xy / dprNorm;
      float fine = hash3(floor(px * 0.88), 11.0) - 0.5;
      float clumpy = valueNoise(px * 0.44 + vec2(21.7, 9.1));
      float g = fine * 0.48 + clumpy * 0.52;
      float amp = (uGrain / 0.23) * 0.145 * mix(0.68, 1.20, smoothstep(0.05, 0.38, lumS));
      srgb = clamp(srgb + vec3(g * amp), 0.0, 1.0);
    `;
  }

  return `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform vec2 uSize;
  uniform float uDpr, uGrain;
  uniform vec3 uPrimary, uSecondary, uAccent, uBackground;
  ${COMMON_FN}
  void main() {
    float ratio = uSize.x / uSize.y;
    vec2 p = (vUv * 2.0 - 1.0) * vec2(clamp(ratio, 0.67, 1.7), 1.0);
    ${gradeCode}
    ${grainCode}
    float lum = dot(srgbToLinear3(srgb), vec3(0.2126, 0.7152, 0.0722));
    if (lum > 0.38) {
      vec3 lin = srgbToLinear3(srgb);
      lin *= (0.38 + (lum - 0.38) * 0.22) / max(0.00001, lum);
      srgb = linearToSrgb3(lin);
    }
    fragColor = vec4(srgb, 1.0);
  }`;
}

window.__renderCandidate = (gradeVariant, grainVariant, hexes, grainVal, dpr) => {
  const c = document.getElementById('c');
  const w = 1280, h = 800;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true });
  gl.viewport(0, 0, c.width, c.height);
  const comp = (t, src) => {
    const s = gl.createShader(t);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, comp(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, comp(gl.FRAGMENT_SHADER, makeFS(gradeVariant, grainVariant)));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const hex2lin = h => {
    const v = parseInt(h.slice(1), 16);
    const s = [((v>>16)&255)/255, ((v>>8)&255)/255, (v&255)/255];
    return s.map(x => x <= 0.04045 ? x/12.92 : ((x+0.055)/1.055)**2.4);
  };
  gl.uniform2f(gl.getUniformLocation(prog, 'uSize'), w, h);
  gl.uniform1f(gl.getUniformLocation(prog, 'uDpr'), dpr);
  gl.uniform1f(gl.getUniformLocation(prog, 'uGrain'), grainVal);
  gl.uniform3fv(gl.getUniformLocation(prog, 'uPrimary'), hex2lin(hexes[0]));
  gl.uniform3fv(gl.getUniformLocation(prog, 'uSecondary'), hex2lin(hexes[1]));
  gl.uniform3fv(gl.getUniformLocation(prog, 'uAccent'), hex2lin(hexes[2]));
  gl.uniform3fv(gl.getUniformLocation(prog, 'uBackground'), hex2lin(hexes[3]));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.finish();
};
</script>
</body>
</html>
"""


def measure_patch_grain(arr_luma: np.ndarray, y0f, y1f, x0f, x1f) -> float:
    h, w = arr_luma.shape
    sub = arr_luma[int(h * y0f):int(h * y1f), int(w * x0f):int(w * x1f)]
    img = Image.fromarray(np.clip(sub, 0, 255).astype(np.uint8))
    smoothed = np.asarray(img.filter(ImageFilter.BoxBlur(2)), dtype=np.float32)
    res = sub[3:-3, 3:-3] - smoothed[3:-3, 3:-3]
    return round(float(np.std(res)), 3)


def make_sheet(items: list[tuple[str, Path]], out: Path, cols: int = 2, tile_w: int = 520) -> None:
    thumbs = []
    for label, p in items:
        with Image.open(p) as im:
            rgb = im.convert("RGB")
            th = int(round(tile_w * rgb.height / rgb.width))
            canvas = Image.new("RGB", (tile_w, th + 28), (12, 15, 22))
            canvas.paste(rgb.resize((tile_w, th), Image.Resampling.LANCZOS), (0, 28))
            ImageDraw.Draw(canvas).text((10, 7), label, fill=(238, 240, 248))
            thumbs.append(canvas)
    mh = max(t.height for t in thumbs)
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_w + (cols + 1) * 10, rows * mh + (rows + 1) * 10), (7, 9, 14))
    for i, t in enumerate(thumbs):
        r, c = divmod(i, cols)
        sheet.paste(t, (10 + c * (tile_w + 10), 10 + r * (mh + 10)))
    sheet.save(out)


def main():
    out = Path("artifacts/refinement/candidates")
    (out / "grain").mkdir(parents=True, exist_ok=True)
    (out / "grade").mkdir(parents=True, exist_ok=True)

    styles_palettes = {
        "ship": ["#114b76", "#2a7ba8", "#eea974", "#081726"],
        "fisheye": ["#6b185f", "#bc3366", "#f4a488", "#1a0818"],
        "visual": ["#125c4d", "#2a8f72", "#e8d288", "#071d18"],
        "branches": ["#0e4a38", "#2d895d", "#b8e6bc", "#061812"],
        "message-thread": ["#144184", "#3272c7", "#8dc4ff", "#071429"],
    }

    grain_variants = ["A_baseline", "B_fine_dither", "C_optical_35mm", "D_rich_analog"]
    grade_variants = ["baseline", "balanced", "verci_calibrated"]

    grain_results = {}
    grade_items = []
    grain_crop_items = []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True, args=["--no-proxy-server"])

        # 1. Grain exploration across DPR 1.0, 1.25, 2.0 on Ship (verci_calibrated grade)
        for dpr in (1.0, 1.25, 2.0):
            ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=dpr)
            page = ctx.new_page()
            page.set_content(GRAIN_TEST_HTML)
            for gv in grain_variants:
                page.evaluate("([gr, gn, h, v, d]) => window.__renderCandidate(gr, gn, h, v, d)", ["verci_calibrated", gv, styles_palettes["ship"], 0.23, dpr])
                fp = out / "grain" / f"{gv}-dpr{dpr}.png"
                page.locator("#c").screenshot(path=fp)
                with Image.open(fp) as im:
                    arr = np.asarray(im.convert("RGB"), dtype=np.float32)
                    luma = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
                    if gv == "C_optical_35mm" or dpr == 1.0:
                        w, h = im.size
                        crop = im.convert("RGB").crop((int(w * 0.62), int(h * 0.16), int(w * 0.62) + 128, int(h * 0.16) + 128))
                        cp = out / "grain" / f"crop4x-{gv}-dpr{dpr}.png"
                        crop.resize((512, 512), Image.Resampling.NEAREST).save(cp)
                        if dpr == 1.0:
                            grain_crop_items.append((f"{gv} @ DPR 1.0 (4x crop)", cp))
                        elif gv == "C_optical_35mm":
                            grain_crop_items.append((f"{gv} @ DPR {dpr} (4x crop)", cp))
                    grain_results[f"{gv}_dpr{dpr}"] = {
                        "upper_left": measure_patch_grain(luma, 0.08, 0.30, 0.06, 0.28),
                        "center": measure_patch_grain(luma, 0.35, 0.62, 0.36, 0.64),
                        "upper_right": measure_patch_grain(luma, 0.08, 0.32, 0.68, 0.94),
                        "mean_luma": round(float(luma.mean()), 2),
                    }
            ctx.close()

        # 2. Color grade candidates across 5 signature styles
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1.0)
        page = ctx.new_page()
        page.set_content(GRAIN_TEST_HTML)
        for style_id, pal in styles_palettes.items():
            for gr in grade_variants:
                page.evaluate("([gr, gn, h, v, d]) => window.__renderCandidate(gr, gn, h, v, d)", [gr, "C_optical_35mm", pal, 0.23, 1.0])
                gp = out / "grade" / f"{style_id}-{gr}.png"
                page.locator("#c").screenshot(path=gp)
                grade_items.append((f"{style_id} — {gr}", gp))
        ctx.close()
        browser.close()

    make_sheet(grade_items, out / "contact-grade-candidates.png", cols=3, tile_w=420)
    make_sheet(grain_crop_items, out / "contact-grain-crops.png", cols=3, tile_w=400)
    (out / "grain_candidates.json").write_text(json.dumps(grain_results, indent=2), encoding="utf8")
    print(json.dumps(grain_results, indent=2))


if __name__ == "__main__":
    main()
