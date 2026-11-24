import { Frame, ellipse } from './frame'
import type { Point } from './painter'
import { clamp, hash, mix, rand, settle, smooth, spring, type Token } from './timeline'

const TAU = Math.PI * 2
const lineBetween = (a: Point, b: Point, n: number, bow: number): Point[] => Array.from({ length: n + 1 }, (_, i) => {
  const p = i / n
  return [mix(a[0], b[0], p), mix(a[1], b[1], p) + Math.sin(Math.PI * p) * bow]
})

function paged(f: Frame, n: number) {
  const pageStart = Math.floor(f.ti / n) * n
  return f.cue.tokens.slice(pageStart, pageStart + n)
}

function nodeText(f: Frame, token: Token, x: number, y: number, size: number, width: number, live: boolean, opacity: number) {
  const enter = live ? spring(f.advance(128, token.startMs)) : 1
  f.word(token.text, x, y - (1 - enter) * f.motion * size * .24, size, live ? f.active : f.foreground,
    { opacity, scale: live ? 1 + .045 * f.motion * (1 - enter) : 1 }, live ? f.heavy : f.medium, width)
}

export function branches(f: Frame) {
  const { p } = f
  const tokens = paged(f, f.w > 640 ? 6 : 4)
  const boxW = f.lane * .92
  const step = boxW / Math.max(2, tokens.length)
  const seed = hash(f.cue.text)
  const height = Math.min(f.h * .20, 125 * f.unit)
  const size = Math.min(f.em(29), f.h * .092)
  const grow = f.quiet ? 1 : f.advance(230)
  const currentOffset = tokens.indexOf(f.cue.tokens[f.ti])
  const pan = (currentOffset - (tokens.length - 1) / 2) * -6 * f.unit * f.motion
  const bottom = f.y - 9 * f.unit
  const spine: Point[] = [[-boxW / 2 - 18 * f.unit + pan, bottom - height * .32]]
  tokens.forEach((_, i) => {
    spine.push([(i - (tokens.length - 1) / 2) * step + pan, bottom + Math.sin((i + 1) * .83) * height * .22])
  })
  if (!f.overlay && f.previous && grow < 1) {
    const fade = (1 - grow) * .42
    const old = lineBetween([-boxW / 2, bottom - height * .43], [boxW * .37 * (1 - grow), bottom - height * .72], 20, height * .14)
    p.path(old, f.muted, 1, { opacity: fade })
    f.word(f.previous.text, 0, bottom - height * .78, size * .62, f.muted, { opacity: fade }, f.medium, boxW * .62)
  }
  if (!f.overlay) {
    for (const side of [-1, 1]) f.rule(-boxW / 2 - 18 * f.unit, boxW / 2 + 18 * f.unit, bottom + side * height * .90, f.muted, .12)
  }
  tokens.forEach((token, i) => {
    const a = spine[i], b = spine[i + 1]
    const live = token === f.token, seen = f.time >= token.startMs
    const reveal = f.quiet ? Number(seen) : smooth(f.advance(160, token.startMs - 160 / f.speed))
    const ideal = lineBetween(a, b, 15, height * .08 * (i % 2 ? 1 : -1))
    p.path(ideal, f.muted, 1.25, { opacity: .23 })
    p.path(ideal, live ? f.backing : '#9bb5a1', live ? 2.3 : 1.55, { opacity: live ? .96 : seen ? .77 : .55 }, reveal)
    const sign = i % 2 === 0 ? 1 : -1
    const x = b[0] + step * (rand(seed, i) - .5) * .23
    const y = b[1] + sign * height * (.48 + rand(seed, i + 71) * .18)
    const twig = lineBetween(b, [x, y], 9, sign * height * .06)
    p.path(twig, live ? f.backing : f.muted, live ? 1.5 : 1, { opacity: live ? .91 : seen ? .59 : .24 }, seen ? 1 : .84)
    f.circle(b[0], b[1], (live ? 4.2 : 2.4) * f.unit, live ? f.backing : f.muted, { opacity: live ? 1 : seen ? .8 : .39 })
    if (live) p.card(b[0], b[1], 16 * f.unit, 16 * f.unit, f.backing, { radius: 12 * f.unit, fill: 0, border: .9, opacity: .7 })
    const opacity = live ? 1 : seen ? .70 : .34
    const labelY = y + sign * (size * .52 + 3 * f.unit)
    nodeText(f, token, x, labelY, size * (live ? 1.10 : .85), tokens.length === 1 ? boxW * .92 : step * (live ? 1.40 : 1.18), live, opacity)
  })
}

