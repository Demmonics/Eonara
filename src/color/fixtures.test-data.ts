type Pixel = readonly [number, number, number, number?];
const DEFAULT_EDGE = 96;

export function generatedPixels(pixel: (x: number, y: number) => Pixel, edge = DEFAULT_EDGE): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(edge * edge * 4);
  for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) {
    const [r, g, b, a = 255] = pixel(x / edge, y / edge);
    pixels.set([r, g, b, a], (y * edge + x) * 4);
  }
  return pixels;
}

export const syntheticCovers = {
  poster: generatedPixels((x, y) => {
    if (y < 0.17) return [12 + 28 * x, 23 + 30 * x, 35 + 22 * x];
    if (x < 0.65) return [200 + 40 * y, 77 + 36 * x, 34 + 25 * y];
    return [24 + 30 * y, 135 + 40 * y, 159 + 25 * x];
  }),
  night: generatedPixels((x, y) => {
    const haze = Math.exp(-9 * ((x - 0.30) ** 2 + (y - 0.20) ** 2));
    const light = Math.exp(-150 * ((x - 0.72) ** 2 + (y - 0.60) ** 2));
    return [9 + 37 * haze + 217 * light, 12 + 26 * haze + 128 * light, 19 + 82 * haze + 37 * light];
  }),
  spectra: generatedPixels((x, y) => {
    const noise = (Math.sin(x * 126.7 + y * 223.1) * 43758.5453) % 1 * 16;
    return [
      126 + 92 * Math.sin(x * 6.1 + y * 3.3) + noise,
      128 + 85 * Math.cos(x * 3.7 - y * 6.5) + noise,
      121 + 105 * Math.sin(x * 2.4 + y * 5.6 + 2) + noise,
    ];
  }),
  monochrome: generatedPixels((x, y) => {
    const value = 12 + 227 * Math.abs(Math.sin(9 * x - 4 * y)) * (0.2 + 0.8 * y);
    return [value, value, value];
  }),
  spot: generatedPixels((x, y) => {
    if ((x - 0.46) ** 2 + (y - 0.50) ** 2 < 0.10 ** 2) return [238, 47, 105];
    const grey = 17 + 42 * (x + y);
    return [grey, grey, grey];
  }),
};
