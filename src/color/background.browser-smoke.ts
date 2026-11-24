import { WebGLRenderer } from 'three';
import { BackgroundScene, defaultPalette, paletteFromArtwork } from './index';
import type { BackgroundMode } from './index';
import { syntheticCovers } from './fixtures.test-data';
import { contrast } from './oklab';

const result = document.querySelector<HTMLElement>('#result')!;

async function checkColorEngine() {
  const artwork = document.createElement('canvas');
  artwork.width = artwork.height = 96;
  artwork.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(syntheticCovers.poster), 96, 96), 0, 0);
  const dataUrl = artwork.toDataURL('image/png');
  const first = paletteFromArtwork(dataUrl);
  if (first !== paletteFromArtwork(dataUrl)) throw new Error('Concurrent worker requests did not coalesce');
  const palette = await first;
  if (palette.primary === defaultPalette.primary) throw new Error('Worker did not extract the test artwork');
  const native = await paletteFromArtwork(dataUrl, 'generated-poster');
  if (JSON.stringify(palette) !== JSON.stringify(native)) throw new Error('Native hash produced a different palette');
  const invalid = await paletteFromArtwork('data:image/png;base64,!');
  if (invalid !== defaultPalette) throw new Error('Malformed art did not fall back');

  const width = 256;
  const height = 160;
  const renderer = new WebGLRenderer({ antialias: false, depth: false, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  let ready!: () => void;
  const invalidated = new Promise<void>(resolve => { ready = resolve; });
  const background = new BackgroundScene(ready);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(width * height * 4);
  const results = new Map<string, { checksum: number; foreground: number; accent: number }>();
  const modes: BackgroundMode[] = ['atmospheric', 'liquid-glass', 'blurred-art', 'mesh', 'minimal', 'manual'];
  let artworkTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    for (const mode of modes) {
      const settings = {
        mode, artworkDataUrl: dataUrl, reducedMotion: true, darkVeil: 0, intensity: 1, grain: 1,
      };
      background.update(width, height, 0, palette, settings);
      if (mode === 'blurred-art') {
        const timeout = new Promise<never>((_, reject) => {
          artworkTimeout = setTimeout(() => reject(new Error('Artwork texture load timed out')), 4000);
        });
        await Promise.race([invalidated, timeout]);
        background.update(width, height, 500, palette, settings);
      }
      renderer.render(background.scene, background.camera);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let checksum = 0;
      let foreground = Infinity;
      let accent = Infinity;
      for (let i = 0; i < pixels.length; i += 4) {
        checksum += pixels[i]! + 3 * pixels[i + 1]! + 7 * pixels[i + 2]!;
        if (i % 16 === 0) {
          const hex = '#' + Array.from(pixels.subarray(i, i + 3), c => c.toString(16).padStart(2, '0')).join('');
          foreground = Math.min(foreground, contrast(palette.foreground, hex));
          accent = Math.min(accent, contrast(palette.accent, hex));
        }
      }
      if (checksum < 5000 || [...results.values()].some(existing => existing.checksum === checksum)) {
        throw new Error(`Blank or duplicate mode: ${mode}`);
      }
      if (foreground < 7 || accent < 4.5) throw new Error(`Contrast failure in ${mode}: ${foreground}, ${accent}`);
      results.set(mode, { checksum, foreground, accent });
    }
    return { palette, modes: Object.fromEntries(results) };
  } finally {
    clearTimeout(artworkTimeout);
    background.dispose();
    renderer.dispose();
  }
}

void checkColorEngine().then(summary => {
  result.dataset.status = 'passed';
  result.textContent = JSON.stringify(summary, null, 2);
}, error => {
  result.dataset.status = 'failed';
  result.textContent = String(error);
});
