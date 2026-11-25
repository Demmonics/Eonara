import { Frame, lift, lookupIcon } from './frame'
import {
  assignWordReveals,
  contiguousCueRun,
  evalShipRail,
  layoutShipWall,
  shipWords,
  type ShipWallInput,
  type ShipWallNode,
} from './heroGeometry'
import { mono, type Row, type TextAtlas } from './text'
import { clamp, cueWindow, hash, mix, safePieces, settle, smooth, type Cue } from './timeline'

function symbol(text: string) {
  return lookupIcon(text) ? text : text.split(/\s+/u).find(t => lookupIcon(t))
}

interface VisualNode extends ShipWallNode {
  sign?: string
  iconSize: number
  isStop: boolean
}

interface VisualPlan {
  measure: number
  baseSize: number
  step: number
  nodes: VisualNode[]
  cueIndexStart: number
}

const VISUAL_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'so', 'that', 'the', 'to', 'up', 'was', 'we', 'with',
])

const visualWallCache = new WeakMap<TextAtlas, WeakMap<Cue, Map<string, VisualPlan>>>()

function isVisualWallEligible(cue: Cue): boolean {
  return cue.timed && !cue.rtl && !cue.mixed && cue.text.length <= 420
}

function stripPunct(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
}

function visualPlanFor(f: Frame, cues: readonly Cue[]): VisualPlan {
  let byAtlas = visualWallCache.get(f.atlas)
  if (!byAtlas) visualWallCache.set(f.atlas, byAtlas = new WeakMap())
  const anchorCue = cues[cues.length - 1]
  let byAnchor = byAtlas.get(anchorCue)
  if (!byAnchor) byAtlas.set(anchorCue, byAnchor = new Map())

  const cueSig = cues.map(c => c.id).join(',')
  const key = `${cueSig}|${f.w}/${f.h}/${f.scale}/${f.overlay}/${f.heavy.css}/${f.heavy.weight}/${f.medium.weight}/${f.regular.weight}/${f.atlas.revision}`
  const existing = byAnchor.get(key)
  if (existing) return existing

  const measure = f.lane * (f.overlay ? .78 : .74)
  const baseSize = Math.min(f.em(52), f.h * .092)
  const step = baseSize * 1.14
  const items: (ShipWallInput & { sign?: string; iconSize: number; isStop: boolean })[] = []

  for (const cue of cues) {
    const words = shipWords(cue)
    const reveals = assignWordReveals(cue, words)
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      const sign = symbol(w.text)
      const clean = stripPunct(w.text)
      const isStop = VISUAL_STOP_WORDS.has(clean)
      const isLead = i === 0
      const display = !isStop && (isLead || !!sign || clean.length >= 6)
      const face = display ? f.heavy : isStop ? f.regular : f.medium
      const nominal = baseSize * (isLead ? 1.05 : sign ? 1.02 : isStop ? .82 : .90)
      const iconReserve = sign ? nominal * .78 : 0
      const fitted = f.fit(w.text, nominal, face, Math.max(40, measure * .84 - iconReserve * 1.35))
      const textWidth = f.atlas.width(w.text, fitted, face)
      const iconSize = sign ? clamp(fitted * .58, 13 * f.unit, 40 * f.unit) : 0
      items.push({
        id: w.token?.id ?? `${cue.id}:v${i}`,
        cueIndex: cue.index,
        wordIndex: i,
        text: w.text,
        token: w.token,
        revealMs: reveals[i],
        width: textWidth + (sign ? iconSize * 1.35 : 0),
        size: fitted,
        display,
        accented: false,
        sign,
        iconSize,
        isStop,
      })
    }
  }

  const flip = !!(hash(cues[0].text) & 1)
  const laid = layoutShipWall(items, measure, step, flip, .40)
  const nodes: VisualNode[] = laid.map((node, idx) => ({
    ...node,
    sign: items[idx].sign,
    iconSize: items[idx].iconSize,
    isStop: items[idx].isStop,
  }))
  const plan: VisualPlan = { measure, baseSize, step, nodes, cueIndexStart: cues[0].index }
  if (byAnchor.size > 16) byAnchor.clear()
  byAnchor.set(key, plan)
  return plan
}

