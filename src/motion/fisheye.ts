import { Frame, lookupIcon } from './frame'
import { cylindricalLensPoint, lensRail, neighboring, type LensField } from './heroGeometry'
import type { Point } from './painter'
import { clamp, hash, mix, settle, smooth } from './timeline'

export function lens(f: Frame, visual = false) {
  const slot = (offset: number) => neighboring(f.cues, f.cue, f.ti, offset)
  const mid = f.cue.tokens[f.ti]
  const previous = slot(-1)?.token
  const older = slot(-2)?.token
  const next = slot(1)?.token
  const following = slot(2)?.token

  const hasPrev = !!previous
  const railPrev = older ? previous?.startMs : undefined
  const railNext = hasPrev ? next?.startMs : undefined
  const offset = f.quiet ? 0 : lensRail(f.time, mid.startMs, railPrev, railNext, following?.startMs, f.speed)

  const space = Math.min(f.em(92), f.h * .178)
  const size = Math.min(f.em(72), space * .78)
  const max = f.lane * .75
  const strength = (f.quiet ? .82 : clamp(.84 + f.motion * .12, .84, .96)) * clamp(f.w / 680, .62, 1)
  const field: LensField = [Math.min(max * .62, 2.2 * space), space * 1.06, strength, 0, f.y]
  const edge = Math.min(space * 1.68, f.h * .295)
  const clip = [f.y - edge, f.y + edge] as const

  const arrive = hasPrev && !older && !f.quiet ? settle(f.advance(125, mid.startMs)) : 1

  for (const i of [-2, -1, 0, 1]) {
    const entry = slot(i)
    if (!entry) continue
    if (i > 0 && entry.token.startMs > f.time + 55) continue

    const base = hasPrev ? -i - 1 : -i
    const d = base + offset - (i === 0 && hasPrev && !older ? (1 - arrive) * .28 : 0)
    const distance = Math.abs(d)
    const live = f.token === entry.token
    const focus = 1 - smooth(distance / 1.32)
    const visible = 1 - smooth((distance - 1.12) / .68)
    if (visible < .003) continue

    const y = f.y + d * space
    const scale = mix(.78, 1.04, focus)
    const shape = visual ? lookupIcon(entry.token.text) : undefined
    const iconSize = shape ? size * mix(.44, .52, focus) * scale : 0
    const side = shape ? ((hash(entry.token.text) & 1) ? 1 : -1) : 0
    const gutter = shape ? iconSize * 1.75 : 0
    const run = f.run(entry.token.text, size, f.heavy, max - gutter)
    const x = -side * iconSize * .55

    const historyFade = d > .48 ? mix(.82, .44, smooth((d - .52) / .68)) : mix(.76, .98, focus)
    const entryFade = i === 0 && hasPrev && !older ? mix(.55, 1, arrive) : 1
    const opacity = clamp(visible * entryFade * (live ? .98 : historyFade))
    if (opacity <= .005) continue

    const cardCx = x + run.ink.x * scale
    const cardCy = y + run.ink.y * scale
    const cardW = (Math.max(run.ink.width, run.advance) + size * .26) * scale
    const cardH = Math.max(run.ink.height + size * .24, size * .76) * scale
    const hasCard = live && !f.overlay

    if (hasCard) {
      f.p.card(
        cardCx,
        cardCy,
        cardW,
        cardH,
        f.backing,
        {
          accent: f.active,
          opacity: clamp(opacity * .98),
          lens: field,
          lensMode: 'cylinder',
          clip,
          radius: size * .065 * scale,
          border: .85,
          sheen: .06,
        },
      )
    }

    const inkColor = live
      ? (f.overlay ? f.active : f.onBacking)
      : distance < .48
        ? f.active
        : d > .5
          ? f.muted
          : f.foreground

    f.p.glyph(run, x, y, inkColor, {
      opacity,
      clip,
      scale,
      lens: field,
      lensMode: 'cylinder',
    })

    if (shape) {
      const halfSpan = hasCard ? cardW * .5 + 1.5 : Math.max(run.ink.width, run.advance) * .5 * scale
      const baseGap = (hasCard ? size * .20 : size * .14) * scale
      const iconY = cardCy
      let rawIx = cardCx + side * (halfSpan + baseGap + iconSize * .5)
      if (hasCard) {
        const edgeX = cardCx + side * (cardW * .5 + 1.5)
        const cardOuterX = side > 0
          ? Math.max(
              cylindricalLensPoint(field, edgeX, cardCy - cardH * .5)[0],
              cylindricalLensPoint(field, edgeX, cardCy)[0],
              cylindricalLensPoint(field, edgeX, cardCy + cardH * .5)[0],
            )
          : Math.min(
              cylindricalLensPoint(field, edgeX, cardCy - cardH * .5)[0],
              cylindricalLensPoint(field, edgeX, cardCy)[0],
              cylindricalLensPoint(field, edgeX, cardCy + cardH * .5)[0],
            )
        const minClear = size * .14 * scale
        for (let iter = 0; iter < 3; iter++) {
          const innerX = rawIx - side * iconSize * .5
          const iconInnerX = side > 0
            ? Math.min(
                cylindricalLensPoint(field, innerX, iconY - iconSize * .5)[0],
                cylindricalLensPoint(field, innerX, iconY)[0],
                cylindricalLensPoint(field, innerX, iconY + iconSize * .5)[0],
              )
            : Math.max(
                cylindricalLensPoint(field, innerX, iconY - iconSize * .5)[0],
                cylindricalLensPoint(field, innerX, iconY)[0],
                cylindricalLensPoint(field, innerX, iconY + iconSize * .5)[0],
              )
          const gap = (iconInnerX - cardOuterX) * side
          if (gap >= minClear) break
          rawIx += side * (minClear - gap) * 1.25
        }
      }
      const [, iy] = cylindricalLensPoint(field, rawIx, iconY)
      const mask = smooth((iy - clip[0]) / 18) * smooth((clip[1] - iy) / 18)
      const iconProgress = live ? settle(f.advance(110, entry.token.startMs)) : 1
      const iconOpacity = mask * opacity * (live || distance < .48 ? .95 : .52)
      const iconColor = live || distance < .48 ? f.active : f.foreground
      if (iconOpacity > .005) {
        const strokeWidth = Math.max(1, iconSize * .09)
        for (const subPath of shape) {
          const pts: Point[] = subPath.map(([a, b]) =>
            cylindricalLensPoint(field, rawIx + a * iconSize, iconY + b * iconSize),
          )
          f.p.path(pts, iconColor, strokeWidth, { opacity: iconOpacity, clip }, iconProgress)
        }
      }
    }
  }
}
