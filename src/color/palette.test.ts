import { describe, expect, it } from 'vitest';
import { BackgroundScene } from './BackgroundScene';
import { paletteFromArtwork } from './extract';
import { generatedPixels, syntheticCovers } from './fixtures.test-data';
import { chroma, contrast, distance2, hexToLab, mixLab } from './oklab';
import { defaultPalette, demoStylePalette, manualPalette, paletteRoles } from './palette';
import type { DynamicPalette } from './palette';
import { paletteFromPixels } from './quantize';
import { PaletteTransition } from './transition';

function expectReadable(palette: DynamicPalette) {
  for (const base of [palette.background, palette.surface]) {
    expect(contrast(palette.foreground, base)).toBeGreaterThanOrEqual(7);
    expect(contrast(palette.mutedForeground, base)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.accent, base)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.accent, base)).toBeGreaterThanOrEqual(3);
  }
}

describe('semantic palette', () => {
  it('extracts deterministic, contrast-safe palettes with neutral lyric foreground', () => {
    for (const pixels of Object.values(syntheticCovers)) {
      const first = paletteFromPixels(pixels)!;
      expect(first).toEqual(paletteFromPixels(pixels));
      expectReadable(first);
      for (const key of paletteRoles) expect(first[key]).toMatch(/^#[a-f0-9]{6}$/);
      expect(chroma(hexToLab(first.foreground))).toBeLessThan(0.001);
    }
    const cool = paletteFromPixels(generatedPixels(() => [31, 97, 222]))!;
    const warm = paletteFromPixels(generatedPixels(() => [231, 53, 31]))!;
    expect(distance2(hexToLab(cool.primary), hexToLab(warm.primary))).toBeGreaterThan(0.06);
  });

  it('maintains separation & WCAG legibility across cold, warm, deep blue, high pink, and low-saturation covers', () => {
    const deepBlue = paletteFromPixels(generatedPixels((x, y) => [12 + x * 24, 34 + y * 30, 148]))!;
    const highPink = paletteFromPixels(generatedPixels((x) => x < 0.7 ? [232, 68, 152] : [250, 200, 220]))!;
    const lowSat = paletteFromPixels(generatedPixels((x) => [102 + x * 18, 98 + x * 16, 108 + x * 14]))!;
    for (const p of [deepBlue, highPink, lowSat]) {
      expectReadable(p);
      expect(hexToLab(p.foreground)[0]).toBeGreaterThan(hexToLab(p.background)[0] + 0.5);
      expect(hexToLab(p.primary)[0]).toBeGreaterThan(hexToLab(p.background)[0] + 0.12);
    }
    // High pink retains higher chroma in accent/primary than low-saturation slate cover
    expect(chroma(hexToLab(highPink.primary))).toBeGreaterThan(chroma(hexToLab(lowSat.primary)) * 2);
  });

  it('provides distinct, contrast-verified original demo color grades for all 13 styles', () => {
    const ids = [
      'ship', 'fisheye', 'visual', 'fisheye-visual', 'codestyle', 'codestyle-visual',
      'branches', 'web', 'constellation', 'message-thread', 'payments', 'map-journey', 'notifications',
    ];
    const seen = new Set<string>();
    for (const id of ids) {
      const p = demoStylePalette(id);
      expectReadable(p);
      seen.add(p.primary);
    }
    expect(seen.size).toBe(ids.length);
  });

  it('makes grayscale covers achromatic without losing their tonal hierarchy', () => {
    const palette = paletteFromPixels(syntheticCovers.monochrome)!;
    for (const key of paletteRoles) expect(chroma(hexToLab(palette[key]))).toBeLessThan(0.001);
    expect(hexToLab(palette.primary)[0]).toBeLessThan(hexToLab(palette.secondary)[0]);
    expect(hexToLab(palette.secondary)[0]).toBeLessThan(hexToLab(palette.accent)[0]);
  });

  it('picks up a bounded splash of color and ignores the RGB of transparent pixels', () => {
    const palette = paletteFromPixels(syntheticCovers.spot)!;
    expect(chroma(hexToLab(palette.accent))).toBeGreaterThan(0.13);
    const invisible = generatedPixels((x) => [255, x * 255, 90, 0]);
    expect(paletteFromPixels(invisible)).toBeUndefined();
    const hiddenColor = generatedPixels((x) => x < 0.1 ? [255, 0, 0, 2] : [64, 64, 64]);
    expect(chroma(hexToLab(paletteFromPixels(hiddenColor)!.primary))).toBeLessThan(0.001);
  });

  it('normalizes manual swatches and guards against an unreadable accent', () => {
    expectReadable(defaultPalette);
    const manual = manualPalette('#123', '#DE7723', '#000');
    expect(manual.primary).toBe('#112233');
    expect(manual.secondary).toBe('#de7723');
    expect(manual.accent).not.toBe('#000000');
    expectReadable(manual);
  });

  it('handles unavailable/malformed artwork without error', async () => {
    await expect(paletteFromArtwork('')).resolves.toBe(defaultPalette);
    await expect(paletteFromArtwork('https://invalid.example/cover.png')).resolves.toBe(defaultPalette);
    await expect(paletteFromArtwork('data:image/png;base64,not-an-image')).resolves.toBe(defaultPalette);
  });
});

describe('palette transitions', () => {
  it('retargets at the exact sampled intermediate and finishes at the declared target', () => {
    const warm = manualPalette('#ff8829', '#d02736', '#f1b899');
    const cool = manualPalette('#123bcd', '#145e99', '#2ddfc6');
    const transition = new PaletteTransition(defaultPalette, 1000);
    transition.setTarget(warm, 0);
    const midway = transition.sample(500);
    expect(distance2(hexToLab(midway.primary), mixLab(hexToLab(defaultPalette.primary), hexToLab(warm.primary), 0.5)))
      .toBeLessThan(0.00001);
    transition.setTarget(cool, 500);
    expect(transition.sample(500)).toEqual(midway);
    expect(transition.isActive(1499)).toBe(true);
    expect(transition.isActive(1500)).toBe(false);
    expect(transition.sample(1500)).toBe(cool);
    for (let ms = 500; ms <= 1500; ms += 50) expectReadable(transition.sample(ms));
  });

  it('does not restart on the same target and permits reduced-motion snapping', () => {
    const bright = manualPalette('#ffffff', '#ffffff', '#ffffff');
    const transition = new PaletteTransition(defaultPalette, 1000);
    transition.setTarget(bright, 0);
    transition.setTarget({ ...bright }, 500);
    expect(transition.sample(1000)).toBe(bright);
    transition.setTarget(defaultPalette, 1100);
    transition.setTarget(defaultPalette, 1101, 0);
    expect(transition.sample(1101)).toBe(defaultPalette);
  });
});

it('leaves static and reduced-motion backgrounds to the caller’s demand loop and updates DPR grain uniforms', () => {
  const scene = new BackgroundScene();
  expect(scene.scene.children).toHaveLength(1);
  expect(scene.isAnimated({ mode: 'manual' })).toBe(false);
  expect(scene.isAnimated({ mode: 'minimal' })).toBe(false);
  expect(scene.isAnimated({ mode: 'mesh', motion: 0 })).toBe(false);
  expect(scene.isAnimated({ mode: 'liquid-glass', reducedMotion: true })).toBe(false);
  expect(scene.isAnimated({ mode: 'artwork' })).toBe(true);
  scene.update(1920, 1080, 0, defaultPalette, { mode: 'mesh', grain: 0.25 }, 2);
  expect(scene.isAnimated()).toBe(true);
  scene.dispose();
  expect(scene.scene.children).toHaveLength(0);
  expect(scene.isAnimated()).toBe(false);
});
