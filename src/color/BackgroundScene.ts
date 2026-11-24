import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector4,
} from 'three';
import { isArtworkDataUrl } from './artwork';
import { backgroundFragment, backgroundVertex } from './backgroundShaders';
import { clamp } from './oklab';
import type { DynamicPalette } from './palette';
import { defaultPalette } from './palette';

export type BackgroundMode = 'atmospheric' | 'liquid-glass' | 'blurred-art' | 'artwork' | 'mesh' | 'zen' | 'minimal' | 'manual';

export interface ZenPointInput {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly spread: number;
  readonly intensity: number;
}

export interface BackgroundSettings {
  readonly mode?: BackgroundMode;
  readonly intensity?: number;
  readonly motion?: number;
  readonly grain?: number;
  readonly darkVeil?: number;
  readonly blur?: number;
  readonly saturation?: number;
  readonly brightness?: number;
  readonly tint?: number;
  readonly glass?: number;
  readonly contrast?: number;
  readonly artworkDataUrl?: string | null;
  readonly reducedMotion?: boolean;
  readonly zenPoints?: readonly ZenPointInput[];
  readonly zenBlendMode?: string;
  readonly zenAuto?: boolean;
  readonly zenRotation?: number;
  readonly vignette?: number;
}

export const defaultBackgroundSettings = Object.freeze({
  mode: 'atmospheric',
  intensity: 0.76,
  motion: 0.46,
  grain: 0.23,
  darkVeil: 0.39,
  blur: 0.73,
  saturation: 1,
  brightness: 1,
  tint: 0.76,
  glass: 0.64,
  contrast: 0.5,
  reducedMotion: false,
} satisfies BackgroundSettings);

const modeIndex: Record<BackgroundMode, number> = {
  atmospheric: 0, 'liquid-glass': 1, 'blurred-art': 2, artwork: 2, mesh: 3, zen: 4, minimal: 5, manual: 6,
};

const control = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value) : fallback;

const ART_EDGE = 192;
const ART_FADE_MS = 480;
const isArtMode = (mode: BackgroundMode) => mode === 'blurred-art' || mode === 'artwork';
const dimension = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1;

