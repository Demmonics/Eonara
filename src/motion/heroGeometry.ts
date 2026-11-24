import { clamp, mix, smooth, type Cue, type Token } from './timeline'

export interface ShipWord {
  text: string
  token?: Token
  spaced: boolean
}

/** Keep punctuation and any unaligned affixes in the shaped run they touch. */
export function shipWords(cue: Cue): ShipWord[] {
  const words: ShipWord[] = []
  let end = 0
  function add(from: number, to: number, token?: Token) {
    const last = words.at(-1)
    const spaced = from > end
    const text = cue.text.slice(from, to)
    if (last && !spaced && (!last.token || !token)) {
      last.text += text
      last.token ??= token
    } else {
      words.push({ text, token, spaced })
    }
    end = to
  }
  function unaligned(to: number) {
    const from = end
    for (const match of cue.text.slice(from, to).matchAll(/\S+/gu)) {
      add(from + match.index, from + match.index + match[0].length)
    }
  }
  for (const token of cue.tokens) {
    unaligned(token.from)
    add(token.from, token.to, token)
  }
  unaligned(cue.text.length)
  return words
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
    // A nearly full row can nullify the nominal stagger. Give the most
    // open row the opposite edge if this whole page would read flush-left.
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
export const lensScaleGLSL = `1. + uLens.z * (${number(CORE)} * inversesqrt(1. + ${number(CURVATURE)} * dot(p,p)) - ${number(EDGE)})`

export function lensPoint(field: LensField, x: number, y: number): readonly [number, number] {
  const [rx, ry, strength, ox, oy] = field
  const px = (x - ox) / Math.max(1, rx), py = (y - oy) / Math.max(1, ry)
  const k = 1 + strength * (CORE / Math.sqrt(1 + CURVATURE * (px * px + py * py)) - EDGE)
  return [ox + (x - ox) * k, oy + (y - oy) * k]
}

function rollTo(time: number, onset: number, before: number, after: number, speed: number) {
  // A short optical lead moves *inactive* type only. Both halves share zero
  // slope at the junction, and adjacent transition windows cannot overlap.
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
