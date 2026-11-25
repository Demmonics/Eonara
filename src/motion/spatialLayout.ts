import { clamp } from './timeline'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LabelCandidate {
  dx: number
  dy: number
  penalty?: number
}

export interface LabelRequest {
  id: string
  anchorX: number
  anchorY: number
  w: number
  h: number
  priority: number
  candidates: readonly LabelCandidate[]
  allowShrink?: boolean
}

export interface PlacedLabel {
  id: string
  x: number
  y: number
  w: number
  h: number
  scale: number
  visible: boolean
  overlapArea: number
}

export function overlapArea(a: Rect, b: Rect): number {
  const dx = Math.min(a.x + a.w * .5, b.x + b.w * .5) - Math.max(a.x - a.w * .5, b.x - b.w * .5)
  if (dx <= 0) return 0
  const dy = Math.min(a.y + a.h * .5, b.y + b.h * .5) - Math.max(a.y - a.h * .5, b.y - b.h * .5)
  return dy > 0 ? dx * dy : 0
}

export function outOfBoundsArea(box: Rect, bounds: Rect): number {
  const area = Math.max(0, box.w) * Math.max(0, box.h)
  if (area <= 0) return 0
  return area - overlapArea(box, bounds)
}

export function clampBoxToBounds(x: number, y: number, w: number, h: number, bounds: Rect): readonly [number, number] {
  const minX = bounds.x - bounds.w * .5 + w * .5
  const maxX = bounds.x + bounds.w * .5 - w * .5
  const minY = bounds.y - bounds.h * .5 + h * .5
  const maxY = bounds.y + bounds.h * .5 - h * .5
  return [
    minX <= maxX ? clamp(x, minX, maxX) : bounds.x,
    minY <= maxY ? clamp(y, minY, maxY) : bounds.y,
  ]
}

/**
 * Resolve deterministic non-overlapping positions for settled anchor labels.
 * Evaluates fixed candidate offsets against obstacles, previously placed labels,
 * and safe-area bounds; shrinks or defers low-priority labels when crowded.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  obstacles: readonly Rect[],
  bounds: Rect,
  minClearance = 4,
): PlacedLabel[] {
  const ordered = requests
    .map((req, index) => ({ req, index }))
    .sort((a, b) => b.req.priority - a.req.priority || a.index - b.index)

  const placedRects: Rect[] = []
  const placedMap = new Map<string, PlacedLabel>()

  for (const { req } of ordered) {
    const scales = req.allowShrink === false ? [1] : [1, .86, .74]
    let best: { x: number; y: number; w: number; h: number; scale: number; overlap: number; score: number } | undefined

    for (const scale of scales) {
      const w = req.w * scale
      const h = req.h * scale
      for (const cand of req.candidates) {
        const [cx, cy] = clampBoxToBounds(req.anchorX + cand.dx, req.anchorY + cand.dy, w, h, bounds)
        const box: Rect = { x: cx, y: cy, w: w + minClearance, h: h + minClearance }
        let overlap = 0
        for (const obs of obstacles) overlap += overlapArea(box, obs)
        for (const prev of placedRects) overlap += overlapArea(box, prev) * 1.15
        const oob = outOfBoundsArea({ x: cx, y: cy, w, h }, bounds)
        const dist = Math.hypot(cx - req.anchorX, cy - req.anchorY)
        const score = overlap * 25 + oob * 35 + dist * .08 + (1 - scale) * 140 + (cand.penalty ?? 0)
        if (!best || score < best.score - 1e-6) {
          best = { x: cx, y: cy, w, h, scale, overlap, score }
        }
        if (overlap <= .01 && oob <= .01 && scale === 1 && (cand.penalty ?? 0) === 0) break
      }
      if (best && best.overlap <= .01) break
    }

    const chosen = best ?? {
      x: req.anchorX,
      y: req.anchorY,
      w: req.w,
      h: req.h,
      scale: 1,
      overlap: 0,
      score: 0,
    }
    const maxAcceptableOverlap = chosen.w * chosen.h * .42
    const defer = req.priority < .5 && chosen.overlap > maxAcceptableOverlap
    if (!defer) {
      placedRects.push({ x: chosen.x, y: chosen.y, w: chosen.w + minClearance, h: chosen.h + minClearance })
    }
    placedMap.set(req.id, {
      id: req.id,
      x: chosen.x,
      y: chosen.y,
      w: chosen.w,
      h: chosen.h,
      scale: chosen.scale,
      visible: !defer,
      overlapArea: chosen.overlap,
    })
  }

  return requests.map(req => placedMap.get(req.id)!)
}
