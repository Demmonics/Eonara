import { describe, expect, it } from 'vitest';
import { composite, deriveMaterials, materialOpacity, readableInk } from './materials';
import { contrast } from './oklab';
import { demoStylePalette, manualPalette } from './palette';

describe('palette materials', () => {
  it('keeps readable subdued labels and overlays across bright, dark, and busy backdrops', () => {
    const covers = ['#fcf0ef', '#fc6598', '#392bec', '#17ba62', '#050505', '#7e7f88'];
    const windows = ['#ffffff', '#080a10', '#7c7e88'];
    for (const color of covers) {
      const pal = manualPalette(color, '#22230f', '#fa594b');
      const material = deriveMaterials(pal, 1, .15);
      for (const backdrop of windows) {
        expect(contrast(material.muted, composite(material.toolbar, backdrop, material.opacity))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(material.muted, composite(material.popover, backdrop, Math.max(.92, material.opacity)))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(pal.foreground, composite(material.overlaySurface, backdrop, material.overlayOpacity))).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(material.muted, material.gallery)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(pal.foreground, material.cardBackdrop)).toBeGreaterThanOrEqual(7);
    }
  });

  it('maintains WCAG >=4.5:1 across all curated demo style grades', () => {
    for (const id of ['ship', 'fisheye', 'visual', 'codestyle', 'branches', 'web', 'constellation', 'payments', 'notifications']) {
      const pal = demoStylePalette(id);
      const m = deriveMaterials(pal, .55, .64);
      expect(contrast(m.muted, composite(m.toolbar, '#ffffff', m.opacity))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(m.accentInk, pal.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('does not claim a final opacity works when even the opaque surface fails', () => {
    expect(materialOpacity('#c7c4d4', '#eeeeee', .2)).toBeNull();
  });

  it('uses an adequately contrasting ink on light, middle and dark word backings', () => {
    for (const color of ['#f8cb8f', '#777777', '#554389', '#121212']) {
      expect(contrast(readableInk(color), color)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