function paintVisualShaped(f: Frame) {
  const { cue, p } = f
  const measure = f.lane * .76
  const size = Math.min(f.em(46), f.h * .088)
  const step = size * 1.18
  const rows = f.page(cue, f.rows(cue, size, measure, f.medium), 3)
  const clip = [f.y - f.h * .36, f.y + f.h * .38] as const
  const settleY = lift(f, 160, 12 * f.unit)
  const sign = symbol(cue.text)
  const iconSize = sign ? Math.min(size * .72, 42 * f.unit) : 0
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)
  if (sign && !f.overlay && !f.low) {
    f.icon(sign, 0, f.y, size * 2.2, f.backing, Math.max(.2, settle(f.advance(160))), .08)
  }
  rows.forEach((row, i) => {
    const run = f.atlas.get(row.text, size, f.medium, f.dpr, f.overlay)
    const py = f.y + (rows.length / 2 - .5 - i) * step - settleY
    const xOffset = sign && i === 0 ? iconSize * .55 : 0
    f.row(cue, row, run, xOffset, py, f.foreground, f.active, { clip }, f.medium, size)
    if (sign && i === 0) {
      f.icon(sign, xOffset - run.advance * .5 - iconSize * .76, py, iconSize, f.backing, Math.max(.2, settle(f.advance(140))), .92)
    }
  })
}

export function visual(f: Frame) {
  const { cue, p } = f
  if (!isVisualWallEligible(cue)) {
    paintVisualShaped(f)
    return
  }

  const cues = contiguousCueRun(f.cues, cue.index, f.time, isVisualWallEligible, 3, 5200, 1600)
  const plan = visualPlanFor(f, cues)
  const { nodes } = plan
  if (!nodes.length) return

  let activeIdx = 0
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].revealMs <= f.time) activeIdx = i
    else break
  }

  // Calm near-flat editorial plane
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, f.quiet ? 0 : Math.sin(f.time * .00068) * 2.5 * f.unit * Math.min(f.motion, 1), 0)

  const anchorY = f.y - plan.baseSize * .20
  const railY = evalShipRail(nodes, f.time, f.speed, f.quiet, anchorY)
  const clip = [f.y - f.h * .36, f.y + f.h * .38] as const
  const maxVisible = 6
  const firstIdx = Math.max(0, activeIdx - (maxVisible - 1))

  const cueByIndex = new Map<number, Cue>()
  for (const c of cues) cueByIndex.set(c.index, c)

  const echoHistory = cueWindow(f.cues, cue.index, f.time, 5, 14_000)
  const seenTokens = new Map<string, number>()
  for (const c of echoHistory) {
    for (const tok of c.tokens) {
      if (tok.startMs > f.time) break
      const s = symbol(tok.text)
      if (!s) continue
      const norm = stripPunct(s)
      seenTokens.set(norm, (seenTokens.get(norm) ?? 0) + 1)
    }
  }

  const drawItems: {
    node: VisualNode
    ageIdx: number
    arrive: number
    drawScale: number
    px: number
    py: number
    wordOpacity: number
  }[] = []

  let echoCandidate: typeof drawItems[number] | undefined

  for (let i = firstIdx; i <= activeIdx; i++) {
    const node = nodes[i]
    const ageIdx = activeIdx - i
    const arrive = f.quiet ? 1 : settle(f.advance(135, node.revealMs))
    const drawScale = ageIdx === 0
      ? (f.quiet ? 1.02 : mix(.92, 1.03, arrive))
      : ageIdx <= 2
        ? mix(.98, .94, ageIdx - 1)
        : clamp(mix(.92, .86, (ageIdx - 3) / 2))

    const px = node.x * (ageIdx === 0 ? 1 : mix(1, .86, clamp(ageIdx / 4)))
    const py = railY + node.y + (ageIdx === 0 && !f.quiet ? -node.size * .10 * (1 - arrive) : 0)

    let cueFade = 1
    if (node.cueIndex < cue.index) {
      const owner = cueByIndex.get(node.cueIndex)
      if (owner) {
        const overMs = Math.max(0, f.time - owner.endMs)
        cueFade = clamp(1 - smooth((overMs - 900) / 1400), .20, 1)
      }
    }
    const entryAlpha = mix(node.wordIndex === 0 ? .88 : .56, 1, arrive)
    const ageOpacity = ageIdx === 0
      ? entryAlpha
      : ageIdx <= 2
        ? mix(.84, .64, ageIdx - 1)
        : clamp(mix(.46, .18, (ageIdx - 3) / 2))
    const topClear = clip[1] - (py + node.size * .42 * drawScale)
    const botClear = (py - node.size * .42 * drawScale) - clip[0]
    const clipFade = smooth(topClear / (node.size * .85)) * smooth(botClear / (node.size * .55))
    const wordOpacity = clamp(ageOpacity * cueFade * clipFade)
    if (wordOpacity <= .01) continue

    const item = { node, ageIdx, arrive, drawScale, px, py, wordOpacity }
    drawItems.push(item)

    if (!f.overlay && !f.low && node.sign && ageIdx <= 2) {
      const repeatCount = seenTokens.get(stripPunct(node.sign)) ?? 0
      if (ageIdx === 0 || repeatCount >= 2) {
        echoCandidate = item
      }
    }
  }

  if (echoCandidate?.node.sign) {
    const echoSize = echoCandidate.node.size * 2.45
    const echoOp = echoCandidate.wordOpacity * (echoCandidate.ageIdx === 0 ? .11 : .065)
    const echoColor = f.backing
    const shape = lookupIcon(echoCandidate.node.sign)
    if (shape && echoOp > .005) {
      const strokeW = Math.max(1.4, echoSize * .045)
      const echoFrac = echoCandidate.ageIdx === 0 ? Math.max(.22, echoCandidate.arrive) : 1
      for (const path of shape) {
        const pts = path.map(([a, b]): readonly [number, number] => [
          echoCandidate!.px + a * echoSize,
          echoCandidate!.py + b * echoSize,
        ])
        p.path(pts, echoColor, strokeW, { opacity: echoOp, clip }, echoFrac)
      }
    }
  }

  for (const item of drawItems) {
    const { node, ageIdx, arrive, drawScale, px, py, wordOpacity } = item
    const face = node.display ? f.heavy : node.isStop ? f.regular : f.medium
    const run = f.atlas.get(node.text, node.size, face, f.dpr, f.overlay)
    const iconSize = node.sign ? node.iconSize * drawScale : 0
    const wordX = node.sign ? px + iconSize * .42 : px
    const inkColor = ageIdx === 0
      ? f.active
      : ageIdx <= 2
        ? f.foreground
        : f.muted

    p.glyph(run, wordX, py, inkColor, {
      scale: drawScale,
      clip,
      opacity: wordOpacity,
    })

    if (node.sign) {
      const shape = lookupIcon(node.sign)
      if (shape) {
        const iconX = wordX - run.advance * .5 * drawScale - iconSize * .74
        const iconY = py + run.ink.y * drawScale - (ageIdx === 0 && !f.quiet ? (1 - arrive) * iconSize * .18 * f.motion : 0)
        const iconOpacity = wordOpacity * (ageIdx === 0 ? .95 : ageIdx <= 2 ? .68 : .42)
        const iconColor = ageIdx === 0 ? f.backing : ageIdx <= 2 ? f.foreground : f.muted
        const strokeW = Math.max(1, iconSize * .072)
        const frac = ageIdx === 0 ? Math.max(.18, arrive) : 1
        for (const path of shape) {
          const pts = path.map(([a, b]): readonly [number, number] => [iconX + a * iconSize, iconY + b * iconSize])
          p.path(pts, iconColor, strokeW, { opacity: iconOpacity, clip }, frac)
        }
      }
    }
  }
}