export class BackgroundScene {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);

  private readonly placeholder = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  private readonly uniforms = {
    uSize: { value: new Vector2(1, 1) },
    uTime: { value: 0 }, uIntensity: { value: 0 }, uGrain: { value: 0 }, uVeil: { value: 0 },
    uBlur: { value: 0 }, uMode: { value: 0 }, uLimit: { value: 0.28 },
    uSaturation: { value: 1 }, uBrightness: { value: 1 }, uTint: { value: 0.76 },
    uGlass: { value: 0.64 }, uContrast: { value: 0.5 },
    uPrimary: { value: new Color() }, uSecondary: { value: new Color() },
    uAccent: { value: new Color() }, uBackground: { value: new Color() },
    uArt: { value: this.placeholder as Texture },
    uArtCover: { value: new Vector2(1, 1) },
    uArtWeight: { value: 0 },
    uZenPoints: { value: Array.from({ length: 6 }, () => new Vector4(0.5, 0.5, 1.5, 1.0)) },
    uZenColors: { value: Array.from({ length: 6 }, () => new Color('#3b5a8c')) },
    uZenCount: { value: 0 },
    uZenBlend: { value: 0 },
    uZenRotation: { value: 0 },
    uVignette: { value: 0.72 },
  };
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly material = new ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: backgroundVertex,
    fragmentShader: backgroundFragment,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly panel = new Mesh(this.geometry, this.material);
  private currentPalette?: DynamicPalette;
  private currentZenPoints?: BackgroundSettings['zenPoints'];
  private currentZenPalette?: DynamicPalette;
  private requestedUrl?: string;
  private pendingImage?: HTMLImageElement;
  private loadedTexture?: Texture;
  private textureAspect = 1;
  private fadeStart?: number;
  private lastTimeMs?: number;
  private frameSettings: BackgroundSettings = defaultBackgroundSettings;
  private disposed = false;

  /** Callback is optional; invalidate demand-rendered scenes when artwork finishes loading. */
  constructor(private readonly onInvalidate?: () => void) {
    this.placeholder.needsUpdate = true;
    this.panel.frustumCulled = false;
    this.scene.add(this.panel);
  }

  update(width: number, height: number, timeMs: number, palette: DynamicPalette = defaultPalette,
    settings: BackgroundSettings = defaultBackgroundSettings): void {
    if (this.disposed) return;
    const mode = settings.mode ?? defaultBackgroundSettings.mode;
    const defaults = defaultBackgroundSettings;
    const u = this.uniforms;
    this.frameSettings = settings;
    u.uSize.value.set(dimension(width), dimension(height));
    u.uMode.value = modeIndex[mode] ?? 0;
    const step = this.lastTimeMs === undefined ? 0 : clamp(timeMs - this.lastTimeMs, 0, 48);
    this.lastTimeMs = timeMs;
    if (!settings.reducedMotion && mode !== 'minimal' && mode !== 'manual') {
      u.uTime.value += step * 0.001 * control(settings.motion, defaults.motion);
    }
    u.uIntensity.value = control(settings.intensity, defaults.intensity);
    u.uGrain.value = control(settings.grain, defaults.grain);
    u.uVeil.value = control(settings.darkVeil, defaults.darkVeil);
    u.uBlur.value = control(settings.blur, defaults.blur);
    u.uSaturation.value = Number.isFinite(settings.saturation) ? clamp(settings.saturation!, 0, 1.5) : defaults.saturation;
    u.uBrightness.value = Number.isFinite(settings.brightness) ? clamp(settings.brightness!, .5, 1.4) : defaults.brightness;
    u.uTint.value = control(settings.tint, defaults.tint);
    u.uGlass.value = control(settings.glass, defaults.glass);
    u.uContrast.value = control(settings.contrast, defaults.contrast);
    u.uVignette.value = control(settings.vignette, .72);
    u.uZenRotation.value = (Number.isFinite(settings.zenRotation) ? settings.zenRotation! : 0) * Math.PI / 180;

    // Update Zen interactive focal points if in zen mode with custom points
    if (mode === 'zen' && settings.zenPoints && settings.zenPoints.length > 0) {
      const pts = settings.zenPoints;
      u.uZenCount.value = Math.min(6, pts.length);
      const blendModeMap: Record<string, number> = { normal: 0, screen: 1, overlay: 2, lighten: 3 };
      u.uZenBlend.value = blendModeMap[settings.zenBlendMode ?? 'normal'] ?? 0;
      const automatic = settings.zenAuto ? palette : undefined;
      if (pts !== this.currentZenPoints || automatic !== this.currentZenPalette) {
        this.currentZenPoints = pts;
        this.currentZenPalette = automatic;
        const colors = automatic ? [palette.primary, palette.secondary, palette.accent, palette.secondary] : [];
        for (let i = 0; i < u.uZenCount.value; i++) {
          const pt = pts[i];
          u.uZenPoints.value[i].set(pt.x, pt.y, pt.spread, pt.intensity);
          u.uZenColors.value[i].setStyle(colors[i % colors.length] ?? pt.color);
        }
      }
    } else {
      u.uZenCount.value = 0;
    }

    if (palette !== this.currentPalette) {
      this.currentPalette = palette;
      u.uPrimary.value.setStyle(palette.primary);
      u.uSecondary.value.setStyle(palette.secondary);
      u.uAccent.value.setStyle(palette.accent);
      u.uBackground.value.setStyle(palette.background);
      // Soft luminous ceiling ensuring text contrast without crushing album vibrancy
      u.uLimit.value = 0.28;
    }
    const artwork = isArtMode(mode) ? settings.artworkDataUrl ?? undefined : undefined;
    if (artwork !== this.requestedUrl) this.loadArtwork(artwork);
    if (this.loadedTexture) {
      const aspect = u.uSize.value.x / u.uSize.value.y;
      u.uArtCover.value.set(Math.min(1, aspect / this.textureAspect), Math.min(1, this.textureAspect / aspect));
      this.fadeStart ??= timeMs;
      const p = settings.reducedMotion ? 1 : clamp((timeMs - this.fadeStart) / ART_FADE_MS);
      u.uArtWeight.value = p * p * (3 - 2 * p);
    }
  }

  /** Whether another frame would change. Texture loading invalidates via the constructor callback. */
  isAnimated(settings: BackgroundSettings = this.frameSettings): boolean {
    if (this.disposed || settings.reducedMotion) return false;
    const mode = settings.mode ?? defaultBackgroundSettings.mode;
    if (mode === 'minimal' || mode === 'manual') return false;
    return control(settings.motion, defaultBackgroundSettings.motion) > 0
      || (isArtMode(mode) && !!this.loadedTexture && this.uniforms.uArtWeight.value < 1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseArtwork();
    this.placeholder.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.panel);
  }

  private releaseArtwork(): void {
    if (this.pendingImage) {
      this.pendingImage.onload = null;
      this.pendingImage.onerror = null;
      this.pendingImage.removeAttribute('src');
    }
    this.pendingImage = undefined;
    this.loadedTexture?.dispose();
    this.loadedTexture = undefined;
    this.fadeStart = undefined;
    this.uniforms.uArt.value = this.placeholder;
    this.uniforms.uArtWeight.value = 0;
  }

  private loadArtwork(url: string | undefined): void {
    this.releaseArtwork();
    this.requestedUrl = url;
    if (!url || !isArtworkDataUrl(url) || typeof Image === 'undefined') return;
    const image = new Image();
    image.decoding = 'async';
    this.pendingImage = image;
    image.onload = () => {
      if (this.disposed || this.pendingImage !== image) return;
      this.pendingImage = undefined;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) return;
      const scale = Math.min(1, ART_EDGE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!context) return;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const texture = new Texture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      texture.premultiplyAlpha = true;
      this.textureAspect = width / height;
      this.loadedTexture = texture;
      this.uniforms.uArt.value = texture;
      this.onInvalidate?.();
    };
    image.onerror = () => {
      if (this.pendingImage === image) this.pendingImage = undefined;
    };
    image.src = url;
  }
}
