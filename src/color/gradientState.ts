import { clamp, normalizeHex } from './oklab';

export interface GradientPoint { id: string; x: number; y: number; color: string; spread: number; intensity: number }
export type ZenBlendMode = 'normal' | 'screen' | 'overlay' | 'lighten';
export const blendModes = ['normal', 'screen', 'overlay', 'lighten'] as const;
export const maxGradientPoints = 6;

export function normalizePoints(value: unknown): GradientPoint[] {
  if (!Array.isArray(value)) return [];
  const out: GradientPoint[] = [];
  const seen = new Set<string>();
  for (const point of value.slice(0, 48)) {
    if (!point || typeof point !== 'object') continue;
    const {id, x, y, color, spread, intensity} = point;
    if (typeof id !== 'string' || id.length < 1 || id.length > 64 || seen.has(id) ||
      typeof color !== 'string' || color.length > 12 || ![x,y,spread,intensity].every(Number.isFinite)) continue;
    const normalized = normalizeHex(color);
    if (!normalized) continue;
    seen.add(id);
    out.push({id, x:clamp(x), y:clamp(y), color:normalized, spread:clamp(spread,.5,3.5), intensity:clamp(intensity,.1,2)});
    if (out.length === maxGradientPoints) break;
  }
  return out;
}

export const parseBlend = (value: unknown): ZenBlendMode =>
  blendModes.includes(value as ZenBlendMode) ? value as ZenBlendMode : 'normal';
export const parseRotation = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, -180, 180) : 0;

export function decodeGradientPreset(json: string | null) {
  if (!json || json.length > 8192) return null;
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== 'object' || (raw.version !== undefined && raw.version !== 1)) return null;
    const points = normalizePoints(raw.points);
    if (!points.length) return null;
    return {version:1 as const, points, blend:parseBlend(raw.blend), auto:raw.auto === true, rotation:parseRotation(raw.rotation)};
  } catch { return null; }
}
