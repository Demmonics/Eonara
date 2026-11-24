import { bench, describe } from 'vitest';
import { syntheticCovers } from './fixtures.test-data';
import { distance2 } from './oklab';
import type { Lab } from './oklab';
import { clusterColors, sampleHistogram } from './quantize';
import type { WeightedColor } from './quantize';

const covers = Object.entries(syntheticCovers).map(([name, pixels]) => ({ name, points: sampleHistogram(pixels) }));
type Candidate = (points: readonly WeightedColor[], count: number) => Lab[];

const histogram: Candidate = (points, count) =>
  [...points].sort((a, b) => b.weight - a.weight).slice(0, count).map(item => item.lab);

function weightedMean(points: readonly WeightedColor[]): Lab {
  const sums = [0, 0, 0, 0];
  for (const point of points) {
    for (let i = 0; i < 3; i++) sums[i] += point.lab[i]! * point.weight;
    sums[3] += point.weight;
  }
  return [sums[0] / sums[3], sums[1] / sums[3], sums[2] / sums[3]];
}

const medianCut: Candidate = (points, count) => {
  const splitInfo = (items: WeightedColor[]) => {
    const range = [0, 1, 2].map(axis => {
      let min = Infinity;
      let max = -Infinity;
      for (const { lab } of items) {
        min = Math.min(min, lab[axis]!);
        max = Math.max(max, lab[axis]!);
      }
      return max - min;
    });
    const span = Math.max(...range);
    return { items, span, axis: range.indexOf(span), mass: items.reduce((sum, item) => sum + item.weight, 0) };
  };
  const boxes = [splitInfo([...points])];
  while (boxes.length < count) {
    boxes.sort((a, b) => b.span * Math.sqrt(b.mass) - a.span * Math.sqrt(a.mass));
    const box = boxes.shift()!;
    if (box.items.length < 2) {
      boxes.unshift(box);
      break;
    }
    box.items.sort((a, b) => a.lab[box.axis]! - b.lab[box.axis]!);
    let index = 0;
    let weight = 0;
    while (index < box.items.length - 1 && weight < box.mass / 2) weight += box.items[index++]!.weight;
    boxes.push(splitInfo(box.items.slice(0, index)), splitInfo(box.items.slice(index)));
  }
  return boxes.map(box => weightedMean(box.items));
};

function rms(points: readonly WeightedColor[], centroids: readonly Lab[]): number {
  let error = 0;
  let total = 0;
  for (const { lab, weight } of points) {
    error += weight * Math.min(...centroids.map(candidate => distance2(lab, candidate)));
    total += weight;
  }
  return Math.sqrt(error / total);
}

const candidates: Record<string, Candidate> = {
  'top RGB bins': histogram,
  'weighted median cut (OKLab)': medianCut,
  'weighted k-means (OKLab)': (points, count) => clusterColors(points, count).map(item => item.lab),
};

describe('nine swatches / five generated covers / shared histogram input', () => {
  console.table(covers.map(({ name, points }) => ({
    cover: name,
    bins: points.length,
    ...Object.fromEntries(Object.entries(candidates).map(([label, quantize]) => [
      label, rms(points, quantize(points, 9)).toFixed(4),
    ])),
  })));
  for (const [name, quantize] of Object.entries(candidates)) {
    bench(name, () => {
      for (const { points } of covers) quantize(points, 9);
    });
  }
});
