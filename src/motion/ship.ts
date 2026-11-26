import { Frame } from './frame'
import {
  evalShipRail,
  layoutShipWall,
  shipPan,
  shipWords,
  type ShipWallInput,
  type ShipWallNode,
} from './heroGeometry'
import type { Row, TextAtlas } from './text'
import { clamp, cueWindow, hash, mix, settle, smooth, tokenIndex, type Cue, type Token } from './timeline'

interface WallPlan {
  measure: number
  baseSize: number
  step: number
  nodes: ShipWallNode[]
  cueIndexStart: number
  cueByIndex: Map<number, Cue>
}

interface ShapedPlan {
  measure: number
  size: number
  step: number
  rows: Row[]
  rowsPerPage: number
}

const wallCache = new WeakMap<TextAtlas, WeakMap<Cue, Map<string, WallPlan>>>()
const shapedCache = new WeakMap<TextAtlas, WeakMap<Cue, { key: string; plan: ShapedPlan }>>()

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'so', 'that', 'the', 'to', 'up', 'was', 'we', 'with',
])

function isWallEligible(cue: Cue): boolean {
  return cue.timed && !cue.rtl && !cue.mixed && cue.text.length <= 420
}

function contiguousWallCues(cues: readonly Cue[], cueIndex: number, timeMs: number): Cue[] {
  const windowed = cueWindow(cues, cueIndex, timeMs, 3, 4500)
  const out: Cue[] = []
  for (let i = windowed.length - 1; i >= 0; i--) {
    const c = windowed[i]
    if (!isWallEligible(c)) break
    if (out.length > 0) {
      const next = out[0]
      if (next.startMs - c.endMs > 1600) break
    }
    out.unshift(c)
  }
  return out
}

function stripPunctuation(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
}

/** Pick 0–1 sparse persistent accent word per phrase (or 2 on long 10+ word phrases), never the isolated lead word. */
function selectAccents(words: readonly { text: string; display: boolean }[], cueText: string): Set<number> {
  const chosen = new Set<number>()
  if (words.length < 3) return chosen
  const candidates: { idx: number; score: number }[] = []
  for (let i = 1; i < words.length; i++) {
    const clean = stripPunctuation(words[i].text)
    if (!clean) continue
    const stopPenalty = STOP_WORDS.has(clean) ? -3 : 0
    const leadPenalty = i === 1 && words.length >= 4 ? -1.2 : 0
    const tailBonus = i >= 2 && i <= words.length - 1 ? 1.4 : 0
    const lenScore = clamp(clean.length / 4, 0.4, 2.2)
    const tie = ((hash(cueText) ^ (i * 2654435761)) >>> 0) % 100 / 400
    candidates.push({ idx: i, score: lenScore + stopPenalty + leadPenalty + tailBonus + tie })
  }
  candidates.sort((a, b) => b.score - a.score)
  if (!candidates.length) return chosen
  chosen.add(candidates[0].idx)
  if (words.length >= 9 && candidates.length > 1) {
    const second = candidates.find(c => Math.abs(c.idx - candidates[0].idx) >= 3)
    if (second) chosen.add(second.idx)
  }
  return chosen
}

function assignRevealTimes(cue: Cue, words: readonly { token?: Token }[]): number[] {
  const times = new Array<number>(words.length)
  for (let i = 0; i < words.length; i++) {
    if (words[i].token) times[i] = words[i].token!.startMs
  }
  // Interpolate reveal timestamps strictly between neighboring timed words so untimed affixes never leak early.
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

function wallPlanFor(f: Frame, cues: readonly Cue[]): WallPlan {
  let byAtlas = wallCache.get(f.atlas)
  if (!byAtlas) wallCache.set(f.atlas, byAtlas = new WeakMap())
  const anchorCue = cues[cues.length - 1]
  let byAnchor = byAtlas.get(anchorCue)
  if (!byAnchor) byAtlas.set(anchorCue, byAnchor = new Map())

  const cueSig = cues.map(c => c.id).join(',')
  const key = `${cueSig}|${f.w}/${f.h}/${f.scale}/${f.overlay}/${f.heavy.css}/${f.heavy.weight}/${f.medium.weight}/${f.atlas.revision}`
  const existing = byAnchor.get(key)
  if (existing) return existing

  const measure = f.lane * (f.overlay ? .90 : .84)
  const baseSize = Math.min(f.em(64), f.h * .110)
  const step = baseSize * 1.08
  const items: ShipWallInput[] = []

  for (const cue of cues) {
    const words = shipWords(cue)
    const reveals = assignRevealTimes(cue, words)
    const heavyWidths = words.map(w => f.atlas.width(w.text, baseSize, f.heavy))
    const maxWidth = Math.max(1, ...heavyWidths)
    const maxWordIdx = heavyWidths.indexOf(maxWidth)

    const prelim = words.map((w, i) => {
      const clean = stripPunctuation(w.text)
      const isLead = i === 0
      const isStop = STOP_WORDS.has(clean)
      const display = isLead || (i === maxWordIdx && words.length > 2) || (!isStop && clean.length >= 6)
      return { text: w.text, display }
    })
    const accents = selectAccents(prelim, cue.text)

    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      const accented = accents.has(i)
      const isLead = i === 0
      const clean = stripPunctuation(w.text)
      const isStop = STOP_WORDS.has(clean)
      const display = prelim[i].display || accented
      const face = display ? f.heavy : f.medium
      const nominal = baseSize * (isLead ? 1.07 : accented ? .94 : display ? .98 : isStop ? .78 : .86)
      const fitted = f.fit(w.text, nominal, face, measure * .86)
      items.push({
        id: w.token?.id ?? `${cue.id}:w${i}`,
        cueIndex: cue.index,
        wordIndex: i,
        text: w.text,
        token: w.token,
        revealMs: reveals[i],
        width: f.atlas.width(w.text, fitted, face),
        size: fitted,
        display,
        accented,
      })
    }
  }

  const flip = !!(hash(cues[0].text) & 1)
  const nodes = layoutShipWall(items, measure, step, flip)
  const plan: WallPlan = { measure, baseSize, step, nodes, cueIndexStart: cues[0].index,
    cueByIndex:new Map(cues.map(c => [c.index,c])) }
  if (byAnchor.size > 16) byAnchor.clear()
  byAnchor.set(key, plan)
  return plan
}