export function web(f: Frame) {
  const { p } = f
  const tokens = paged(f, 6), seed = hash(f.cue.text)
  const rx = f.lane * .32, ry = Math.min(f.h * .18, 128 * f.unit)
  const size = Math.min(f.em(30), f.h * .084)
  const phase = -.12 + rand(seed, 2) * .24
  const expand = (.12 * (1 - settle(f.advance(205))) + .016 * Math.sin(f.time * .00061)) * f.motion
  const aspect = .93 + expand
  const sway = Math.sin(f.time * .00048) * .05 * f.motion
  const centre: Point = [0, f.y]
  const count = Math.max(5, tokens.length)
  const nodes = Array.from({ length: count }, (_, i): Point => {
    const a = i / count * TAU + phase + sway
    return [Math.cos(a) * rx * aspect * (.94 + rand(seed, i + 5) * .10), f.y + Math.sin(a) * ry * aspect]
  })
  const ratios = f.low ? [.55, 1] : [.26, .55, .77, 1]
  ratios.forEach((scale, n) => {
    const ring: Point[] = nodes.map(([x, y], i) => [x * scale, f.y + (y - f.y) * scale * (.98 + rand(seed, i + n) * .07)])
    ring.push(ring[0])
    p.path(ring, n === ratios.length - 1 ? '#c0b3ab' : f.muted, n ? 1 : .8, { opacity: .15 + n * .06 })
  })
  const labels: { token: Token; x: number; y: number; width: number; live: boolean; seen: boolean }[] = []
  nodes.forEach((to, i) => {
    const t = tokens[i], live = t === f.token, seen = !!t && f.time >= t.startMs
    const progress = t ? settle(f.advance(140, t.startMs)) : 1
    const bow = live ? (1 - progress) * (i % 2 ? 1 : -1) * ry * .27 * f.motion : 0
    const strand = lineBetween(centre, to, 14, bow)
    p.path(strand, f.muted, .9, { opacity: .28 })
    if (t && seen) p.path(strand, live ? f.backing : '#a4b7d7', live ? 2.25 : 1.15, { opacity: live ? .94 : .58 }, live ? Math.max(.18, progress) : 1)
    f.circle(to[0], to[1], (live ? 4.2 : 2.5) * f.unit, live ? f.backing : f.muted, { opacity: live ? 1 : .56 })
    if (!t) return
    const side = to[0] < 0 ? -1 : 1
    const edge = Math.abs(to[0]) > rx * .7
    const xx = tokens.length === 1 ? 0 : clamp(to[0] + (edge ? -side * 32 * f.unit : 0), -f.lane * .34, f.lane * .34)
    const yy = to[1] + (to[1] > f.y || (edge && side > 0) ? 1 : -1) * (size * .62 + 7 * f.unit)
    labels.push({ token: t, x: xx, y: yy, width: tokens.length === 1 ? f.lane * .8 : f.lane * (edge ? .24 : .31), live, seen })
  })
  f.circle(0, f.y, 3.45 * f.unit, f.backing, { opacity: .88 })
  if (!f.overlay) {
    p.path(ellipse(rx * 1.25, ry * 1.30, 48, 0, f.y), f.muted, .7, { opacity: .13 })
    f.rule(-rx * 1.32, -rx * 1.18, f.y, f.muted, .38)
    f.rule(rx * 1.18, rx * 1.32, f.y, f.muted, .38)
  }
  labels.sort((a, b) => Number(a.live) - Number(b.live)).forEach(l => {
    if (l.live) {
      const width = Math.min(l.width, f.atlas.width(l.token.text, size * 1.06, f.heavy))
      p.card(l.x, l.y, width + 16 * f.unit, size * 1.14, '#1d2334', { accent: '#394254', opacity: .83, radius: 7 * f.unit, sheen: .6, border: .85 })
    }
    nodeText(f, l.token, l.x, l.y, size * (l.live ? 1.06 : .78), l.width, l.live, l.live ? 1 : l.seen ? .72 : .36)
  })
}

