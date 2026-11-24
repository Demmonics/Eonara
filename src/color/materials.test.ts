import { describe, expect, it } from 'vitest';
import { deriveMaterials, materialOpacity, readableInk } from './materials';
import { contrast } from './oklab';
import { manualPalette } from './palette';

const overWhite = (hex: string, alpha: number) => '#' + [1,3,5].map(i =>
  Math.round(Number.parseInt(hex.slice(i,i+2), 16) * alpha + 255 * (1 - alpha)).toString(16).padStart(2,'0')).join('');

describe('palette materials', () => {
  it('keeps readable subdued labels over the brightest SDR artwork even when glass is set low', () => {
    for (const color of ['#fcf0ef','#fc6598','#392bec','#17ba62','#050505']) {
      const material = deriveMaterials(manualPalette(color, '#22230f', '#fa594b'), 1, .15);
      expect(contrast(material.muted, overWhite(material.toolbar, material.opacity))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(material.muted, overWhite(material.popover, Math.max(.92, material.opacity)))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('does not claim a final opacity works when even the opaque surface fails', () => {
    expect(materialOpacity('#c7c4d4','#eeeeee',.2)).toBeNull();
  });
  it('uses an adequately contrasting ink on light, middle and dark word backings', () => {
    for (const color of ['#f8cb8f','#777777','#554389','#121212']) {
      expect(contrast(readableInk(color),color)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
