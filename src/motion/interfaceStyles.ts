import { Frame, ellipse, lift } from './frame'
import { mono, type Face } from './text'
import { clamp, hash, mix, rand, settle, smooth, type Cue, type Token } from './timeline'
import type { GlyphPaint, Point } from './painter'

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
  speakerSides.set(cues, sides)
  return sides[index] ?? false
}

function rotPoint(px: number, py: number, cx: number, cy: number, angle: number): readonly [number, number] {
  if (!angle) return [px, py]
  const ca = Math.cos(angle), sa = Math.sin(angle)
  const dx = px - cx, dy = py - cy
  return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]
}

export type MapAttachmentKind = 'route' | 'radar'

/**
 * Determine whether a message-thread cue carries an optional procedural map card.
 * Triggered on spatial/navigation phrases in multi-cue non-overlay playback (e.g. Demo cues 0 and 4).
 */
export function mapAttachmentKind(cue: Cue, cues: readonly Cue[], w: number, overlay: boolean): MapAttachmentKind | undefined {
  if (overlay || w < 500 || cues.length < 4 || cue.rtl || cue.mixed || !cue.timed) return undefined
  const t = cue.text.toLowerCase()
  if (t.includes('trace a line') || t.includes('beacon') || t.includes('radar')) return 'radar'
  if (t.includes('blue hours') || t.includes('harbor district') || t.includes('crescent bay')) return 'route'
  return undefined
}

function drawRowWords(
  f: Frame,
  cue: Cue,
  row: ReturnType<Frame['rows']>[number],
  tx: number,
  yy: number,
  size: number,
  face: Face,
  pivotX: number,
  pivotY: number,
  angle: number,
  clip: readonly [number, number],
  activeFade: number,
  color: string,
  rowBlurY: number,
  activeRowSoft: number,
) {
  const { p } = f
  const rowLeft = tx - row.width * .5
  const pieces: { text: string; from: number; to: number; tok?: Token }[] = []

  let cursor = row.from
  for (const tok of cue.tokens) {
    if (tok.to <= row.from || tok.from >= row.to) continue
    const a = clamp(tok.from, row.from, row.to)
    let b = clamp(tok.to, row.from, row.to)
    // Attach trailing punctuation adjacent to the token before the next space/token
    while (b < row.to && !/\s/.test(row.text[b - row.from]) && (!cue.tokens.some(nt => nt !== tok && nt.from <= b && nt.to > b))) {
      b++
    }
    if (a > cursor) {
      const gapStr = row.text.slice(cursor - row.from, a - row.from)
      if (gapStr.trim()) {
        const prevTok = pieces.at(-1)?.tok
        pieces.push({ text: gapStr, from: cursor, to: a, tok: prevTok })
      }
    }
    if (b > a) {
      pieces.push({ text: row.text.slice(a - row.from, b - row.from), from: a, to: b, tok })
    }
    cursor = Math.max(cursor, b)
  }
  if (cursor < row.to) {
    const rest = row.text.slice(cursor - row.from, row.to - row.from)
    if (rest.trim()) pieces.push({ text: rest, from: cursor, to: row.to, tok: pieces.at(-1)?.tok })
  }

  if (!pieces.length) {
    const run = f.atlas.get(row.text, size, face, f.dpr)
    const [rx, ry] = rotPoint(tx, yy, pivotX, pivotY, angle)
    p.glyph(run, rx, ry, color, { opacity: activeFade, clip, angle, softness: activeRowSoft, blurY: rowBlurY })
    return
  }

  for (const piece of pieces) {
    const tok = piece.tok
    if (!f.quiet && tok && f.time < tok.startMs) continue
    const trimmed = piece.text.trim()
    if (!trimmed) continue
    const leadSpaces = piece.text.indexOf(trimmed)
    const charOffset = (piece.from - row.from) + Math.max(0, leadSpaces)
    const prefixW = charOffset > 0 ? f.atlas.width(row.text.slice(0, charOffset), size, face) : 0
    const wordRun = f.atlas.get(trimmed, size, face, f.dpr)
    const tokArrive = f.quiet || !tok ? 1 : settle(f.advance(145, tok.startMs))
    const wordLift = f.quiet ? 0 : -(1 - tokArrive) * f.motion * size * .28
    const wordScale = f.quiet ? 1 : mix(.93, 1, tokArrive)
    const baseWx = rowLeft + prefixW + wordRun.advance * .5
    const baseWy = yy + wordLift
    const [wx, wy] = rotPoint(baseWx, baseWy, pivotX, pivotY, angle)
    p.glyph(wordRun, wx, wy, color, {
      opacity: activeFade * (f.quiet ? 1 : mix(.18, 1, tokArrive)),
      scale: wordScale,
      clip,
      angle,
      softness: Math.max(activeRowSoft, f.quiet || f.low ? 0 : (1 - tokArrive) * .24),
      blurY: rowBlurY,
    })
  }
}

