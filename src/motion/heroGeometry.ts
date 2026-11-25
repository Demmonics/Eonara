import { evalChannel, lexicalGroups, type ChannelSegment } from './choreography'
import { clamp, cueWindow, mix, smooth, type Cue, type Token } from './timeline'

export interface ShipWord {
  text: string
  token?: Token
  spaced: boolean
}

/** Keep punctuation and any unaligned affixes in the shaped run they touch. */
export function shipWords(cue: Cue): ShipWord[] {
  return lexicalGroups(cue).map(({ text, token, spaced }) => ({ text, token, spaced }))
}

export function contiguousCueRun(
  cues: readonly Cue[],
  cueIndex: number,
  timeMs: number,
  eligible: (cue: Cue) => boolean,
  maxCues = 3,
  maxAgeMs = 4500,
  maxGapMs = 1600,
): Cue[] {
  const windowed = cueWindow(cues, cueIndex, timeMs, maxCues, maxAgeMs)
  const out: Cue[] = []
  for (let i = windowed.length - 1; i >= 0; i--) {
    const c = windowed[i]
    if (!eligible(c)) break
    if (out.length > 0) {
      const next = out[0]
      if (next.startMs - c.endMs > maxGapMs) break
    }
    out.unshift(c)
  }
  return out
}

export function assignWordReveals(cue: Cue, words: readonly { token?: Token }[]): number[] {
  const times = new Array<number>(words.length)
  for (let i = 0; i < words.length; i++) {
    if (words[i].token) times[i] = words[i].token!.startMs
  }
  let prevTimed = -1
  for (let i = 0; i <= words.length; i++) {
    if (i === words.length || times[i] !== undefined) {
      if (i - prevTimed > 1) {
        const startT = prevTimed >= 0 ? times[prevTimed] : cue.startMs
        const endT = i < words.length ? times[i] : cue.endMs
        const span = i - prevTimed
        for (let k = prevTimed + 1; k < i; k++) {
          times[k] = mix(startT, endT, (k - prevTimed) / span)
        }
      }
      prevTimed = i
    }
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) times[i] = times[i - 1]
  }
  return times
}

export interface MeasuredWord extends ShipWord {
  width: number
  size: number
  gap: number
  display: boolean
}

interface ShipRow { width: number; words: MeasuredWord[] }
export interface ShipPlacement extends MeasuredWord { x: number; y: number }
export interface ShipPage { words: ShipPlacement[]; first?: Token }

/** Pack measured words with a ragged measure, then give each row its own
 * registration on the slab. Camera movement never changes these coordinates. */
export function packShip(words: readonly MeasuredWord[], measure: number, step: number, rowsPerPage: number, flip: boolean): ShipPage[] {
  if (!words.length) return []
  const n = words.length
  const widest = Math.max(...words.map(word => word.width))
  const total = words.reduce((sum, word, i) => sum + word.width + (i ? word.gap : 0), 0)
  const target = Math.min(measure, Math.max(widest, Math.min(measure * .79, total * .64)))
  const cuts = new Array<number>(n)
  const costs = new Array<number>(n + 1)
  costs[n] = 0
  for (let i = n - 1; i >= 0; i--) {
    let cost = Infinity, width = 0
    for (let j = i; j < n; j++) {
      width += words[j].width + (j > i ? words[j].gap : 0)
      if (j > i && width > measure) break
      const rag = (width - target) / target
      const oneSlab = i === 0 && j === n - 1 && n >= 3 && total > widest * 1.35 ? .30 : 0
      const orphan = i > 0 && j === n - 1 && i === j && width < target * .31 ? .28 : 0
      const candidate = .21 + rag ** 2 + oneSlab + orphan + costs[j + 1]
      if (candidate < cost) {
        cost = candidate
        cuts[i] = j + 1
      }
    }
    costs[i] = cost
  }
  const rows: ShipRow[] = []
  for (let i = 0; i < n; i = cuts[i]) {
    const row = words.slice(i, cuts[i])
    rows.push({ words: row, width: row.reduce((sum, word, j) => sum + word.width + (j ? word.gap : 0), 0) })
  }
  const pages: ShipPage[] = []
  const register = [.04, .83, .26, .70]
  for (let start = 0; start < rows.length; start += rowsPerPage) {
    const slab = rows.slice(start, start + rowsPerPage)
    const slabWidth = Math.min(measure, Math.max(Math.max(...slab.map(row => row.width)) + step * .44, measure * .47))
    const margins = slab.map((row, i) => {
      const fraction = slab.length === 1 ? .5 : flip ? 1 - register[i % 4] : register[i % 4]
      return (slabWidth - row.width) * fraction
    })
    if (slab.length > 1 && Math.max(...margins) - Math.min(...margins) < step * .28) {
      const open = slab.reduce((best, row, i) => row.width < slab[best].width ? i : best, 0)
      const room = slabWidth - slab[open].width
      const other = margins[open === 0 ? 1 : 0]
      margins[open] = other < room * .5 ? room * .87 : room * .08
    }
    const placed: ShipPlacement[] = []
    slab.forEach((row, i) => {
      let left = -slabWidth / 2 + margins[i]
      const baseline = (slab.length / 2 - .5 - i) * step
      row.words.forEach((word, j) => {
        if (j) left += word.gap
        placed.push({ ...word, x: left + word.width / 2, y: baseline + word.size * .15 })
        left += word.width
      })
    })
    pages.push({ words: placed, first: placed.find(word => word.token)?.token })
  }
  return pages
}

