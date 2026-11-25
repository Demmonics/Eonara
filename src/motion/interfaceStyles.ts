import { Frame, lift } from './frame'
import { mono } from './text'
import { clamp, mix, settle, smooth, type Cue } from './timeline'
import type { GlyphPaint } from './painter'

const speakerSides = new WeakMap<readonly Cue[], readonly boolean[]>()
function speakerSide(cues: readonly Cue[], index: number): boolean {
  const cached = speakerSides.get(cues)
  if (cached) return cached[index] ?? false
  const sides: boolean[] = []
  let outgoing = false
  let turnIndex = 0
  let runLen = 0
  for (let i = 0; i < cues.length; i++) {
    if (i === 0) {
      outgoing = false
      runLen = 1
      sides.push(outgoing)
      continue
    }
    const prev = cues[i - 1]
    const curr = cues[i]
    const gap = curr.startMs - prev.endMs
    const targetRun = turnIndex === 0 ? 1 : 2
    if (gap > 1600 || runLen >= targetRun) {
      outgoing = !outgoing
      turnIndex++
      runLen = 1
    } else {
      runLen++
    }
    sides.push(outgoing)
  }
  speakerSides.set(cues,sides)
  return sides[index] ?? false
}

function rotPoint(px: number, py: number, cx: number, cy: number, angle: number): readonly [number, number] {
  if (!angle) return [px, py]
  const ca = Math.cos(angle), sa = Math.sin(angle)
  const dx = px - cx, dy = py - cy
  return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]
}

