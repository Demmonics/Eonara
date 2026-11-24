import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { normalizePoints, parseBlend, parseRotation } from './color/gradientState';
import type { GradientPoint, ZenBlendMode } from './color/gradientState';

export interface CueWord { startMs: number; endMs: number; text: string }
export interface CueLine extends CueWord { words?: CueWord[] }
export interface MediaSession {
  id: string;
  source: string;
  title: string;
  artist: string;
  album: string;
  durationMs?: number;
  positionMs: number;
  playing: boolean;
  rate?: number;
  timelineValid: boolean;
  generation?: number;
  artworkRevision?: number;
}
export interface MediaSnapshot { sessions: MediaSession[]; activeId?: string | null; revision?: number; error?: string }
export interface Artwork { dataUrl: string; hash: string }
export type BackgroundMode = 'atmospheric' | 'liquid-glass' | 'artwork' | 'mesh' | 'zen' | 'minimal' | 'manual';

export type { GradientPoint, ZenBlendMode } from './color/gradientState';

export const defaults = {
  activeStyle: 'ship',
  pins: [] as string[],
  size: 100, font: 'Inter Variable', weight: 600,
  sourceId: '', estimated: false, autoLookup: true,
  overlay: false, clickThrough: true, hidePaused: true,
  fullscreen: false, hideFullscreen: true, keepAwake: false, desktopOnly: false, monitor: '', placement: 'center', overlaySize: 65,
  matchArt: true, paletteLocked: false, mode: 'atmospheric' as BackgroundMode,
  primary: '#254873', secondary: '#17192d', accent: '#efab78',
  saturation: 100, brightness: 100, darkness: 58, glass: 64, tint: 55,
  backgroundMotion: 52, grain: 23, blur: 70, transition: 980, contrast: 80,
  intensity: 100, motionSpeed: 100, motionBlur: 10, backdrop: 0,
  activeColor: '', inactiveColor: '', textColor: '',
  offsets: {} as Record<string, number>, rememberOffset: false,
  zenPoints: [
    { id: '1', x: 0.26, y: 0.32, color: '#3b5a8c', spread: 1.6, intensity: 1.0 },
    { id: '2', x: 0.74, y: 0.28, color: '#684078', spread: 1.7, intensity: 0.95 },
    { id: '3', x: 0.32, y: 0.78, color: '#27584e', spread: 1.8, intensity: 0.85 },
    { id: '4', x: 0.78, y: 0.82, color: '#9e5a38', spread: 2.1, intensity: 0.75 },
  ] as GradientPoint[],
  zenBlendMode: 'normal' as ZenBlendMode,
  zenAuto: true,
  zenRotation: 0,
  vignette: 72,
};
export type Settings = typeof defaults;
const settingsKey = 'lyricmotion.settings.v1';
let pendingWrite = 0;

export function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(settingsKey) ?? '{}') as Partial<Settings>;
    const points = normalizePoints(parsed.zenPoints);
    const custom = points.length > 0 && JSON.stringify(points) !== JSON.stringify(defaults.zenPoints);
    return { ...defaults, ...parsed, zenPoints: points.length ? points : defaults.zenPoints,
      zenBlendMode:parseBlend(parsed.zenBlendMode), zenRotation:parseRotation(parsed.zenRotation),
      zenAuto:typeof parsed.zenAuto === 'boolean' ? parsed.zenAuto : !custom };
  }
  catch { return { ...defaults }; }
}
export function saveSettings(settings: Settings) {
  try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  if (isTauri()) {
    void emit('lyricmotion-settings', settings).catch(console.warn);
    clearTimeout(pendingWrite);
    pendingWrite = window.setTimeout(() => { void invoke('save_settings', {settings}).catch(console.warn); }, 350);
  }
}
export function onSettingsChange(callback: (settings: Settings) => void) {
  if (isTauri()) void listen<Settings>('lyricmotion-settings', e => callback(e.payload)).catch(console.warn);
  window.addEventListener('storage', e => { if (e.key === settingsKey) callback(loadSettings()); });
}
export async function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Available in the Windows application.');
  return invoke<T>(command, args);
}
export { isTauri, emit, listen };

export class PlaybackClock {
  #base = 0;
  #received = 0;
  #rate = 0;
  #end = Infinity;
  #correction = 0;
  #lastSource = -1;
  #lastWall = 0;
  valid = false;

  get duration(): number {
    return Number.isFinite(this.#end) ? this.#end : 0;
  }
  get rate(): number {
    return this.#rate;
  }

  update(session?: MediaSession, force = false, now = performance.now()) {
    if (!session?.timelineValid || session.positionMs < 0 || !Number.isFinite(session.positionMs)) {
      this.reset(); return;
    }
    const rate = session.playing ? Math.min(4, Math.max(0.05, Number.isFinite(session.rate) ? session.rate || 1 : 1)) : 0;
    const end = session.durationMs && Number.isFinite(session.durationMs) && session.durationMs > 0 ? session.durationMs : Infinity;
    if (!force && this.valid && rate === this.#rate && session.positionMs === this.#lastSource) {
      this.#end = end;
      return;
    }
    const observed = Math.max(0, session.positionMs);
    const delta = this.valid && !force ? observed - this.at(now) : 0;
    const smooth = this.valid && !force && rate === this.#rate && rate > 0 && Math.abs(delta) < 160;
    this.#base = observed - (smooth ? delta : 0);
    this.#correction = smooth ? delta : 0;
    this.#received = now;
    this.#lastWall = now;
    this.#rate = rate;
    this.#end = end;
    this.#lastSource = observed;
    this.valid = true;
  }
  at(now = performance.now()) {
    if (!this.valid) return 0;
    const elapsed = Math.max(0, now - this.#received);
    return Math.min(this.#end, Math.max(0, this.#base + elapsed * this.#rate + this.#correction * Math.min(1, (now - this.#lastWall) / 320)));
  }
  reset() { this.valid = false; this.#lastSource = -1; this.#base = 0; this.#rate = 0; this.#end = Infinity; }
}

export function trackKey(s?: MediaSession) {
  return s?.title ? [s.title, s.artist, s.album, Math.round((s.durationMs ?? 0) / 1000)].map(x => String(x).normalize('NFC').trim().toLowerCase()).join('\u001f') : '';
}