export interface ShipWallInput {
  id: string
  cueIndex: number
  wordIndex: number
  text: string
  token?: Token
  revealMs: number
  width: number
  size: number
  display: boolean
  accented: boolean
}

export interface ShipWallNode extends ShipWallInput {
  x: number
  y: number
}

const WALL_STAGGER = [.14, -.28, .22, -.16, .27, -.21, .08, -.25]

/**
 * Place lexical words onto a staggered vertical word-wall with guaranteed
 * baseline clearance, asymmetric horizontal anchors, and bounded coordinates.
 */
export function layoutShipWall(
  items: readonly ShipWallInput[],
  measure: number,
  step: number,
  flip: boolean,
  staggerSpread = .72,
): ShipWallNode[] {
  if (!items.length) return []
  const nodes: ShipWallNode[] = []
  let cursorY = 0
  const maxHalf = measure * .47
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (i > 0) {
      const prev = items[i - 1]
      const minClear = (prev.size * .58 + item.size * .58) * 1.12
      cursorY -= Math.max(step * .92, minClear)
    }
    const baseLane = WALL_STAGGER[i % WALL_STAGGER.length] * (flip ? -1 : 1)
    const rawX = baseLane * measure * staggerSpread
    const limit = Math.max(0, maxHalf - item.width * .56)
    let x = clamp(rawX, -limit, limit)
    if (i > 0 && limit > step * .35 && Math.abs(x - nodes[i - 1].x) < step * .32) {
      const nudge = nodes[i - 1].x >= 0 ? -limit * staggerSpread : limit * staggerSpread
      x = clamp(nudge, -limit, limit)
    }
    nodes.push({ ...item, x, y: cursorY })
  }
  return nodes
}

/**
 * Evaluate the continuous upward wall rail over revealed words using
 * velocity-matched channel segments so rapid cues never snap or reverse.
 */
export function evalShipRail(
  nodes: readonly ShipWallNode[],
  timeMs: number,
  speed: number,
  quiet: boolean,
  anchorY: number,
): number {
  if (!nodes.length) return anchorY
  let active = 0
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].revealMs <= timeMs) active = i
    else break
  }
  const targetFor = (idx: number) => {
    const focusRatio = idx === 0 ? .12 : idx === 1 ? -.34 : -.52
    const baseShift = nodes[idx].size * focusRatio
    return anchorY - nodes[idx].y + baseShift
  }
  if (quiet) return targetFor(active)
  const segments: ChannelSegment[] = []
  for (let i = 1; i <= active; i++) {
    const prevT = nodes[i - 1].revealMs
    const startMs = nodes[i].revealMs
    const gap = Math.max(60, startMs - prevT)
    const durationMs = clamp(Math.min(340 / speed, gap * .85), 140 / speed, 360 / speed)
    segments.push({ startMs, durationMs, target: targetFor(i), ease: 'smooth' })
  }
  return evalChannel(targetFor(0), segments, timeMs).value
}

export interface ShipFocus { x: number; y: number }

/** Aim toward a word, with a bounded pan that finishes before another onset. */
export function shipPan(from: ShipFocus, to: ShipFocus, time: number, start: number, next: number, speed: number): ShipFocus {
  const duration = Math.max(1, Math.min(202 / speed, next - start))
  const phase = smooth((time - start) / duration)
  return { x: mix(from.x, to.x, phase), y: mix(from.y, to.y, phase) }
}