export function thread(f: Frame) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const size = Math.min(f.em(27), f.h * .080)
  const left = -f.lane * .40, right = f.lane * .44
  const padX = 16 * f.unit, padY = 11 * f.unit
  const withinGroupGap = Math.max(size * .34, 8 * f.unit)
  const betweenGroupGap = Math.max(size * .76, 19 * f.unit)
  const limit = Math.min(f.lane * .70, 450 * f.unit * Math.max(1, f.scale * .82))
  const enter = f.quiet ? 1 : settle(f.advance(235))
  const hist = Math.min(f.cue.index, 3)
  const ly = f.y - Math.min(hist * 18 * f.unit, f.h * .115)
  const clip = [f.y - f.h * .30, f.y + f.h * .34] as const

  const entries: {
    cue: Cue
    rows: ReturnType<Frame['rows']>
    width: number
    height: number
    outgoing: boolean
    x: number
    y: number
    i: number
  }[] = []

  let accum = 0
  for (let i = 0; i < Math.min(f.cue.index + 1, 5); i++) {
    const cue = f.cues[f.cue.index - i]
    const rows = f.page(cue, f.rows(cue, size, limit - 2 * padX, f.medium, 'message-thread'), i === 0 ? 3 : 2)
    const width = Math.max(66 * f.unit, ...rows.map(row => row.width + padX * 2))
    const height = rows.length * size * 1.22 + padY * 2
    const outgoing = speakerSide(f.cues, cue.index)
    if (i > 0) {
      const prevSameSide = entries[i - 1].outgoing === outgoing
      accum += prevSameSide ? withinGroupGap : betweenGroupGap
    }
    const x = outgoing ? right - width / 2 : left + width / 2
    const y = ly + accum + height / 2
    entries.push({ cue, rows, width, height, outgoing, x, y, i })
    accum += height
  }

  const nextGap = entries[1]
    ? (entries[1].outgoing === entries[0].outgoing ? withinGroupGap : betweenGroupGap)
    : betweenGroupGap
  const delta = (1 - enter) * f.motion * ((entries[0]?.height ?? 0) + nextGap)

  for (let j = entries.length - 1; j >= 0; j--) {
    const { cue, rows, width, height, outgoing, x, y, i } = entries[j]
    // Translate the complete measured stack together. Previously history moved
    // by a full new-card height while the entering card moved only half-height,
    // so tall/same-side cards intersected during their first 235 ms.
    const angle = i === 0 && !f.quiet ? (1 - enter) * f.motion * (outgoing ? -.048 : .048) : 0
    const rotationClearance = i === 0
      ? Math.max(0, (Math.abs(Math.sin(angle)) * width + (Math.cos(angle) - 1) * height) / 2)
      : 0
    const py = y - delta - rotationClearance
    const clipFade = smooth((clip[1] - (py + height * .5)) / (size * 1.55))
    const baseFade = i === 0 ? mix(.45, 1, enter) : (i === 4 ? (1 - enter) * .55 : 1)
    const fade = clamp(baseFade * clipFade)
    if (fade <= .01) continue

    const color = outgoing ? '#1d69ee' : '#262934'
    const sheen = outgoing ? '#5596ff' : '#50566b'
    const r = Math.min(height * .46, 15 * f.unit + 2)
    const hasTail = i === 0 || entries[i - 1].outgoing !== outgoing
    const bubble: GlyphPaint = { opacity: fade, clip, angle }

    // Shadow & bubble card (zero scaling jump on old cards; shadow & tail rotate cleanly around bubble center)
    const [sx, sy] = rotPoint(x, py - 4 * f.unit, x, py, angle)
    p.card(sx, sy, width + 5 * f.unit, height + 4 * f.unit, '#0b0d17', { ...bubble, opacity: fade * .22, radius: r + 2 })
    if (hasTail) {
      const [txTail, tyTail] = rotPoint(x + (outgoing ? 1 : -1) * (width * .5 - 3 * f.unit), py - height * .5 + 6 * f.unit, x, py, angle)
      p.card(txTail, tyTail, 10 * f.unit, 8.5 * f.unit, color, { ...bubble, angle: angle + (outgoing ? -.32 : .32), radius: 2 })
    }
    p.card(x, py, width, height, color, { ...bubble, accent: sheen, border: .8, radius: r, sheen: .52, fill: outgoing ? .95 : .92 })

    const activeRowSoft = i === 0 && !f.quiet && !f.low ? (1 - enter) * .60 : 0
    rows.forEach((row, rIdx) => {
      const run = f.atlas.get(row.text, size, f.medium, f.dpr)
      const pad = run.padding ?? 4
      const baseTx = cue.rtl
        ? x + (width - row.width) / 2 - padX
        : x + (row.width - width) / 2 + padX
      const baseYy = py + (rows.length / 2 - rIdx - .5) * size * 1.22 + size * .045
      const [tx, yy] = rotPoint(baseTx, baseYy, x, py, angle)

      if (i > 0 || !cue.timed || cue.rtl || cue.mixed) {
        p.glyph(run, tx, yy, '#f5f6fb', {
          opacity: fade * (i === 0 ? 1 : .92),
          clip,
          angle,
          softness: activeRowSoft,
        })
        return
      }

      // Active timed bubble: reveal spoken + active token cleanly with transient clarity and 0% bright pill boxes
      let reveal: number | undefined
      let rowOpacity = fade
      let rowSoft = activeRowSoft
      const tok = f.token
      if (!tok) {
        if (f.time < cue.tokens[0].startMs) {
          reveal = 0
        } else {
          const spoken = cue.tokens.filter(t => t.endMs <= f.time)
          const lastEnd = spoken.at(-1)?.to ?? 0
          const relEnd = clamp(lastEnd - row.from, 0, row.text.length)
          if (relEnd < row.text.length) {
            const prefix = row.text.slice(0, relEnd)
            const w = prefix ? f.atlas.width(prefix, size, f.medium) : 0
            reveal = w > 0 ? clamp((pad + w + .6) / run.width, 0, 1) : 0
          }
        }
      } else if (tok.to <= row.from) {
        reveal = 0
      } else if (tok.from < row.to) {
        const upToActive = clamp(tok.to - row.from, 0, row.text.length)
        const slice = row.text.slice(0, upToActive)
        const w = slice ? f.atlas.width(slice, size, f.medium) : 0
        reveal = w > 0 ? clamp((pad + w + .6) / run.width, 0, 1) : 0
        const tokArrive = f.quiet ? 1 : settle(f.advance(110, tok.startMs))
        rowOpacity = fade * mix(.72, 1, tokArrive)
        rowSoft = Math.max(activeRowSoft, f.quiet || f.low ? 0 : (1 - tokArrive) * .42)
      }

      if (reveal === undefined || reveal > .001) {
        p.glyph(run, tx, yy, '#f7f8fc', {
          opacity: rowOpacity,
          clip,
          angle,
          softness: rowSoft,
          reveal,
        })
      }
    })
  }
}