function drawMapAttachmentCard(
  f: Frame,
  kind: MapAttachmentKind,
  cue: Cue,
  rows: ReturnType<Frame['rows']>,
  width: number,
  height: number,
  mapH: number,
  x: number,
  py: number,
  padX: number,
  size: number,
  subSize: number,
  angle: number,
  fade: number,
  pulse: number,
  sweepBlur: number,
  activeRowSoft: number,
  clip: readonly [number, number],
  active: boolean,
) {
  const { p } = f
  const radius = Math.min(height * .24, 15 * f.unit + 2)
  const cardTop = py + height * .5
  const cardBot = py - height * .5
  const paneCenterY = cardTop - mapH * .5
  const capH = height - mapH
  const capCenterY = cardBot + capH * .5
  const innerClip: readonly [number, number] = [Math.max(clip[0], cardBot + 2 * f.unit), Math.min(clip[1], cardTop - 2 * f.unit)]
  const paneClip: readonly [number, number] = [Math.max(clip[0], cardTop - mapH + 1), Math.min(clip[1], cardTop - 1)]

  // Drop shadow + rounded dark container with crisp transient pale rim pulse
  const [sx, sy] = rotPoint(x, py - 5 * f.unit, x, py, angle)
  p.card(sx, sy, width + 6 * f.unit, height + 5 * f.unit, '#080b14', {
    opacity: fade * .26, clip, angle, radius: radius + 2, blurY: sweepBlur,
  })
  const rimAccent = active ? (pulse > .08 ? '#dbe6fa' : '#4a556e') : '#384158'
  const rimBorder = active ? mix(.9, 2.0, pulse * f.motion) : .75
  p.card(x, py, width, height, '#1e222d', {
    opacity: fade, clip, angle, accent: rimAccent, border: rimBorder, radius, sheen: .42, fill: .97, blurY: sweepBlur,
  })
  if (active && pulse > .04 && f.motion > 0) {
    p.card(x, py, width + 3 * f.unit, height + 3 * f.unit, '#000000', {
      opacity: fade * pulse * .65, clip, angle, accent: '#e8effc', border: 1.5, fill: 0, radius: radius + 1.5,
    })
  }

  // Cartographic map upper canvas + caption matte separation (within paneClip)
  if (paneClip[1] > paneClip[0] + 4) {
    const [mpx, mpy] = rotPoint(x, paneCenterY, x, py, angle)
    p.card(mpx, mpy, width - 3 * f.unit, mapH - 2 * f.unit, '#1a2b4d', {
      opacity: fade, clip: paneClip, angle, radius: Math.max(4, radius - 2), fill: .98, blurY: sweepBlur * .8,
    })

    const mapLeft = x - width * .48, mapRight = x + width * .48
    const mapBot = paneCenterY - mapH * .48, mapTop = paneCenterY + mapH * .48
    const toScreen = (u: number, v: number): Point => rotPoint(mix(mapLeft, mapRight, u), mix(mapBot, mapTop, v), x, py, angle)
    const mapSeed = hash(cue.text)

    // Coastal bay channel & organic shoreline
    const bayBand: Point[] = Array.from({ length: 14 }, (_, k) => {
      const u = k / 13
      const v = kind === 'radar'
        ? .26 + .18 * Math.sin(u * 4.4 + .6)
        : .64 - .22 * u + .12 * Math.sin(u * 5.2)
      return toScreen(u, v)
    })
    p.path(bayBand, '#112546', Math.max(10, mapH * .24), { clip: paneClip, opacity: fade * .82 })
    p.path(bayBand, '#395a8c', 1.2, { clip: paneClip, opacity: fade * .48 })

    // Subtle urban block footprints (width capped <= 28 px so they never register as main message cards)
    for (let b = 0; b < 6; b++) {
      const bx = .12 + (b % 3) * .30 + (rand(mapSeed, b) - .5) * .08
      const by = .20 + Math.floor(b / 3) * .48 + (rand(mapSeed, b + 11) - .5) * .10
      const bw = Math.min(28, (14 + rand(mapSeed, b + 23) * 14) * f.unit)
      const bh = Math.min(22, (10 + rand(mapSeed, b + 37) * 10) * f.unit)
      const [bcx, bcy] = toScreen(bx, by)
      p.card(bcx, bcy, bw, bh, '#233863', {
        clip: paneClip, angle: angle + (rand(mapSeed, b + 5) - .5) * .25, radius: 2.5, opacity: fade * .36, fill: 1, border: 0,
      })
    }

    // Two-tier street hierarchy (secondary lattice + curved primary avenue)
    for (let g = 1; g <= 4; g++) {
      const frac = g / 5
      p.path([toScreen(frac - .06, 0), toScreen(frac + .09, 1)], '#435d88', .9, { clip: paneClip, opacity: fade * .32 })
      p.path([toScreen(0, frac + .04), toScreen(1, frac - .07)], '#435d88', .9, { clip: paneClip, opacity: fade * .30 })
    }
    const arterial: Point[] = Array.from({ length: 10 }, (_, k) => {
      const u = k / 9
      return toScreen(u, .36 + .28 * Math.sin(u * 2.5 + .4))
    })
    p.path(arterial, '#5b7aa8', 1.75, { clip: paneClip, opacity: fade * .55 })

    // Fictional micro street name pill (<= 22 px width, subtle opacity)
    const roadTag = kind === 'radar' ? 'Beacon St' : 'Harbor Blvd'
    const tagRun = f.atlas.get(roadTag, Math.max(7.5, 8.2 * f.unit), f.regular, f.dpr)
    const [rtx, rty] = toScreen(kind === 'radar' ? .23 : .66, kind === 'radar' ? .72 : .24)
    p.glyph(tagRun, rtx, rty, '#9db4db', { clip: paneClip, angle, opacity: fade * .62 })

    if (kind === 'route') {
      const rawRoute: Point[] = [
        toScreen(.14, .28), toScreen(.30, .46), toScreen(.46, .42), toScreen(.62, .64), toScreen(.81, .70),
      ]
      const routeFrac = f.quiet ? 1 : clamp(smooth(f.advance(950, cue.startMs + 80)), .24, 1)
      p.path(rawRoute, '#2a72eb', 4.6 * f.unit, { clip: paneClip, opacity: fade * .34 }, routeFrac)
      p.path(rawRoute, '#56a0ff', 2.2 * f.unit, { clip: paneClip, opacity: fade * .96 }, routeFrac)
      const [sxPt, syPt] = rawRoute[0]
      const [exPt, eyPt] = rawRoute.at(-1)!
      f.circle(sxPt, syPt, 3.6 * f.unit, '#eef5ff', { clip: paneClip, opacity: fade * .95 })
      f.circle(sxPt, syPt, 1.9 * f.unit, '#2563eb', { clip: paneClip, opacity: fade })
      f.circle(exPt, eyPt, 5.4 * f.unit, '#f35d5d', { clip: paneClip, opacity: fade * .36 })
      f.circle(exPt, eyPt, 3.6 * f.unit, '#ffffff', { clip: paneClip, opacity: fade * .98 })
      f.circle(exPt, eyPt, 2.0 * f.unit, '#ef4444', { clip: paneClip, opacity: fade })
    } else {
      const [rxPt, ryPt] = toScreen(.54, .54)
      const sweepPhase = f.quiet ? .45 : ((f.time - cue.startMs) * .00075) % 1
      const ringA = mix(.38, 1.0, sweepPhase)
      const ringB = mix(.38, 1.0, (sweepPhase + .5) % 1)
      const maxRadarR = mapH * .38
      p.path(ellipse(maxRadarR * ringA, maxRadarR * ringA, 28, rxPt, ryPt), '#34d399', 1.25, {
        clip: paneClip, opacity: fade * (1 - ringA) * .72,
      })
      p.path(ellipse(maxRadarR * ringB, maxRadarR * ringB, 28, rxPt, ryPt), '#60a5fa', 1.1, {
        clip: paneClip, opacity: fade * (1 - ringB) * .58,
      })
      p.path(ellipse(maxRadarR * .62, maxRadarR * .62, 28, rxPt, ryPt), '#4ade80', 1.0, {
        clip: paneClip, opacity: fade * .34,
      })
      f.circle(rxPt, ryPt, 6.2 * f.unit, '#34d399', { clip: paneClip, opacity: fade * .30 })
      f.circle(rxPt, ryPt, 4.0 * f.unit, '#ffffff', { clip: paneClip, opacity: fade })
      f.circle(rxPt, ryPt, 2.3 * f.unit, '#10b981', { clip: paneClip, opacity: fade })
    }
  }

  // Divider & matte charcoal footer with progressive lyric caption + invented district subtitle
  const [dLeftX, dLeftY] = rotPoint(x - width * .49, cardTop - mapH, x, py, angle)
  const [dRightX, dRightY] = rotPoint(x + width * .49, cardTop - mapH, x, py, angle)
  p.path([[dLeftX, dLeftY], [dRightX, dRightY]], '#3a4152', 1.0, { clip: innerClip, opacity: fade * .75 })

  const topRowY = capCenterY + capH * .5 - padX * .48 - size * .48
  rows.forEach((row, rIdx) => {
    const yy = topRowY - rIdx * size * 1.18
    const tx = x + (row.width - width) / 2 + padX
    if (!active) {
      const run = f.atlas.get(row.text, size, f.heavy, f.dpr)
      const [rx, ry] = rotPoint(tx, yy, x, py, angle)
      p.glyph(run, rx, ry, '#f2f5fb', { opacity: fade * .92, clip: innerClip, angle, softness: activeRowSoft, blurY: sweepBlur })
    } else {
      drawRowWords(f, cue, row, tx, yy, size, f.heavy, x, py, angle, innerClip, fade, '#f6f8fd', sweepBlur, activeRowSoft)
    }
  })

  const subText = kind === 'radar' ? 'Crescent Bay Ave' : 'Blue Harbor District'
  const subRun = f.atlas.get(subText, subSize, f.regular, f.dpr)
  const [subX, subY] = rotPoint(x + (subRun.advance - width) / 2 + padX, cardBot + subSize * .85 + 6 * f.unit, x, py, angle)
  p.glyph(subRun, subX, subY, '#98a2b7', { opacity: fade * .84, clip: innerClip, angle, blurY: sweepBlur })
}