const sky = Array.from({ length: 36 }, (_, i) => [rand(0x7024, i), rand(0x7024, i + 89), rand(0x7024, i + 171)] as const)
export function constellation(f: Frame) {
  const { p } = f
  const tokens = paged(f, f.w < 600 ? 4 : 6)
  const seed = hash(f.cue.text)
  const rx = f.lane * .37, ry = Math.min(f.h * .16, 111 * f.unit)
  const size = Math.min(f.em(27), f.h * .085)
  const advance = settle(f.advance(210))
  const yaw = Math.sin(f.time * .00039) * f.motion * 6 * f.unit
  if (!f.overlay && !f.quiet) sky.slice(0, f.low ? 14 : 27).forEach(([x, y, mag], i) => {
    f.circle((x - .5) * rx * 2.85 + yaw * (i % 3) / 2, f.y + (y - .5) * ry * 3.2, (.7 + mag * .95) * f.unit,
      i % 5 ? '#c7d6f8' : '#f8ca9f', { opacity: .25 + mag * .32 })
  })
  const n = tokens.length
  const candidates = tokens.map((t, i): Point => {
    if (n === 1) return [yaw, f.y - ry * .21]
    const s = i / (n - 1)
    const x = mix(-rx, rx, s) + (rand(seed, i) - .5) * rx / n
    const y = f.y + (i % 2 ? 1 : -1) * ry * (.26 + rand(seed, i + 16) * .60)
    return [x + yaw, y]
  })
  if (f.previous && !f.overlay && advance < 1) {
    const remain = 1 - advance
    p.path([[-rx * .65, f.y - ry * 1.1], [-rx * .16, f.y - ry * .87], [rx * .08, f.y - ry * 1.24], [rx * .6, f.y - ry]], f.muted,
      .9, { opacity: remain * .34 }, remain)
  }
  for (let i = 1; i < candidates.length; i++) {
    const [a, b] = [candidates[i - 1], candidates[i]]
    const t = tokens[i]
    const q = f.quiet ? Number(f.time >= t.startMs) : smooth(f.advance(155, t.startMs - 155 / f.speed))
    p.path([a, b], f.muted, .75, { opacity: .19 })
    p.path([a, b], t === f.token ? '#e9bbad' : '#a6bcdf', t === f.token ? 1.7 : 1.0, { opacity: t === f.token ? .79 : .58 }, q)
  }
  candidates.forEach(([x, y], i) => {
    const token = tokens[i], live = token === f.token, seen = f.time >= token.startMs
    const mode = live ? f.backing : '#dfebff'
    const age = settle(f.advance(130, token.startMs))
    if (live && !f.quiet) {
      const flare = (8 + 11 * (1 - age) * f.motion) * f.unit
      f.circle(x, y, flare, f.backing, { opacity: .11 })
      p.path([[x - flare, y], [x + flare, y]], mode, .9, { opacity: .63 })
      p.path([[x, y - flare], [x, y + flare]], mode, .85, { opacity: .63 })
    }
    f.circle(x, y, (live ? 3.6 : 2.2) * f.unit, mode, { opacity: live ? 1 : seen ? .83 : .39 })
    const off = (y < f.y && n > 1 ? -1 : 1) * (size * .63 + 6 * f.unit)
    nodeText(f, token, x, y + off, size * (live ? 1.14 : .83), n === 1 ? f.lane * .83 : Math.max(75 * f.unit, rx * (n < 4 ? .72 : .52)), live, live ? 1 : seen ? .71 : .42)
  })
}

function wayPoint(i: number): Point {
  return [i * 92 + 14 * Math.sin(i * 2.4), 42 * Math.sin(i * .82) + 30 * Math.sin(i * 1.87)]
}
function routeSegment(i: number) {
  const a = wayPoint(i), b = wayPoint(i + 1)
  const bend = 19 * Math.cos(i * 2.3)
  return Array.from({ length: 21 }, (_, j): Point => {
    const t = j / 20
    return [mix(a[0], b[0], t), mix(a[1], b[1], smooth(t)) + Math.sin(t * Math.PI) * bend]
  })
}