export function ledger(f: Frame) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const width = Math.min(f.lane * .94, 588 * f.unit * Math.max(1, f.scale * .72))
  const height = Math.min(340 * f.unit, f.h * .58)
  const minRowH = height * .152
  const size = Math.min(f.em(22), height * .082)
  const lineStep = size * 1.22
  const rowPadY = Math.max(6 * f.unit, size * .34)

  const top = f.y + height * .5, bottom = f.y - height * .5
  const left = -width * .5 + 21 * f.unit, right = width * .5 - 21 * f.unit
  const pad = 10 * f.unit
  const numSize = Math.min(12.2 * f.unit, size * .68)
  const numColRight = right - 4 * f.unit
  const maxTextW = Math.max(80 * f.unit, width - 122 * f.unit)

  const headerY = top - height * .108
  const headerRuleY = top - height * .192
  const bottomRuleY = bottom + height * .092
  const clip = [bottomRuleY + 2 * f.unit, headerRuleY - 2 * f.unit] as const
  const bodyTop = headerRuleY - 4 * f.unit

  const roll = f.quiet ? 1 : settle(f.advance(170))
  const countRoll = f.quiet ? 1 : settle(f.advance(130))
  const paper = '#e8decd', edge = '#fff2df', ink = '#302724', secondary = '#5a504c', line = '#786b65'
  const accentWarm = '#f7cda9'

  p.card(0, f.y - 5 * f.unit, width + 9 * f.unit, height + 6 * f.unit, '#181118', { opacity: .27, radius: 9 })
  p.card(0, f.y, width, height, paper, { accent: edge, sheen: .59, border: 1.1, radius: 6 })
  f.word('LYRIC LEDGER', left + 43 * f.unit, headerY, 11.5 * f.unit, ink, {}, mono, 88 * f.unit)
  const cueHdrRun = f.run('CUE NO.', 10.5 * f.unit, mono, 56 * f.unit)
  p.glyph(cueHdrRun, numColRight - cueHdrRun.width / 2, headerY, secondary)
  f.rule(left, right, headerRuleY, line, .68)
  f.rule(left, right, bottomRuleY, line, .42)

  // Height-driven deterministic stacking from active cue backward so multi-line cues never overlap
  const count = Math.min(4, f.cue.index + 1)
  const entries: {
    cue: Cue
    rows: ReturnType<Frame['rows']>
    entryH: number
    centerOffset: number
    i: number
  }[] = []
  let stackTop = 0
  for (let i = 0; i < count; i++) {
    const cue = f.cues[f.cue.index - i]
    const rows = f.page(cue, f.rows(cue, size, maxTextW, f.medium, 'payments'), 2)
    if (!rows.length) continue
    const entryH = Math.max(minRowH, rows.length * lineStep + rowPadY * 2)
    entries.push({ cue, rows, entryH, centerOffset: stackTop + entryH * .5, i })
    stackTop += entryH
  }

  const rollOffset = (1 - roll) * f.motion * (entries[0]?.entryH ?? minRowH)

  for (let j = entries.length - 1; j >= 0; j--) {
    const { cue, rows, entryH, centerOffset, i } = entries[j]
    const py = bodyTop - centerOffset + rollOffset
    const topEdge = py + entryH * .5
    const bottomEdge = py - entryH * .5
    if (topEdge <= clip[0] + 1 || bottomEdge >= clip[1] - 1) continue

    const shade = i === 0 ? ink : secondary
    const rowAlpha = i ? Math.max(.55, .94 - i * .10) : 1

    if (!i) {
      p.card(0, py, width - 30 * f.unit, entryH * .88, '#56463c', { accent: '#443537', sheen: .58, radius: 3 * f.unit, clip })
    } else if (topEdge < clip[1] - 1 && topEdge > clip[0] + 1) {
      f.rule(left, right, topEdge, line, .26)
    }

    rows.forEach((row, rIdx) => {
      const run = f.atlas.get(row.text, size, f.medium, f.dpr)
      const rowY = py + (rows.length / 2 - rIdx - .5) * lineStep
      const rowX = cue.rtl
        ? left + maxTextW - row.width / 2 + pad
        : left + pad + row.width / 2
      if (!i) {
        const mark = f.mark(cue, row, run, f.medium, size)
        if (mark) {
          p.card(rowX + (mark[0] + mark[1] - 1) * run.width / 2, rowY - size * .46,
            (mark[1] - mark[0]) * run.width, 2.2 * f.unit, accentWarm, { radius: 1.5, clip, opacity: .9 })
        }
      }
      f.row(cue, row, run, rowX, rowY, i ? shade : '#f4e8d5', i ? shade : '#fff7ea', { opacity: rowAlpha, clip }, f.medium, size)
    })

    // Tabular right-aligned monospace sequence counter
    const n = String(cue.index + 1).padStart(3, '0')
    const countY = py + (i ? 0 : (1 - countRoll) * entryH * -.18 * f.motion)
    const numRun = f.run(n, numSize, mono, 44 * f.unit)
    p.glyph(numRun, numColRight - numRun.width / 2, countY, i ? secondary : accentWarm, { opacity: rowAlpha, clip })
  }

  const tail = Math.max(3, Math.floor(width / (24 * f.unit)))
  for (let n = 0; n < tail; n++) {
    f.rule(left + n * (right - left) / tail, left + (n + .52) * (right - left) / tail, bottom + height * .045, line, .43)
  }
}

