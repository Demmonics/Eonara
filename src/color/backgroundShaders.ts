export const backgroundVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const backgroundFragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 uSize;
  uniform float uTime, uIntensity, uGrain, uVeil, uBlur, uMode, uLimit, uDpr;
  uniform float uSaturation, uBrightness, uTint, uGlass, uContrast;
  uniform vec3 uPrimary, uSecondary, uAccent, uBackground;
  uniform sampler2D uArt;
  uniform vec2 uArtCover;
  uniform float uArtWeight;

  // Zen Interactive Focal Points
  uniform vec4 uZenPoints[6]; // xy = normalized pos (0..1), z = spread, w = intensity
  uniform vec3 uZenColors[6]; // RGB
  uniform float uZenCount;
  uniform float uZenBlend; // 0 = additive harmonic, 1 = screen, 2 = overlay, 3 = lighten
  uniform float uZenRotation, uVignette;

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
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
  // Spatially correlated FHD/DPR-aware optical film grain with slow decorrelation
  float opticalGrain(vec2 uv, vec2 sizeCss, float dpr, float t) {
    float fhdScale = clamp(min(sizeCss.x, sizeCss.y) / 720.0, 0.72, 1.5);
    float effDpr = clamp(dpr, 1.0, 2.5);
    vec2 grainUv = (uv * sizeCss) / (1.35 * fhdScale);
    vec2 microUv = (uv * sizeCss * effDpr) * 0.42;
    float slice = floor(t * 3.2);
    float blend = smoothstep(0.0, 1.0, fract(t * 3.2));
    float g0 = valueNoise(grainUv * 0.78 + vec2(slice * 17.3, slice * 9.7)) * 0.62
             + valueNoise(grainUv * 1.54 - vec2(slice * 11.1, slice * 23.4)) * 0.26
             + valueNoise(microUv + vec2(slice * 7.1, slice * 13.7)) * 0.12;
    float nSlice = slice + 1.0;
    float g1 = valueNoise(grainUv * 0.78 + vec2(nSlice * 17.3, nSlice * 9.7)) * 0.62
             + valueNoise(grainUv * 1.54 - vec2(nSlice * 11.1, nSlice * 23.4)) * 0.26
             + valueNoise(microUv + vec2(nSlice * 7.1, nSlice * 13.7)) * 0.12;
    return clamp(mix(g0, g1, blend), -0.5, 0.5);
  }
  float lightPool(vec2 p, vec2 center, vec2 squash, float scale) {
    vec2 d = (p - center) * squash;
    return exp(-dot(d, d) * scale);
  }
  vec3 atmosphere(vec2 p, float t) {
    // Asymmetric broad color fields: cooler left shadow field vs warmer/brighter upper-right field + lower shadow veil
    vec2 a = vec2(-0.56 + 0.12 * sin(t * 0.42), 0.24 + 0.07 * cos(t * 0.54));
    vec2 b = vec2(0.58 + 0.11 * cos(t * 0.38), 0.34 + 0.08 * sin(t * 0.62));
    vec2 c = vec2(0.45 + 0.08 * sin(t * 0.27), 0.54 + 0.06 * cos(t * 0.34));
    float dusk = lightPool(p, a, vec2(0.86, 1.22), 1.25);
    float tide = lightPool(p, b, vec2(1.05, 0.96), 1.48);
    float highlight = lightPool(p, c, vec2(0.95, 1.55), 2.75);
    float lowerShadow = mix(0.46, 1.0, smoothstep(-0.92, 0.38, p.y));
    return (uPrimary * (0.54 * dusk) + uSecondary * (0.48 * tide) + uAccent * (0.16 * highlight)) * lowerShadow;
  }
  vec3 glass(vec2 p, float t) {
    vec2 flow = p + vec2(
      0.17 * sin(p.y * 3.1 + t * 0.71) + 0.06 * sin(p.x * 5.1 - t * 0.23),
      0.12 * cos(p.x * 2.7 - t * 0.58)
    );
    float fold = flow.y + 0.30 * sin(2.2 * flow.x + t * 0.65);
    float fold2 = flow.y - 0.24 + 0.23 * cos(3.0 * flow.x - t * 0.43);
    float body = exp(-11.0 * fold * fold);
    float ridge = exp(-95.0 * (fold - 0.15) * (fold - 0.15));
    float rim = exp(-60.0 * fold2 * fold2) * smoothstep(-0.35, 0.65, flow.x);
    float matte = lightPool(flow, vec2(-0.62, 0.04), vec2(0.95, 1.05), 1.22);
    float lowerShadow = mix(0.55, 1.0, smoothstep(-0.92, 0.34, p.y));
    return (uPrimary * (matte * 0.28 + body * 0.26)
      + uSecondary * (0.28 * body * smoothstep(-0.85, 0.72, flow.x))
      + uAccent * (ridge * 0.085 + rim * 0.056) * (0.35 + 1.05 * uGlass)) * lowerShadow;
  }
  vec3 meshGradient(vec2 p, float t) {
    vec2 a = vec2(-0.56 + 0.14 * sin(t * 0.60), -0.32 + 0.11 * cos(t * 0.71));
    vec2 b = vec2(0.54 + 0.14 * cos(t * 0.51), 0.36 + 0.12 * sin(t * 0.64));
    vec2 c = vec2(-0.16 + 0.20 * sin(t * 0.37), 0.56 + 0.10 * cos(t * 0.57));
    float wa = lightPool(p, a, vec2(1.0, 1.0), 2.15);
    float wb = lightPool(p, b, vec2(0.82, 1.0), 2.35);
    float wc = lightPool(p, c, vec2(1.0, 1.25), 2.8);
    // Normalize the local colour mix separately from the falloff so each
    // lobe keeps its character where it dominates the field.
    float density = wa + wb + wc;
    vec3 field = (uPrimary * wa + uSecondary * wb + uAccent * wc) / max(0.001, density);
    float lowerShadow = mix(0.52, 1.0, smoothstep(-0.92, 0.35, p.y));
    return field * (0.38 * smoothstep(0.02, 0.92, density)) * lowerShadow;
  }
  vec3 zenGradient(vec2 p, float t, float ratio) {
    if (uZenCount < 0.5) {
      // Multi-stop automatic harmonic pools inspired by Zen Browser ZenGradientGenerator
      vec2 p1 = vec2(-0.50 + 0.12 * sin(t * 0.32), 0.35 + 0.08 * cos(t * 0.41));
      vec2 p2 = vec2(0.56 + 0.10 * cos(t * 0.28), 0.28 + 0.09 * sin(t * 0.35));
      vec2 p3 = vec2(-0.14 + 0.18 * sin(t * 0.21), -0.44 + 0.07 * cos(t * 0.29));
      vec2 p4 = vec2(0.42 + 0.14 * cos(t * 0.39), 0.54 + 0.10 * sin(t * 0.44));

      float w1 = lightPool(p, p1, vec2(1.0, 1.22), 1.55);
      float w2 = lightPool(p, p2, vec2(1.12, 0.95), 1.72);
      float w3 = lightPool(p, p3, vec2(0.9, 1.3), 2.15);
      float w4 = lightPool(p, p4, vec2(1.15, 1.15), 2.45);

      float lowerShadow = mix(0.52, 1.0, smoothstep(-0.92, 0.36, p.y));
      vec3 col = uPrimary * (0.48 * w1) + uSecondary * (0.42 * w2) +
                 mix(uPrimary, uSecondary, 0.5) * (0.24 * w3) +
                 uAccent * (0.18 * w4);
      return col * lowerShadow;
    }
    // Interactive user-defined focal points
    vec3 acc = vec3(0.0);
    float scaleX = clamp(ratio, 0.67, 1.7);
    float rotationCos = cos(uZenRotation), rotationSin = sin(uZenRotation);
    int count = int(min(uZenCount, 6.0));
    for (int i = 0; i < 6; i++) {
      if (i >= count) break;
      vec4 pt = uZenPoints[i];
      vec2 anchor = vec2(pt.x * 2.0 - 1.0, 1.0 - pt.y * 2.0);
      vec2 basePos = (mat2(rotationCos, -rotationSin, rotationSin, rotationCos) * anchor) * vec2(scaleX, 1.0);
      float fi = float(i);
      vec2 animPos = basePos + vec2(0.05 * sin(t * 0.32 + fi * 1.57), 0.04 * cos(t * 0.26 + fi * 1.23));
      float spread = 3.4 / max(0.5, pt.z);
      float intensity = pt.w;
      float pool = exp(-dot(p - animPos, p - animPos) * spread);
      vec3 ptCol = uZenColors[i] * (pool * intensity * 0.55);
      if (uZenBlend > 0.5 && uZenBlend < 1.5) {
        // Screen blend
        acc = vec3(1.0) - (vec3(1.0) - acc) * (vec3(1.0) - min(vec3(1.0), ptCol));
      } else if (uZenBlend > 1.5 && uZenBlend < 2.5) {
        // Soft-light layering after the first visible pool; black is not the base layer.
        if (i == 0) acc = ptCol;
        else acc = mix(acc, vec3(1.0) - (vec3(1.0) - acc) * (vec3(1.0) - min(vec3(1.0), ptCol)), 0.64);
      } else if (uZenBlend > 2.5) {
        // Lighten
        acc = max(acc, ptCol);
      } else {
        // Additive
        acc += ptCol;
      }
    }
    return acc;
  }
  vec4 blurredArtwork(vec2 uv, float t) {
    vec2 q = (uv - 0.5) * uArtCover * 0.85 + 0.5;
    q += vec2(0.025 * sin(t * 0.35), 0.02 * (cos(t * 0.43) - 1.0));
    vec2 d = vec2(0.012 + 0.095 * uBlur) * uArtCover;
    float lod = max(0.0, log2(min(uSize.x, uSize.y) / 192.0)) + 4.2 * uBlur;
    vec4 art = texture2D(uArt, q, lod) * 0.20;
    art += texture2D(uArt, q + vec2(d.x, 0.0), lod) * 0.13;
    art += texture2D(uArt, q - vec2(d.x, 0.0), lod) * 0.13;
    art += texture2D(uArt, q + vec2(0.0, d.y), lod) * 0.13;
    art += texture2D(uArt, q - vec2(0.0, d.y), lod) * 0.13;
    art += texture2D(uArt, q + d, lod) * 0.07;
    art += texture2D(uArt, q - d, lod) * 0.07;
    art += texture2D(uArt, q + vec2(d.x, -d.y), lod) * 0.07;
    art += texture2D(uArt, q + vec2(-d.x, d.y), lod) * 0.07;
    return art;
  }

  void main() {
    float ratio = uSize.x / uSize.y;
    vec2 p = (vUv * 2.0 - 1.0) * vec2(clamp(ratio, 0.67, 1.7), 1.0);
    vec3 color;
    if (uMode < 0.5) {
      color = atmosphere(p, uTime);
    } else if (uMode < 1.5) {
      color = glass(p, uTime);
    } else if (uMode < 2.5) {
      color = atmosphere(p, uTime) * 0.55;
      if (uArtWeight > 0.001) {
        vec4 art = blurredArtwork(vUv, uTime);
        color = color * (1.0 - uArtWeight * art.a) + art.rgb * (uArtWeight * 0.34);
      }
    } else if (uMode < 3.5) {
      color = meshGradient(p, uTime);
    } else if (uMode < 4.5) {
      color = zenGradient(p, uTime, ratio);
    } else if (uMode < 5.5) {
      color = uPrimary * (0.095 * lightPool(p, vec2(-0.18, -0.22), vec2(0.8, 0.9), 0.95));
    } else {
      color = mix(uPrimary, uSecondary, smoothstep(-0.9, 0.9, p.x - p.y * 0.35)) * 0.32;
      color += uAccent * (0.16 * lightPool(p, vec2(0.62, 0.46), vec2(0.90, 1.25), 2.75));
    }
    float radial = smoothstep(0.25, 1.7, length(p));
    float centerShade = 1.0 - (0.10 + 0.16 * uContrast) * exp(-6.5 * p.x * p.x);
    vec3 linear = uBackground + color * (uIntensity * uBrightness * (0.42 + 0.58 * uTint)
      * centerShade * (1.0 - 0.38 * uVignette * radial));
    vec3 lumWeights = vec3(0.2126, 0.7152, 0.0722);
    linear = mix(vec3(dot(linear, lumWeights)), linear, uSaturation);
    linear *= 1.0 - 0.36 * uVeil;
    // Bounded spatially correlated optical film grain scaled safely to keep luma residual silky & shimmer-free
    float lumBase = dot(linear, lumWeights);
    float grain = opticalGrain(vUv, uSize, uDpr, uTime);
    float grainScale = uGrain * (0.015 + 0.044 * sqrt(max(lumBase, 0.005)));
    linear = max(vec3(0.0), linear + grain * grainScale);
    // Soft perceptual headroom rolloff instead of harsh crushed clamp
    float lum = dot(linear, lumWeights);
    if (lum > uLimit) {
      linear *= (uLimit + (lum - uLimit) * 0.22) / max(0.00001, lum);
    }
    gl_FragColor = vec4(linear, 1.0);
    #include <colorspace_fragment>
  }
`;
