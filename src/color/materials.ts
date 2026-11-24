import { clamp, contrast, hexToLab, labToHex, mixLab, normalizeHex } from './oklab';
import type { DynamicPalette } from './palette';

function composite(top: string, bottom: string, alpha: number) {
  const read = (color: string, at: number) => Number.parseInt(color.slice(at, at + 2), 16);
  return '#' + [1, 3, 5].map(at => Math.round(read(top, at) * alpha + read(bottom, at) * (1 - alpha))
    .toString(16).padStart(2, '0')).join('');
}

/** Bound on the rendered surface over a white, sRGB backdrop. For a dark surface and light
 * ink, white has greater per-channel luminance than any possible SDR backdrop. */
export function materialOpacity(surface: string, ink: string, requested: number, ratio = 4.5) {
  const fits = (a: number) => contrast(ink, composite(surface, '#ffffff', a)) >= ratio;
  const desired = clamp(Number.isFinite(requested) ? requested : 0);
  if (fits(desired)) return desired;
  if (!fits(1)) return null;
  let lower = desired, upper = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lower + upper) / 2;
    if (fits(mid)) upper = mid;
    else lower = mid;
  }
  return Math.min(1, Math.ceil(upper * 1000) / 1000);
}

export function readableInk(surface: string) {
  return contrast('#ffffff', surface) >= contrast('#101019', surface) &&
    contrast('#ffffff', surface) >= contrast('#000000', surface) ? '#ffffff' :
    contrast('#101019', surface) >= 5 ? '#101019' : '#000000';
}

export function deriveMaterials(palette: DynamicPalette, tint: number, opacity: number) {
  // The dominant lyric remains neutral; colour goes into backing, edge and control roles.
  const t = clamp(Number.isFinite(tint) ? tint : .55);
  const materialBase = '#11131b';
  const surface = labToHex(mixLab(hexToLab(materialBase), hexToLab(palette.surface), t));
  const quietText = palette.mutedForeground;
  const safeOpacity = materialOpacity(surface, quietText, opacity);
  // If the requested ink can't clear even an opaque tinted surface, use a darker neutral
  // and a known light ink instead of reporting a contrast guarantee after capping opacity.
  const safeSurface = safeOpacity === null ? '#11131b' : surface;
  return {
    atmosphere: labToHex(mixLab(hexToLab(palette.primary), hexToLab(palette.secondary), .52)),
    toolbar: safeSurface,
    popover: labToHex(mixLab(hexToLab(safeSurface), hexToLab(palette.background), .27)),
    gallery: labToHex(mixLab(hexToLab('#090b10'), hexToLab(palette.background), .38)),
    border: labToHex(mixLab(hexToLab(palette.accent), hexToLab(palette.mutedForeground), .58)),
    specular: labToHex(mixLab(hexToLab(palette.accent), hexToLab('#ffffff'), .7)),
    shadow: labToHex(mixLab(hexToLab('#000000'), hexToLab(palette.background), .42)),
    muted: safeOpacity === null ? '#c9c9d4' : quietText,
    opacity: safeOpacity ?? 1,
    accentInk: readableInk(normalizeHex(palette.accent) ?? '#bab7d7'),
  };
}