export function mapJourney(f: Frame) {
  const { p, cue } = f
  const sceneWidth = f.lane * .96, height = Math.min(f.h * .45, 274 * f.unit)
  const half = sceneWidth / 2, rad = 23 * f.unit
  const clip = [f.y - height / 2 + 2, f.y + height / 2 - 2] as const
  const t = settle(f.advance(320)), arrive = settle(f.advance(150))
  const start = wayPoint(Math.max(0, cue.index - 1)), end = wayPoint(cue.index)
  const cam = Math.max(1 - f.motion, Math.min(1, t))
  const ax = mix(start[0], end[0], cam), ay = mix(start[1], end[1], cam)
  const px = -Math.min(100 * f.unit, half * .20), py = f.y - 35 * f.unit
  const project = ([x, y]: Point): Point => [(x - ax) * f.unit + px, (y - ay) * f.unit + py]
  p.card(0, f.y, sceneWidth, height, '#122c32', { radius: rad, accent: '#546e64', fill: .81, border: 1.2, sheen: .77, opacity: .92 })
  const worldX = (half - 10 * f.unit) / f.unit
  const xmin = ax - worldX - px / f.unit, xmax = ax + worldX - px / f.unit
  const yMin = ay - height * .49 / f.unit + (f.y - py) / f.unit
  const yMax = ay + height * .49 / f.unit + (f.y - py) / f.unit
  const major = f.low ? 53 : 34
  for (let r = Math.floor(yMin / major); r <= Math.ceil(yMax / major); r++) {
    const points = Array.from({ length: 39 }, (_, k): Point => {
      const x = mix(xmin, xmax, k / 38), v = r * major
      return project([x, v + Math.sin(x * .014 + r * .85) * 18 + Math.sin(x * .04 + r) * 7])
    })
    const color = r % 3 ? '#bdc4a9' : '#ead6af'
    p.path(points, color, r % 3 ? 1.05 : 2.0, { clip, opacity: r % 3 ? .24 : .46 })
  }
  for (let col = Math.floor(xmin / 47); col <= Math.ceil(xmax / 47); col++) {
    if (f.low && col % 2) continue
    const road = Array.from({ length: 26 }, (_, k): Point => {
      const y = mix(yMin, yMax, k / 25), x = col * 47 + Math.sin(y * .017 + col) * 17 + y * .25
      return project([clamp(x, xmin, xmax), y])
    })
    p.path(road, '#bbc2ac', col % 3 ? 1 : 1.5, { clip, opacity: col % 3 ? .29 : .42 })
  }
  const water = Array.from({ length: 50 }, (_, k): Point => {
    const x = mix(xmin, xmax, k / 49)
    return project([x, -45 + Math.sin(x * .009) * 38 + Math.cos(x * .017) * 8])
  })
  p.path(water, '#527f83', 18 * f.unit, { clip, opacity: .67 })
  p.path(water, '#81a9a2', 1.2, { clip, opacity: .54 })
  const through = Math.min(6, cue.index + 2)
  for (let j = through; j >= 0; j--) {
    const index = cue.index + 1 - j
    if (index < 0) continue
    const shape = routeSegment(index).map(project).map(([x, y]): Point => [clamp(x, -half + 13 * f.unit, half - 13 * f.unit), y])
    p.path(shape, '#101c2c', index < cue.index ? 5 : 1.5, { clip, opacity: .8 })
    p.path(shape, index < cue.index ? '#f0bb86' : '#aad1b7', index < cue.index ? 2.35 : 1.1,
      { clip, opacity: index === cue.index - 1 ? .97 : index < cue.index ? .68 : .36 }, index === cue.index - 1 ? Math.max(.08, t) : 1)
    if (index < cue.index) {
      const [x, y] = project(wayPoint(index))
      if (Math.abs(x) < half - 18 * f.unit) f.circle(x, y, 3.5 * f.unit, '#f7c390', { clip, opacity: .6 })
    }
  }
  const [x, y] = project(end)
  const pin = 9 * f.unit
  f.circle(x, y, pin * (1 + (1 - arrive) * f.motion * .62), '#f7bd91', { opacity: .31 + arrive * .22 })
  f.circle(x, y, pin * .56, '#fbd3b5')
  f.circle(x, y, pin * .22, '#503c41')
  const size = Math.min(f.em(32), f.h * .081), padding = 12 * f.unit
  const rowW = sceneWidth * .84
  const rows = f.page(cue, f.rows(cue, size, rowW, f.heavy), 2)
  const width = Math.max(size * 2, ...rows.map(row => row.width)) + padding * 2
  const boxH = rows.length * size * 1.12 + padding * 1.38
  const baseline = f.y + height * .25 - boxH * .19
  const labelX = clamp(px + width * .31 + 8 * f.unit, -half + width / 2 + 8 * f.unit, half - width / 2 - 8 * f.unit)
  p.path([[x, y + pin], [x, baseline - boxH * .45 - 6 * f.unit], [labelX, baseline - boxH * .45 - 6 * f.unit]],
    '#f6d4ab', 1, { clip, opacity: .67 }, Math.max(.30, arrive))
  p.card(labelX, baseline, width, boxH, '#152631', { radius: 7 * f.unit, border: .95, accent: '#608080', sheen: .75, fill: .94 })
  rows.forEach((row, i) => {
    const run = f.atlas.get(row.text, size, f.heavy, f.dpr)
    f.row(cue, row, run, labelX, baseline + (rows.length / 2 - i - .5) * size * 1.12, f.foreground, f.backing, {}, f.heavy, size)
  })
}
