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
  vec3 linearToSrgb3(vec3 c) {
    vec3 safe = max(c, vec3(0.0));
    vec3 lo = safe * 12.92;
    vec3 hi = 1.055 * pow(safe, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), safe));
  }
  vec3 srgbToLinear3(vec3 c) {
    vec3 safe = max(c, vec3(0.0));
    vec3 lo = safe / 12.92;
    vec3 hi = pow((safe + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(vec3(0.04045), safe));
  }
  // DPR-calibrated 35mm optical emulsion noise (luma + subtle dye chroma) with variance-compensated slow drift
  vec3 opticalEmulsionGrain(vec2 fragPx, float dpr, float t) {
    float dprNorm = mix(1.0, 1.48, smoothstep(1.0, 2.0, dpr));
    vec2 px = fragPx / dprNorm;
    float phase = t * 2.4;
    float s0 = floor(phase);
    float s1 = s0 + 1.0;
    float blend = smoothstep(0.0, 1.0, fract(phase));
    float varNorm = mix(1.0, 1.32, 4.0 * blend * (1.0 - blend));

    float fine0 = hash3(fragPx, s0) - 0.5;
    float fine1 = hash3(fragPx, s1) - 0.5;
    float med0 = valueNoise(px * 0.64 + vec2(s0 * 11.3, s0 * 5.7));
    float med1 = valueNoise(px * 0.64 + vec2(s1 * 11.3, s1 * 5.7));
    float soft0 = valueNoise(px * 0.28 - vec2(s0 * 4.1, s0 * 13.9));
    float soft1 = valueNoise(px * 0.28 - vec2(s1 * 4.1, s1 * 13.9));

    float fine = mix(fine0, fine1, blend);
    float med = mix(med0, med1, blend);
    float soft = mix(soft0, soft1, blend);
    float lumaNoise = (fine * 0.50 + med * 0.36 + soft * 0.14) * varNorm;

    float c0 = hash3(fragPx * 0.85, s0 + 29.0) - 0.5;
    float c1 = hash3(fragPx * 0.85, s1 + 29.0) - 0.5;
    float chroma = mix(c0, c1, blend) * varNorm * 0.09;
    return vec3(lumaNoise + chroma, lumaNoise - chroma * 0.35, lumaNoise - chroma * 0.65);
  }
  float lightPool(vec2 p, vec2 center, vec2 squash, float scale) {
    vec2 d = (p - center) * squash;
    return exp(-dot(d, d) * scale);
  }
  vec3 atmosphere(vec2 p, float t) {
    // Broad diagonal Verci-calibrated studio lighting: shaded left depth, luminous right sweep & warm/cool edge rim
    vec2 a = vec2(-0.70 + 0.10 * sin(t * 0.42), 0.12 + 0.07 * cos(t * 0.54));
    vec2 b = vec2(0.56 + 0.10 * cos(t * 0.38), 0.18 + 0.08 * sin(t * 0.62));
    vec2 c = vec2(1.06 + 0.07 * sin(t * 0.27), 0.14 + 0.06 * cos(t * 0.34));
    float dusk = lightPool(p, a, vec2(0.74, 0.96), 0.98);
    float tide = lightPool(p, b, vec2(0.74, 0.86), 0.95);
    float highlight = lightPool(p, c, vec2(0.90, 1.02), 1.32);
    float lowerFeather = mix(0.46, 1.0, smoothstep(-1.12, -0.22, p.y));
    vec3 baseWash = mix(uBackground, uPrimary * 0.42, 0.60) * mix(0.54, 1.0, smoothstep(-1.10, -0.28, p.y));
    vec3 bloom = (uPrimary * (0.52 * dusk) + uSecondary * (0.76 * tide) + uAccent * (0.38 * highlight)) * lowerFeather;
    return baseWash + bloom;
  }
  vec3 glass(vec2 p, float t) {
    vec2 flow = p + vec2(
      0.16 * sin(p.y * 2.9 + t * 0.68) + 0.06 * sin(p.x * 4.8 - t * 0.23),
      0.11 * cos(p.x * 2.5 - t * 0.54)
    );
    float fold = flow.y + 0.30 * sin(2.1 * flow.x + t * 0.62);
    float fold2 = flow.y - 0.26 + 0.24 * cos(2.9 * flow.x - t * 0.42);
    float body = exp(-8.5 * fold * fold);
    float ridge = exp(-68.0 * (fold - 0.14) * (fold - 0.14));
    float rim = exp(-44.0 * fold2 * fold2) * smoothstep(-0.45, 0.72, flow.x);
    float matte = lightPool(flow, vec2(-0.56, 0.08), vec2(0.84, 1.0), 1.05);
    float glow = lightPool(flow, vec2(0.46, 0.24), vec2(0.82, 0.96), 1.02);
    float lowerFeather = mix(0.48, 1.0, smoothstep(-1.08, -0.20, p.y));
    vec3 baseWash = mix(uBackground, uPrimary * 0.36, 0.54) * mix(0.56, 1.0, smoothstep(-1.06, -0.24, p.y));
    return baseWash + (
      uPrimary * (matte * 0.42 + body * 0.36)
      + uSecondary * (glow * 0.56 + body * 0.38 * smoothstep(-0.78, 0.78, flow.x))
      + uAccent * (ridge * 0.20 + rim * 0.14) * (0.45 + 0.95 * uGlass)
    ) * lowerFeather;
  }
  vec3 meshGradient(vec2 p, float t) {
    vec2 a = vec2(-0.58 + 0.14 * sin(t * 0.56), -0.26 + 0.11 * cos(t * 0.66));
    vec2 b = vec2(0.50 + 0.14 * cos(t * 0.49), 0.34 + 0.12 * sin(t * 0.60));
    vec2 c = vec2(-0.14 + 0.18 * sin(t * 0.35), 0.52 + 0.10 * cos(t * 0.53));
    vec2 d = vec2(0.78 + 0.10 * cos(t * 0.31), -0.34 + 0.09 * sin(t * 0.41));
    float wa = lightPool(p, a, vec2(0.92, 0.95), 1.65);
    float wb = lightPool(p, b, vec2(0.80, 0.92), 1.75);
    float wc = lightPool(p, c, vec2(0.96, 1.15), 2.15);
    float wd = lightPool(p, d, vec2(0.95, 1.05), 2.10);
    float density = wa + wb + wc + wd;
    vec3 field = (uPrimary * wa + uSecondary * wb + uAccent * wc + mix(uPrimary, uSecondary, 0.45) * wd) / max(0.001, density);
    float lowerFeather = mix(0.52, 1.0, smoothstep(-1.08, -0.18, p.y));
    vec3 baseWash = mix(uBackground, uPrimary * 0.30, 0.44);
    return (baseWash + field * (0.58 * smoothstep(0.02, 0.88, density))) * lowerFeather;
  }
  vec3 zenGradient(vec2 p, float t, float ratio) {
    float lowerFeather = mix(0.52, 1.0, smoothstep(-1.08, -0.18, p.y));
    if (uZenCount < 0.5) {
      vec2 p1 = vec2(-0.52 + 0.12 * sin(t * 0.32), 0.30 + 0.08 * cos(t * 0.41));
      vec2 p2 = vec2(0.54 + 0.10 * cos(t * 0.28), 0.24 + 0.09 * sin(t * 0.35));
      vec2 p3 = vec2(-0.14 + 0.18 * sin(t * 0.21), -0.40 + 0.07 * cos(t * 0.29));
      vec2 p4 = vec2(0.46 + 0.14 * cos(t * 0.39), 0.50 + 0.10 * sin(t * 0.44));

      float w1 = lightPool(p, p1, vec2(0.92, 1.10), 1.25);
      float w2 = lightPool(p, p2, vec2(1.02, 0.92), 1.38);
      float w3 = lightPool(p, p3, vec2(0.86, 1.18), 1.72);
      float w4 = lightPool(p, p4, vec2(1.05, 1.08), 1.95);

      vec3 baseWash = mix(uBackground, uPrimary * 0.30, 0.48);
      vec3 col = uPrimary * (0.56 * w1) + uSecondary * (0.58 * w2) +
                 mix(uPrimary, uSecondary, 0.5) * (0.36 * w3) +
                 uAccent * (0.28 * w4);
      return baseWash + col * lowerFeather;
    }
    // Interactive user-defined focal points with deep ambient ground
    vec3 acc = uBackground * 0.45;
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
      float spread = 2.8 / max(0.5, pt.z);
      float intensity = pt.w;
      float pool = exp(-dot(p - animPos, p - animPos) * spread);
      vec3 ptCol = uZenColors[i] * (pool * intensity * 0.72);
      if (uZenBlend > 0.5 && uZenBlend < 1.5) {
        acc = vec3(1.0) - (vec3(1.0) - acc) * (vec3(1.0) - min(vec3(1.0), ptCol));
      } else if (uZenBlend > 1.5 && uZenBlend < 2.5) {
        if (i == 0) acc = max(acc, ptCol);
        else acc = mix(acc, vec3(1.0) - (vec3(1.0) - acc) * (vec3(1.0) - min(vec3(1.0), ptCol)), 0.68);
      } else if (uZenBlend > 2.5) {
        acc = max(acc, ptCol);
      } else {
        acc += ptCol;
      }
    }
    return acc * mix(0.68, 1.0, smoothstep(-1.12, -0.22, p.y));
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
      color = atmosphere(p, uTime) * 0.80;
      if (uArtWeight > 0.001) {
        vec4 art = blurredArtwork(vUv, uTime);
        float blendW = uArtWeight * art.a * 0.72;
        color = mix(color, max(color * 0.45, art.rgb * 0.50), blendW);
      }
    } else if (uMode < 3.5) {
      color = meshGradient(p, uTime);
    } else if (uMode < 4.5) {
      color = zenGradient(p, uTime, ratio);
    } else if (uMode < 5.5) {
      float sweep = lightPool(p, vec2(0.38, 0.26), vec2(0.75, 0.92), 0.95);
      color = uPrimary * (0.28 * lightPool(p, vec2(-0.32, 0.05), vec2(0.75, 0.95), 0.92))
            + uSecondary * (0.20 * sweep);
    } else {
      float diag = smoothstep(-0.95, 0.95, p.x * 0.85 + p.y * 0.25);
      color = mix(uPrimary * 0.46, uSecondary * 0.60, diag);
      color += uAccent * (0.28 * lightPool(p, vec2(0.84, 0.28), vec2(0.88, 1.15), 1.75));
    }

    float radial = smoothstep(0.48, 1.94, length(p));
    float vignetteFactor = 1.0 - 0.20 * uVignette * radial;
    float contrastCurve = mix(0.92, 1.08, uContrast);
    float tintLustre = mix(0.94, 1.05, uTint);
    vec3 linear = uBackground * 0.45 + color * (uIntensity * uBrightness * contrastCurve * tintLustre * vignetteFactor);
    vec3 lumWeights = vec3(0.2126, 0.7152, 0.0722);
    linear = mix(vec3(dot(linear, lumWeights)), linear, uSaturation);
    linear *= 1.0 - 0.22 * uVeil;

    // Smooth perceptual highlight shoulder so center & bloom zones keep >=5:1 white text contrast
    float lum = dot(linear, lumWeights);
    if (lum > uLimit) {
      linear *= (uLimit + (lum - uLimit) * 0.18) / max(0.00001, lum);
    }

    // Optical 35mm film grain calibrated in sRGB perceptually across shadows, mids, highlights & DPR
    vec3 srgb = linearToSrgb3(linear);
    if (uGrain > 0.0005) {
      float lumS = dot(srgb, lumWeights);
      vec3 gVec = opticalEmulsionGrain(gl_FragCoord.xy, uDpr, uTime);
      float amp = (uGrain / 0.23) * 0.116 * mix(0.70, 1.14, smoothstep(0.05, 0.36, lumS));
      srgb = clamp(srgb + gVec * amp, 0.0, 1.0);
    }

    gl_FragColor = vec4(srgbToLinear3(srgb), 1.0);
    #include <colorspace_fragment>
  }
`;
