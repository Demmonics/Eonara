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
  ship: ['#245676', '#4a85a8', '#efc499'],
  fisheye: ['#662a5b', '#ad4c6c', '#f5bb96'],
  visual: ['#1c5c4b', '#5d915c', '#edd99b'],
  'fisheye-visual': ['#6d263a', '#b55e55', '#f2c89f'],
  codestyle: ['#234482', '#7d3650', '#f28a7a'],
  'codestyle-visual': ['#452d78', '#96407d', '#f2b8c4'],
  branches: ['#185448', '#428e72', '#c2e8c0'],
  web: ['#703624', '#b5683a', '#f6cd94'],
  constellation: ['#332e6e', '#685ba8', '#d5d1f6'],
  'message-thread': ['#24447a', '#426494', '#94c5ff'],
  payments: ['#503e34', '#7f624e', '#f5c698'],
  'map-journey': ['#214e4c', '#487e75', '#f2c48e'],
  notifications: ['#1f3b68', '#456598', '#a8daff'],
};

const demoStyleCache = new Map<string, DynamicPalette>();

export function demoStylePalette(styleId: string): DynamicPalette {
  const cached = demoStyleCache.get(styleId);
  if (cached) return cached;
  const seed = styleSeedSwatches[styleId];
  const palette = seed ? semanticPalette(hexToLab(seed[0]), hexToLab(seed[1]), hexToLab(seed[2])) : defaultPalette;
  demoStyleCache.set(styleId, palette);
  return palette;
}
