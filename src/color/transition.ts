import { clamp, hexToLab, labToHex, lightText, mixLab } from './oklab';
import type { Lab } from './oklab';
import { defaultPalette, paletteRoles } from './palette';
import type { DynamicPalette } from './palette';

type LabPalette = Record<keyof DynamicPalette, Lab>;

const toLab = (palette: DynamicPalette): LabPalette =>
  Object.fromEntries(paletteRoles.map(role => [role, hexToLab(palette[role])])) as LabPalette;

const DURATION_MS = 850;
const duration = (value: number) => Number.isFinite(value) ? Math.max(0, value) : DURATION_MS;

export class PaletteTransition {
  private source: LabPalette;
  private target: LabPalette;
  private targetPalette: DynamicPalette;
  private startMs = 0;
  private durationMs = 0;
  private readonly defaultDuration: number;

  constructor(initial: DynamicPalette = defaultPalette, durationMs = DURATION_MS) {
    this.targetPalette = initial;
    this.target = toLab(initial);
    this.source = this.target;
    this.defaultDuration = duration(durationMs);
  }

  setTarget(palette: DynamicPalette, timeMs: number, durationMs = this.defaultDuration): void {
    const nextDuration = duration(durationMs);
    if (paletteRoles.every(role => palette[role] === this.targetPalette[role]) && nextDuration !== 0) return;
    this.source = this.sampleLab(timeMs);
    this.target = toLab(palette);
    this.targetPalette = palette;
    this.startMs = timeMs;
    this.durationMs = nextDuration;
  }

  isActive(timeMs: number): boolean {
    return this.durationMs > 0 && timeMs < this.startMs + this.durationMs;
  }

  sample(timeMs: number): DynamicPalette {
    if (!this.isActive(timeMs)) return this.targetPalette;
    const colors = this.sampleLab(timeMs);
    const background = labToHex(colors.background);
    const surface = labToHex(colors.surface);
    return {
      primary: labToHex(colors.primary),
      secondary: labToHex(colors.secondary),
      accent: lightText(colors.accent, background, surface, 4.5),
      background, surface,
      foreground: lightText(colors.foreground, background, surface, 7),
      mutedForeground: lightText(colors.mutedForeground, background, surface, 4.5),
    };
  }

  private sampleLab(timeMs: number): LabPalette {
    if (!this.isActive(timeMs)) return this.target;
    const p = clamp((timeMs - this.startMs) / this.durationMs);
    const eased = p * p * (3 - 2 * p);
    return Object.fromEntries(paletteRoles.map(role => [
      role, mixLab(this.source[role], this.target[role], eased),
    ])) as LabPalette;
  }
}