export function thread(f: Frame) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const size = Math.min(f.em(27), f.h * .080)
  const subSize = Math.max(10 * f.unit, size * .64)
  const left = -f.lane * .40, right = f.lane * .44
  const padX = 16 * f.unit, padY = 11 * f.unit
  const withinGroupGap = Math.max(size * .34, 8 * f.unit)
  const betweenGroupGap = Math.max(size * .76, 19 * f.unit)
  const limit = Math.min(f.lane * .70, 450 * f.unit * Math.max(1, f.scale * .82))
  const enter = f.quiet ? 1 : settle(f.advance(235))
  const hist = Math.min(f.cue.index, 3)
  const tallBias = mapAttachmentKind(f.cue, f.cues, f.w, f.overlay) ? Math.min(f.h * .085, 52 * f.unit) : 0
  const ly = f.y - Math.min(hist * 18 * f.unit, f.h * .115) - tallBias
  const clip = [f.y - f.h * .30, f.y + f.h * .38] as const

  const entries: {
    cue: Cue
    rows: ReturnType<Frame['rows']>
    mapKind?: MapAttachmentKind
    mapH: number
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
    const mapKind = mapAttachmentKind(cue, f.cues, f.w, f.overlay)
    const rows = f.page(cue, f.rows(cue, size, limit - 2 * padX, mapKind ? f.heavy : f.regular, 'message-thread'), i === 0 ? 3 : 2)
    let width: number
    let height: number
    let mapH = 0
    if (mapKind) {
      width = Math.min(limit, Math.max(255 * f.unit, limit * .84, ...rows.map(row => row.width + padX * 2)))
      mapH = Math.round(width * .42)
      height = mapH + rows.length * size * 1.18 + subSize * 1.35 + padY * 1.85
    } else {
      width = Math.max(66 * f.unit, ...rows.map(row => row.width + padX * 2))
      height = rows.length * size * 1.22 + padY * 2
    }
    const outgoing = speakerSide(f.cues, cue.index)
    if (i > 0) {
      const prevSameSide = entries[i - 1].outgoing === outgoing && !entries[i - 1].mapKind && !mapKind
      accum += prevSameSide ? withinGroupGap : betweenGroupGap
    }
    const x = outgoing ? right - width / 2 : left + width / 2
    const y = ly + accum + height / 2
    entries.push({ cue, rows, mapKind, mapH, width, height, outgoing, x, y, i })
    accum += height
  }

  const nextGap = entries[1]
    ? (entries[1].outgoing === entries[0].outgoing && !entries[0].mapKind && !entries[1].mapKind ? withinGroupGap : betweenGroupGap)
    : betweenGroupGap
  const shiftDist = (entries[0]?.height ?? 0) + nextGap
  const delta = (1 - enter) * f.motion * shiftDist
  const sweepProg = f.quiet ? 0 : 1 - smooth(f.advance(185))
  const sweepBlur = f.quiet || f.low ? 0 : clamp((shiftDist / Math.max(1, size * 2.15)) - .38, 0, 1) * sweepProg * f.motion * .58
  const outlinePulse = f.quiet ? 0 : 1 - smooth(f.advance(320))

  for (let j = entries.length - 1; j >= 0; j--) {
    const { cue, rows, mapKind, mapH, width, height, outgoing, x, y, i } = entries[j]
    const angle = i === 0 && !f.quiet ? (1 - enter) * f.motion * (outgoing ? -.056 : .056) : 0
    const rotationClearance = i === 0
      ? Math.max(0, (Math.abs(Math.sin(angle)) * width + (Math.cos(angle) - 1) * height) / 2)
      : 0
    const py = y - delta - rotationClearance
    // Soft top-edge history masking dissolves older bubbles cleanly before hitting hard clip bounds (never dim active cue 0)
    const clipFade = i === 0 ? 1 : smooth((clip[1] - (py + height * .5)) / (size * 2.2))
    const ageFade = i >= 3 ? mix(.82, .48, clamp(i - 3)) : 1
    const baseFade = i === 0 ? mix(.45, 1, enter) : (i === 4 ? (1 - enter) * .45 : ageFade)
    const fade = clamp(baseFade * clipFade)
    if (fade <= .01) continue

    const activeRowSoft = i === 0 && !f.quiet && !f.low ? (1 - enter) * .45 : 0

    if (mapKind) {
      drawMapAttachmentCard(
        f, mapKind, cue, rows, width, height, mapH, x, py, padX, size, subSize,
        angle, fade, i === 0 ? outlinePulse : 0, sweepBlur, activeRowSoft, clip, i === 0,
      )
      continue
    }

    const color = outgoing ? '#1d69ee' : '#262934'
    const baseAccent = outgoing ? '#3b82f6' : '#3d4252'
    const r = Math.min(height * .46, 15 * f.unit + 2)
    const hasTail = i === 0 || (entries[i - 1].outgoing !== outgoing || !!entries[i - 1].mapKind)
    const bubble: GlyphPaint = { opacity: fade, clip, angle, blurY: sweepBlur }

    // Shadow, subtle outer arrival rim, bubble body, and seamless overlapping curved speech tail (width <= 34px)
    const [sx, sy] = rotPoint(x, py - 4 * f.unit, x, py, angle)
    p.card(sx, sy, width + 5 * f.unit, height + 4 * f.unit, '#0b0d17', { ...bubble, opacity: fade * .22, radius: r + 2 })
    if (i === 0 && outlinePulse > .04 && f.motion > 0) {
      p.card(x, py, width + 3.6 * f.unit, height + 3.6 * f.unit, '#000000', {
        opacity: fade * outlinePulse * .54, clip, angle, accent: outgoing ? '#dcebff' : '#d5dce8',
        border: 1.35, fill: 0, radius: r + 1.8, blurY: sweepBlur,
      })
    }
    p.card(x, py, width, height, color, {
      ...bubble, accent: baseAccent, border: hasTail ? .18 : .45, radius: r, sheen: .42, fill: outgoing ? .98 : .95,
    })
    if (hasTail) {
      const tailW = Math.min(34, 21 * f.unit)
      const tailH = Math.min(34, 19 * f.unit)
      const [txTail, tyTail] = rotPoint(
        x + (outgoing ? 1 : -1) * (width * .5 + tailW * .04),
        py - height * .5 + tailH * .32,
        x, py, angle,
      )
      p.card(txTail, tyTail, tailW, tailH, color, {
        ...bubble, accent: baseAccent, border: 0, fill: outgoing ? .99 : .96, sheen: .12, tail: outgoing ? 1 : -1,
      })
    }

    rows.forEach((row, rIdx) => {
      const baseTx = cue.rtl
        ? x + (width - row.width) / 2 - padX
        : x + (row.width - width) / 2 + padX
      const baseYy = py + (rows.length / 2 - rIdx - .5) * size * 1.22 + size * .045

      if (i > 0 || !cue.timed || cue.rtl || cue.mixed) {
        const run = f.atlas.get(row.text, size, f.regular, f.dpr)
        const [tx, yy] = rotPoint(baseTx, baseYy, x, py, angle)
        p.glyph(run, tx, yy, '#f5f6fb', {
          opacity: fade * (i === 0 ? 1 : .92),
          clip,
          angle,
          softness: activeRowSoft,
          blurY: sweepBlur,
        })
        return
      }

      drawRowWords(f, cue, row, baseTx, baseYy, size, f.regular, x, py, angle, clip, fade, '#f7f8fc', sweepBlur, activeRowSoft)
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