export function notifications(f: Frame) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const size = Math.min(f.em(34), f.h * .098)
  const width = Math.min(f.lane * .91, 553 * f.unit * Math.max(1, f.scale * .79))
  const pad = 20 * f.unit
  const lineStep = size * 1.14
  const headerPad = 24 * f.unit
  const bottomPad = 18 * f.unit
  const currentRows = f.page(f.cue, f.rows(f.cue, size, width - pad * 2.8, f.medium, 'notifications'), 3)
  const height = Math.min(f.h * .40, Math.max(88 * f.unit, currentRows.length * lineStep + headerPad + bottomPad))

  const e = f.quiet ? 1 : settle(f.advance(200))
  const state = f.quiet ? 1 : smooth(f.advance(170))
  const stripStep = 23 * f.unit
  const baseY = f.y - (currentRows.length > 1 ? 8 * f.unit : 0)
  const activeTopSettled = baseY + height * .5

  const tail = Math.min(3, f.cue.index)
  for (let i = tail; i >= 1; i--) {
    const cue = f.cues[f.cue.index - i]
    const tier = i - (1 - e) * f.motion
    const collapse = i === 3 ? state * .035 * f.motion : 0
    const k = 1 - tier * .068 - collapse
    const tierH = Math.max(58 * f.unit, height * (1 - tier * .060 - collapse))
    const tierTop = activeTopSettled + tier * stripStep
    const tierY = tierTop - tierH * .5
    const opacity = i === 3 ? (1 - state) * .38 : Math.max(.24, 1 - i * .24)
    const labelAlpha = i === 1 ? opacity * .82 : i === 2 ? opacity * .62 : opacity * .44
    const w = width * k
    const xShift = tier * 4 * f.unit
    p.card(xShift, tierY, w, tierH, '#283447', {
      accent: '#6a7189', sheen: 1, radius: 15 * f.unit, fill: .84, border: 1, opacity,
    })
    const labelY = tierTop - stripStep * .48
    const headlineSize = Math.min(size * .38, 13.5 * f.unit)
    f.word(cue.text, xShift, labelY, headlineSize, f.foreground,
      { opacity: labelAlpha }, f.regular, w * .76)
  }

  const y = baseY - lift(f, 185, 16 * f.unit)
  p.card(0, y - 5 * f.unit, width + 8 * f.unit, height + 6 * f.unit, '#11121e', { opacity: .29, radius: 16 * f.unit })
  p.card(0, y, width, height, '#181e2b', { accent: '#6c778e', sheen: 1.24, radius: 15 * f.unit, border: 1.1, opacity: .96, fill: .88 })
  const left = -width / 2 + pad
  const dotX = left + 9 * f.unit
  const iconY = y + height / 2 - 15 * f.unit
  f.circle(dotX, iconY, 4.1 * f.unit, f.backing, { opacity: .92 })
  f.rule(dotX + 12 * f.unit, dotX + 36 * f.unit, iconY, f.muted, .55)
  for (let i = 0; i < 3; i++) f.circle(width / 2 - (20 + 7 * i) * f.unit, iconY, 1.2 * f.unit, f.muted, { opacity: .55 })

  const clip = [y - height * .47, iconY - 8 * f.unit] as const
  const bodyCenterY = (clip[0] + clip[1]) * .5
  currentRows.forEach((row, i) => {
    const run = f.atlas.get(row.text, size, f.medium, f.dpr)
    const py = bodyCenterY + (currentRows.length / 2 - i - .5) * lineStep
    const tx = f.cue.rtl ? -left - row.width / 2 - 3 * f.unit : left + row.width / 2 + 3 * f.unit
    f.row(f.cue, row, run, tx, py, f.foreground, f.backing, { opacity: mix(.82, 1, e), clip }, f.medium, size)
  })
}