export type LensField = readonly [radiusX: number, radiusY: number, strength: number, originX: number, originY: number]

export function neighboring(cues: readonly Cue[], cue: Cue, center: number, offset: number): { cue: Cue; token: Token } | undefined {
  let c = cue, i = center + offset
  while (i < 0) {
    const prev = cues[c.index - 1]
    if (!prev || c.startMs - prev.endMs > 760) return
    c = prev
    i += c.tokens.length
  }
  while (i >= c.tokens.length) {
    const next = cues[c.index + 1]
    if (!next || next.startMs - c.endMs > 760) return
    i -= c.tokens.length
    c = next
  }
  return { cue: c, token: c.tokens[i] }
}

// Bounded equisolid-like radial compression. The radial derivative stays
// positive (>= 1 - EDGE), so even the strongest profile cannot fold glyphs.
const EDGE = .76
const CORE = 1.12
const CURVATURE = 1.35
const number = (n: number) => n.toFixed(2)
const num3 = (n: number) => n.toFixed(3)
export const lensScaleGLSL = `1. + uLens.z * (${number(CORE)} * inversesqrt(1. + ${number(CURVATURE)} * dot(p,p)) - ${number(EDGE)})`

export function lensPoint(field: LensField, x: number, y: number): readonly [number, number] {
  const [rx, ry, strength, ox, oy] = field
  const px = (x - ox) / Math.max(1, rx), py = (y - oy) / Math.max(1, ry)
  const k = 1 + strength * (CORE / Math.sqrt(1 + CURVATURE * (px * px + py * py)) - EDGE)
  return [ox + (x - ox) * k, oy + (y - oy) * k]
}

// Bounded cylindrical projection giving stronger vertical compression and subtle baseline curvature off-center.
const CYL_K = .74
const CYL_L = .44
const CYL_A = .24
const CYL_B = .016

export const cylindricalLensGLSL = `
  vec2 cp = (world.xy - uLensOrigin) / max(uLens.xy, vec2(1.));
  float cv = clamp(cp.y, -1.28, 1.28);
  float cvExt = (cp.y - cv) * .32;
  float cu2 = (cp.x * cp.x) / (1. + .22 * cp.x * cp.x);
  float cDen = 1. + ${num3(CYL_L)} * (1. - cos(${num3(CYL_K)} * cv));
  float cSv = max(.34, 1. - ${num3(CYL_A)} * cv * cv);
  vec2 cw = vec2(
    cp.x * cSv / cDen,
    sin(${num3(CYL_K)} * cv) / (${num3(CYL_K)} * cDen) + ${num3(CYL_B)} * cu2 * cv + cvExt
  );
  world.xy = uLensOrigin + mix(cp, cw, uLens.z) * uLens.xy;
`

export function cylindricalLensPoint(field: LensField, x: number, y: number): readonly [number, number] {
  const [rx, ry, strength, ox, oy] = field
  if (strength <= 0) return [x, y]
  const sx = Math.max(1, rx), sy = Math.max(1, ry)
  const u = (x - ox) / sx
  const v = (y - oy) / sy
  const cv = clamp(v, -1.28, 1.28)
  const cvExt = (v - cv) * .32
  const cu2 = (u * u) / (1 + .22 * u * u)
  const denom = 1 + CYL_L * (1 - Math.cos(CYL_K * cv))
  const sv = Math.max(.34, 1 - CYL_A * cv * cv)
  const wx = (u * sv) / denom
  const wy = Math.sin(CYL_K * cv) / (CYL_K * denom) + CYL_B * cu2 * cv + cvExt
  return [ox + mix(u, wx, strength) * sx, oy + mix(v, wy, strength) * sy]
}

function rollTo(time: number, onset: number, before: number, after: number, speed: number) {
  const lead = Math.min(62 / speed, (onset - before) * .43)
  const tail = Math.min(122 / speed, (after > onset ? after - onset : Infinity) * .53)
  return time < onset
    ? .58 * smooth((time - onset + lead) / lead)
    : .58 + .42 * smooth((time - onset) / tail)
}

/** Center of the optical rail, relative to the supplied current slot. */
export function lensRail(time: number, current: number, previous: number | undefined, next: number | undefined, following: number | undefined, speed: number) {
  if (next !== undefined && next > current) {
    const forward = rollTo(time, next, current, following ?? Infinity, speed)
    if (forward > 0) return forward
  }
  if (previous !== undefined && previous < current) return rollTo(time, current, previous, next ?? Infinity, speed) - 1
  return 0
}
