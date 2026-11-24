export type Vec3 = readonly [number, number, number];
export type Lab = Vec3;

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));
export const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

export function rgbToLab(r: number, g: number, b: number): Lab {
  r = srgbToLinear(r);
  g = srgbToLinear(g);
  b = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToLinear([L, a, b]: Lab): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = ([r, g, b]: Vec3): boolean =>
  r >= -1e-7 && r <= 1.0000001 && g >= -1e-7 && g <= 1.0000001 && b >= -1e-7 && b <= 1.0000001;

export function labToHex([sourceL, a, b]: Lab): string {
  const L = clamp(sourceL);
  let rgb = labToLinear([L, a, b]);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      if (inGamut(labToLinear([L, a * mid, b * mid]))) low = mid;
      else high = mid;
    }
    rgb = labToLinear([L, a * low, b * low]);
  }
  return '#' + rgb.map(v => Math.round(clamp(linearToSrgb(v)) * 255).toString(16).padStart(2, '0')).join('');
}

export function normalizeHex(value: string): string | undefined {
  const clean = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
  if (/^#[0-9a-f]{3}$/.test(clean)) return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  return undefined;
}

function hexChannels(hex: string): Vec3 {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function hexToLab(hex: string): Lab {
  return rgbToLab(...hexChannels(hex));
}

export function luminance(hex: string): number {
  const [r, g, b] = hexChannels(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const chroma = ([, a, b]: Lab): number => Math.hypot(a, b);
export const distance2 = (a: Lab, b: Lab): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
export const mixLab = (a: Lab, b: Lab, t: number): Lab =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Raise lightness, preserving hue where the sRGB gamut permits it. */
export function lightText(color: Lab, bg: string, surface: string, ratio: number): string {
  const fits = (hex: string) => contrast(hex, bg) >= ratio && contrast(hex, surface) >= ratio;
  const original = labToHex(color);
  if (fits(original)) return original;
  let min = color[0];
  let max = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (min + max) / 2;
    if (fits(labToHex([mid, color[1], color[2]]))) max = mid;
    else min = mid;
  }
  return labToHex([max, color[1], color[2]]);
}