interface CodeRowEntry {
  cue: Cue
  row: Row
  startMs: number
  sign?: string
}

export function code(f: Frame, annotated = false) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const size = Math.min(f.em(34), f.h * .096)
  const lineH = size * 1.44
  const iconReserve = annotated ? size * 1.15 : 0
  const maxWidth = Math.min(f.lane * .78, 520 * f.unit) - iconReserve
  const cues = contiguousCueRun(f.cues, f.cue.index, f.time, () => true, 4, 8000, 2800)

  const entries: CodeRowEntry[] = []
  for (const c of cues) {
    const rows = f.rows(c, size, maxWidth, mono, 'codestyle')
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const firstTok = c.timed ? c.tokens.find(t => t.to > r.from && t.from < r.to) : undefined
      const startMs = !c.timed
        ? c.startMs
        : (firstTok?.startMs ?? (i === 0 ? c.startMs : mix(c.startMs, c.endMs, i / rows.length)))
      entries.push({
        cue: c,
        row: r,
        startMs,
        sign: annotated ? symbol(r.text) : undefined,
      })
    }
  }
  if (!entries.length) return

  let activeIdx = entries.length - 1
  if (f.cue.timed) {
    const targetFrom = (f.token ?? f.cue.tokens[f.ti]).from
    const found = entries.findIndex(e => e.cue === f.cue && e.row.to > targetFrom)
    if (found >= 0) {
      activeIdx = found
    } else {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].cue === f.cue || entries[i].startMs <= f.time) activeIdx = i
      }
    }
  }

  const activeEntry = entries[activeIdx]
  const activeArrive = f.quiet ? 1 : settle(f.advance(165, activeEntry.startMs))
  const slide = (1 - activeArrive) * lineH * .52 * f.motion
  const clip = [f.y - lineH * 2.2, f.y + lineH * 2.75] as const
  const baseLineY = f.y - lineH * .52
  const firstIdx = Math.max(0, activeIdx - 2)

  for (let i = firstIdx; i <= activeIdx; i++) {
    const entry = entries[i]
    const age = activeIdx - i
    const isHistory = age > 0 && (entry.cue !== f.cue || f.cue.timed)
    const py = baseLineY + age * lineH - slide
    const row = entry.row
    const c = entry.cue
    const run = f.atlas.get(row.text, size, mono, f.dpr, f.overlay)
    const pad = run.padding ?? 4
    const iconSize = entry.sign ? Math.min(size * .86, 30 * f.unit) : 0
    const textCx = entry.sign ? iconSize * .56 : 0

    if (isHistory) {
      // Progressive blurred predecessor tiers (age 1 = mild, age 2 = softer)
      const histOpacity = age === 1 ? .54 : .26
      const softness = f.low ? 0 : (age === 1 ? .36 : .76)
      p.glyph(run, textCx, py, age === 1 ? f.foreground : f.muted, {
        clip,
        opacity: histOpacity,
        softness,
      })
      if (entry.sign) {
        const iconX = textCx - run.advance * .5 - iconSize * .74
        f.icon(entry.sign, iconX, py + run.ink.y, iconSize, f.backing, 1, histOpacity * .9)
      }
      continue
    }

    // Active typing fragment: zero future ink leak + red block caret <= 0.25 em past visible glyph
    let reveal: number | undefined
    let revealedW = run.advance
    const showCaret = i === activeIdx
    let typingDone = true

    if (c.timed && !c.rtl && !c.mixed) {
      const tok = f.token
      if (!tok) {
        if (f.time < c.tokens[0].startMs) {
          revealedW = 0
          reveal = 0
          typingDone = false
        } else {
          const spoken = c.tokens.filter(t => t.endMs <= f.time)
          const lastEnd = spoken.at(-1)?.to ?? 0
          const relEnd = clamp(lastEnd - row.from, 0, row.text.length)
          if (relEnd < row.text.length) {
            const prefix = row.text.slice(0, relEnd)
            revealedW = prefix ? f.atlas.width(prefix, size, mono) : 0
            reveal = revealedW > 0 ? clamp((pad + revealedW + .6) / run.width, 0, 1) : 0
          }
        }
      } else {
        if (tok.to <= row.from) {
          revealedW = 0
          reveal = 0
          typingDone = false
        } else if (tok.from < row.to) {
          const prefixChars = clamp(tok.from - row.from, 0, row.text.length)
          const activeChars = clamp(tok.to - row.from, prefixChars, row.text.length)
          const activePart = row.text.slice(prefixChars, activeChars)
          const pieces = safePieces(activePart)
          const tokenSpan = Math.max(80, tok.endMs - tok.startMs)
          const typeDur = Math.min(tokenSpan, Math.max(90, pieces.length * 42) / f.speed)
          const progress = f.quiet ? 1 : settle(clamp((f.time - tok.startMs) / Math.max(1, typeDur)))
          typingDone = progress >= .995
          const shownCount = f.quiet
            ? pieces.length
            : Math.max(1, Math.min(pieces.length, Math.ceil(Math.max(.02, progress) * pieces.length)))
          const typedSlice = row.text.slice(0, prefixChars) + pieces.slice(0, shownCount).join('')
          revealedW = typedSlice ? f.atlas.width(typedSlice, size, mono) : 0
          reveal = revealedW > 0 ? clamp((pad + revealedW + .6) / run.width, 0, 1) : 0
        }
      }
    }

    if (reveal === undefined || reveal > .001) {
      p.glyph(run, textCx, py, f.active, {
        clip,
        opacity: f.quiet ? 1 : mix(.78, 1, activeArrive),
        reveal,
      })
    }

    if (entry.sign) {
      const iconX = textCx - run.advance * .5 - iconSize * .74
      const motifProg = c.timed ? Math.max(.22, settle(f.advance(125, entry.startMs))) : 1
      f.icon(entry.sign, iconX, py + run.ink.y, iconSize, f.backing, motifProg, .95)
    }

    if (showCaret) {
      const caretW = Math.max(4 * f.unit, size * .26)
      const caretH = size * .84
      const gap = size * .10
      const glyphRightX = c.rtl || c.mixed
        ? textCx - run.advance * .5 - gap - caretW * .5
        : textCx - run.advance * .5 + revealedW + gap + caretW * .5
      const blink = f.quiet || !typingDone
        ? .94
        : .54 + .40 * Math.cos((f.time - (f.token?.startMs ?? entry.startMs)) * Math.PI / 460)
      p.card(glyphRightX, py + run.ink.y * .5, caretW, caretH, '#ef4e4e', {
        clip,
        opacity: blink,
        radius: 1.5 * f.unit,
      })
    }
  }
}