function shapedPlanFor(f: Frame, cue: Cue): ShapedPlan {
  let plans = shapedCache.get(f.atlas)
  if (!plans) shapedCache.set(f.atlas, plans = new WeakMap())
  const key = `${f.w}/${f.h}/${f.scale}/${f.overlay}/${f.heavy.css}/${f.heavy.weight}/${f.atlas.revision}`
  const existing = plans.get(cue)
  if (existing?.key === key) return existing.plan

  const measure = f.lane * .86
  const size = Math.min(f.em(60), f.h * .108)
  const step = size * 1.12
  const rowsPerPage = clamp(Math.floor(f.h * (f.overlay ? .70 : .52) / step), 2, 4)
  const plan: ShapedPlan = { measure, size, step, rows: f.rows(cue, size, measure, f.heavy), rowsPerPage }
  plans.set(cue, { key, plan })
  return plan
}

function paintShaped(f: Frame) {
  const { cue, p } = f
  const plan = shapedPlanFor(f, cue)
  const token = f.token ?? cue.tokens[f.ti]
  const index = Math.max(0, plan.rows.findIndex(row => row.to > token.from))
  const page = Math.floor(index / plan.rowsPerPage)
  const motion = f.quiet ? 0 : Math.min(f.motion, 1.15)
  const clip = [f.y - f.h * .40, f.y + f.h * .36] as const

  const firstRow = plan.rows[page * plan.rowsPerPage]
  const firstTok = firstRow ? cue.tokens.find(t => t.to > firstRow.from) : undefined
  const start = page > 0 ? (firstTok?.startMs ?? token.startMs) : cue.startMs
  const phase = settle(f.advance(235, start))

  p.root.rotation.set(motion * .030, motion * Math.cos(f.time * .00064) * .024, motion * .014)
  p.root.position.set(motion * Math.sin(f.time * .00086) * 6 * f.unit, 0, motion * -4 * f.unit)

  const rows = plan.rows.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage)
  const maxWidth = Math.max(1, ...rows.map(row => row.width))
  const enter = (1 - phase) * motion
  rows.forEach((row, i) => {
    const run = f.atlas.get(row.text, plan.size, f.heavy, f.dpr, f.overlay)
    const left = -.5 * maxWidth + (maxWidth - row.width) * (cue.rtl ? .78 : .18)
    const yy = f.y - enter * 28 * f.unit + (rows.length / 2 - .5 - i) * plan.step
    f.row(cue, row, run, enter * 16 * f.unit + left + row.width / 2, yy, f.foreground, f.active, {
      z: -enter * 24 * f.unit,
      clip,
      opacity: 1 - .22 * enter,
    }, f.heavy, plan.size)
  })
}

