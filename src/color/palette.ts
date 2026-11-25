import { chroma, clamp, hexToLab, labToHex, lightText, mixLab, normalizeHex } from './oklab';
import type { Lab } from './oklab';

export interface DynamicPalette {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly foreground: string;
  readonly mutedForeground: string;
}

export const paletteRoles = [
  'primary', 'secondary', 'accent', 'background', 'surface', 'foreground', 'mutedForeground',
] as const satisfies readonly (keyof DynamicPalette)[];

function tone(lab: Lab, L: number, scale: number, limit: number): Lab {
  const multiplier = Math.min(scale, limit / Math.max(1e-6, chroma(lab)));
  return [L, lab[1] * multiplier, lab[2] * multiplier];
}

export function semanticPalette(primary: Lab, secondary: Lab, accent: Lab, manual = false): DynamicPalette {
  const ground = mixLab(primary, secondary, 0.22);
  const background = labToHex(tone(ground, 0.15 + ground[0] * 0.045, 0.28, 0.036));
  const surface = labToHex(tone(ground, 0.24 + ground[0] * 0.045, 0.27, 0.045));
  return Object.freeze({
    primary: labToHex(manual ? primary : tone(primary, clamp(primary[0], 0.31, 0.79), 1, 0.21)),
    secondary: labToHex(manual ? secondary : tone(secondary, clamp(secondary[0], 0.36, 0.82), 1, 0.20)),
    accent: lightText(manual ? accent : tone(accent, clamp(accent[0], 0.69, 0.86), 1, 0.22), background, surface, 4.5),
    background,
    surface,
    foreground: lightText([0.956, 0, 0], background, surface, 7),
    mutedForeground: lightText(tone(secondary, 0.73, 0.27, 0.037), background, surface, 4.5),
  });
}

const fallbackColors = ['#545f8c', '#746887', '#b2afdb'] as const;
export const defaultPalette: DynamicPalette = semanticPalette(
  hexToLab(fallbackColors[0]), hexToLab(fallbackColors[1]), hexToLab(fallbackColors[2]), true,
);

export function manualPalette(primary: string, secondary: string, accent: string): DynamicPalette {
  return semanticPalette(
    hexToLab(normalizeHex(primary) ?? fallbackColors[0]),
    hexToLab(normalizeHex(secondary) ?? fallbackColors[1]),
    hexToLab(normalizeHex(accent) ?? fallbackColors[2]),
    true,
  );
}

const styleSeedSwatches: Record<string, readonly [string, string, string]> = {
  ship: ['#124b76', '#2e80af', '#eea974'],
  fisheye: ['#671a5c', '#ba3367', '#f5ab8c'],
  visual: ['#125a4b', '#2c8e6f', '#e8d38c'],
  'fisheye-visual': ['#6b1d38', '#b94853', '#f3c195'],
  codestyle: ['#1d3e80', '#823456', '#f28c7b'],
  'codestyle-visual': ['#3e2876', '#983f82', '#f3b7c8'],
  branches: ['#0e4b3a', '#2c8a5f', '#bce7be'],
  web: ['#6b301d', '#b85e33', '#f6ca8e'],
  constellation: ['#2b266a', '#5f52a8', '#d2cef8'],
  'message-thread': ['#143e80', '#2d6cc2', '#92c6ff'],
  payments: ['#47352c', '#7e5e48', '#f3c594'],
  'map-journey': ['#184c4b', '#3c7d76', '#f2c18a'],
  notifications: ['#183563', '#385f98', '#a4d6ff'],
};

const demoStyleCache = new Map<string, DynamicPalette>();

export function demoStylePalette(styleId: string): DynamicPalette {
  const cached = demoStyleCache.get(styleId);
  if (cached) return cached;
  const seed = styleSeedSwatches[styleId];
  const palette = seed ? semanticPalette(hexToLab(seed[0]), hexToLab(seed[1]), hexToLab(seed[2]), true) : defaultPalette;
  demoStyleCache.set(styleId, palette);
  return palette;
}
