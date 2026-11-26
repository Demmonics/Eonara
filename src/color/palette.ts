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
  ship: ['#0c3b63', '#1d7db0', '#dd8944'],
  fisheye: ['#5c124f', '#bd2d62', '#f29f7d'],
  visual: ['#0b4d42', '#1d8a6e', '#e5c678'],
  'fisheye-visual': ['#62142d', '#b83c48', '#f0af82'],
  codestyle: ['#143375', '#762952', '#ef846e'],
  'codestyle-visual': ['#341d6e', '#8e347a', '#eea7bd'],
  branches: ['#063c2d', '#1c7c52', '#b3e3b8'],
  web: ['#4f1f0c', '#aa5226', '#f2be7a'],
  constellation: ['#181554', '#4e449c', '#cac5f6'],
  'message-thread': ['#12346e', '#2661b8', '#89bdf8'],
  payments: ['#3d2b22', '#7a5842', '#eec08e'],
  'map-journey': ['#104141', '#2c766e', '#eeb87a'],
  notifications: ['#132b54', '#2d5794', '#9bcfff'],
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