export function ship(f: Frame) {
  const { cue, p } = f
  if (!isWallEligible(cue)) {
    paintShaped(f)
    return
  }

  const cues = contiguousWallCues(f.cues, cue.index, f.time)
  const plan = wallPlanFor(f, cues)
  const { nodes } = plan
  if (!nodes.length) return

  let activeIdx = 0
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].revealMs <= f.time) activeIdx = i
    else break
  }

  const motion = f.quiet ? 0 : Math.min(f.motion, 1.15)
  const anchorY = f.y - plan.baseSize * .24
  const railY = evalShipRail(nodes, f.time, f.speed, f.quiet, anchorY)

  // Gentle pan tracks the active node without jarring leaps.
  const activeNode = nodes[activeIdx]
  const prevNode = activeIdx > 0 ? nodes[activeIdx - 1] : undefined
  const nextReveal = nodes[activeIdx + 1]?.revealMs ?? cue.endMs
  const aimScale = (node?: ShipWallNode) => ({
    x: clamp((node?.x ?? 0) * .12, -24 * f.unit, 24 * f.unit),
    y: 0,
  })
  const aim = f.quiet
    ? { x: 0, y: 0 }
    : shipPan(aimScale(prevNode), aimScale(activeNode), f.time, activeNode.revealMs, nextReveal, f.speed)

  const idle = Math.sin(f.time * .00086)
  p.root.rotation.set(
    motion * (.028 + idle * .011),
    motion * (Math.cos(f.time * .00062) * .026 - aim.x / f.w * 1.1),
    motion * .022,
  )
  p.root.position.set(
    motion * (-aim.x + idle * 6 * f.unit),
    0,
    motion * (idle * 8 * f.unit - 5 * f.unit),
  )

  const clip = [f.y - f.h * .42, f.y + f.h * .38] as const
  const maxVisible = 7
  const firstIdx = Math.max(0, activeIdx - (maxVisible - 1))

  const { cueByIndex } = plan

  for (let i = firstIdx; i <= activeIdx; i++) {
    const node = nodes[i]
    const ageIdx = activeIdx - i
    const arrive = f.quiet ? 1 : settle(f.advance(145, node.revealMs))

    // Late focus prominence growth (~37%) on lead/important words once arrived, holding cleanly after.
    const nextMs = nodes[i + 1]?.revealMs ?? (cueByIndex.get(node.cueIndex)?.endMs ?? node.revealMs + 400)
    const dwellMs = Math.max(120, nextMs - node.revealMs)
    const canGrow = node.wordIndex === 0 || (node.display && !node.accented && dwellMs >= 260)
    let growth = 0
    if (canGrow) {
      if (f.quiet) {
        growth = 1
      } else {
        const delayMs = Math.min(dwellMs * .32, 160) / f.speed
        const growDurMs = Math.max(140, Math.min(320, dwellMs * .85)) / f.speed
        growth = smooth((f.time - node.revealMs - delayMs) / growDurMs)
      }
    }
    const drawScale = canGrow
      ? mix(.78, 1.07, growth)
      : ageIdx === 0 && !f.quiet
        ? mix(.86, 1.0, arrive)
        : 1

    // Subtle lateral settle toward center as words climb into the wall.
    const lateralPull = ageIdx === 0 ? 1 : mix(1, .84, clamp(ageIdx / 4))
    const px = node.x * lateralPull
    const py = railY + node.y + (ageIdx === 0 && !f.quiet ? -node.size * .14 * (1 - arrive) : 0)
    const depth = (ageIdx === 0 ? 10 * f.unit * arrive : -ageIdx * 5 * f.unit)

    // Visibility and luminance staging: crisp arrival -> recent readable -> soft atmospheric clip exit.
    let cueFade = 1
    if (node.cueIndex < cue.index) {
      const owner = cueByIndex.get(node.cueIndex)
      if (owner) {
        const overMs = Math.max(0, f.time - owner.endMs)
        cueFade = clamp(1 - smooth((overMs - 550) / 950), 0, 1)
      }
    }
    const entryAlpha = mix(node.wordIndex === 0 ? .88 : .58, 1, arrive)
    const ageOpacity = ageIdx === 0
      ? entryAlpha
      : ageIdx <= 2
        ? mix(.94, .82, ageIdx - 1)
        : ageIdx <= 4
          ? mix(.74, .56, ageIdx - 3)
          : mix(.44, .18, ageIdx - 5)
    const topClear = clip[1] - (py + node.size * .42 * drawScale)
    const botClear = (py - node.size * .42 * drawScale) - clip[0]
    const clipFade = smooth(topClear / (node.size * .90)) * smooth(botClear / (node.size * .60))
    const wordOpacity = clamp(ageOpacity * cueFade * clipFade)
    if (wordOpacity <= .01) continue

    const face = node.display ? f.heavy : f.medium
    const run = f.atlas.get(node.text, node.size, face, f.dpr, f.overlay)

    if (node.accented) {
      const padX = node.size * .19 * drawScale
      const padY = node.size * .18 * drawScale
      const cardW = (Math.max(run.ink.width, run.advance) * drawScale) + padX
      const cardH = Math.max(run.ink.height * drawScale + padY, node.size * .78 * drawScale)
      f.p.card(px + run.ink.x * drawScale, py + run.ink.y * drawScale, cardW, cardH, f.backing, {
        z: depth,
        clip,
        opacity: wordOpacity,
        radius: node.size * .06 * drawScale,
        accent: f.active,
        sheen: .08,
        border: .85,
      })
    }

    const inkColor = node.accented
      ? f.onBacking
      : ageIdx === 0
        ? f.active
        : ageIdx <= 2
          ? f.foreground
          : f.muted

    f.p.glyph(run, px, py, inkColor, {
      z: depth,
      scale: drawScale,
      clip,
      opacity: wordOpacity,
    })
  }
}

export { tokenIndex }
