import { chroma, clamp, distance2, rgbToLab } from './oklab';
import type { Lab } from './oklab';
import { defaultPalette, semanticPalette } from './palette';
import type { DynamicPalette } from './palette';

export interface WeightedColor {
  readonly lab: Lab;
  readonly weight: number;
}

interface Bucket { r: number; g: number; b: number; weight: number }
const K = 9;

export function sampleHistogram(rgba: Uint8ClampedArray): WeightedColor[] {
  const byBin = new Map<number, Bucket>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const alpha = rgba[i + 3]! / 255;
    if (alpha < 0.12) continue;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let value = byBin.get(key);
    if (!value) {
      value = { r: 0, g: 0, b: 0, weight: 0 };
      byBin.set(key, value);
    }
    value.r += r * alpha;
    value.g += g * alpha;
    value.b += b * alpha;
    value.weight += alpha;
  }
  return [...byBin.entries()].sort(([a], [b]) => a - b).map(([, value]) => ({
    lab: rgbToLab(
      value.r / (255 * value.weight),
      value.g / (255 * value.weight),
      value.b / (255 * value.weight),
    ),
    weight: value.weight,
  }));
}

/** Weighted farthest-first seeding followed by bounded Lloyd refinement in OKLab. */
export function clusterColors(points: readonly WeightedColor[], count = K): WeightedColor[] {
  if (count <= 0) return [];
  if (points.length <= count) return points.slice();
  const weights = points.map(point => Math.sqrt(Math.sqrt(point.weight)));
  const closest = new Float64Array(points.length).fill(Infinity);
  let first = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.weight > points[first]!.weight) first = i;
  }
  let centers: Lab[] = [points[first]!.lab];
  while (centers.length < count) {
    let candidate = -1;
    let best = 0;
    const last = centers[centers.length - 1]!;
    for (let i = 0; i < points.length; i++) {
      closest[i] = Math.min(closest[i]!, distance2(last, points[i]!.lab));
      const score = closest[i]! * weights[i]!;
      if (score > best) {
        best = score;
        candidate = i;
      }
    }
    if (candidate < 0 || best < 0.000001) break;
    centers.push(points[candidate]!.lab);
  }
  let result: WeightedColor[] = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0] as [number, number, number, number]);
    for (const { lab, weight } of points) {
      let nearest = 0;
      let error = distance2(lab, centers[0]!);
      for (let i = 1; i < centers.length; i++) {
        const distance = distance2(lab, centers[i]!);
        if (distance < error) {
          nearest = i;
          error = distance;
        }
      }
      const sum = sums[nearest]!;
      sum[0] += lab[0] * weight;
      sum[1] += lab[1] * weight;
      sum[2] += lab[2] * weight;
      sum[3] += weight;
    }
    let movement = 0;
    result = [];
    for (let i = 0; i < sums.length; i++) {
      const [l, a, b, weight] = sums[i]!;
      if (weight === 0) continue;
      const lab: Lab = [l / weight, a / weight, b / weight];
      movement = Math.max(movement, distance2(centers[i]!, lab));
      result.push({ lab, weight });
    }
    if (movement < 0.000001 && result.length === centers.length) break;
    centers = result.map(item => item.lab);
  }
  return result;
}

export function paletteFromPixels(rgba: Uint8ClampedArray): DynamicPalette | undefined {
  const points = sampleHistogram(rgba);
  if (!points.length) return undefined;
  const total = points.reduce((sum, point) => sum + point.weight, 0);
  const colorful = points.reduce((sum, point) => sum + (chroma(point.lab) >= 0.035 ? point.weight : 0), 0);
  const strongColor = points.reduce((sum, point) => sum + (chroma(point.lab) >= 0.095 ? point.weight : 0), 0);
  if (colorful / total < 0.035 && strongColor / total < 0.012) {
    const mean = points.reduce((sum, { lab, weight }) => sum + lab[0] * weight, 0) / total;
    return semanticPalette(
      [clamp(mean, 0.34, 0.65), 0, 0],
      [clamp(mean + 0.19, 0.54, 0.79), 0, 0],
      [clamp(mean + 0.33, 0.76, 0.86), 0, 0],
    );
  }
  const clusters = clusterColors(points);
  const eligible = clusters.filter(cluster => cluster.weight / total >= (chroma(cluster.lab) > 0.09 ? 0.008 : 0.022));
  const candidates = eligible.length ? eligible : clusters;
  const share = (item: WeightedColor) => item.weight / total;
  const colorStrength = (item: WeightedColor) => Math.min(1, chroma(item.lab) / 0.15);
  const separation = (a: Lab, b: Lab) =>
    Math.hypot((a[0] - b[0]) * 0.32, a[1] - b[1], a[2] - b[2]);
  const best = (score: (item: WeightedColor) => number) =>
    candidates.reduce((a, b) => score(a) >= score(b) ? a : b);
  const primary = best(item => Math.sqrt(share(item)) * (0.23 + colorStrength(item) * 0.77)
    * (1 - 0.30 * Math.abs(item.lab[0] - 0.57))).lab;
  const second = best(item => share(item) ** 0.36 * (0.34 + colorStrength(item) * 0.66)
    * Math.min(separation(item.lab, primary) / 0.14, 1.3)).lab;
  const secondary: Lab = separation(primary, second) >= 0.027
    ? second
    : [clamp(primary[0] + (primary[0] > 0.57 ? -0.19 : 0.19), 0.38, 0.77), primary[1] * 0.66, primary[2] * 0.66];
  const pop = best(item => share(item) ** 0.17 * (0.18 + colorStrength(item) * 0.82)
    * (0.61 + Math.min(separation(item.lab, primary) + separation(item.lab, secondary), 0.35))).lab;
  const accent: Lab = separation(pop, primary) < 0.022
    ? [Math.max(pop[0] + 0.095, 0.70), pop[1], pop[2]]
    : pop;
  return clusters.length ? semanticPalette(primary, secondary, accent) : defaultPalette;
}
