import { Frame, lookupIcon } from './frame'
import type { Point } from './painter'
import { clampBoxToBounds, placeLabels, type LabelCandidate, type LabelRequest, type PlacedLabel, type Rect } from './spatialLayout'
import { clamp, hash, mix, rand, settle, smooth, spring, type Cue, type Token } from './timeline'

const TAU = Math.PI * 2

export interface SampledSpline {
  readonly points: readonly Point[]
  readonly lengths: readonly number[]
  readonly totalLength: number
  readonly anchorArcs: readonly number[]
}

/**
 * Sample a smooth Catmull-Rom cubic spline through anchor points and compute
 * strictly monotonic cumulative Euclidean arc length at every sample and anchor.
 */
export function sampleCubicSpline(anchors: readonly Point[], samplesPerSeg = 16): SampledSpline {
  if (anchors.length === 0) return { points: [], lengths: [], totalLength: 0, anchorArcs: [] }
  if (anchors.length === 1) return { points: [anchors[0]], lengths: [0], totalLength: 0, anchorArcs: [0] }

  const points: Point[] = []
  const lengths: number[] = []
  const anchorArcs: number[] = [0]
  let total = 0

  const get = (idx: number): Point => anchors[clamp(idx, 0, anchors.length - 1)]
  const steps = Math.max(2, samplesPerSeg)

  for (let seg = 0; seg < anchors.length - 1; seg++) {
    const p0 = get(seg - 1)
    const p1 = get(seg)
    const p2 = get(seg + 1)
    const p3 = get(seg + 2)
    const startStep = seg === 0 ? 0 : 1
    for (let s = startStep; s <= steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t
      const x = .5 * (
        (2 * p1[0])
        + (-p0[0] + p2[0]) * t
        + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
        + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
      )
      const y = .5 * (
        (2 * p1[1])
        + (-p0[1] + p2[1]) * t
        + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
        + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
      )
      const pt: Point = [x, y]
      if (points.length > 0) {
        const prev = points[points.length - 1]
        total += Math.hypot(x - prev[0], y - prev[1])
      }
      points.push(pt)
      lengths.push(total)
    }
    anchorArcs.push(total)
  }

  return { points, lengths, totalLength: total, anchorArcs }
}

/** Return prefix polyline and interpolated tip exactly at cumulative `arcDistance`. */
export function sliceSplineByArc(sampled: SampledSpline, arcDistance: number): { points: Point[]; tip: Point } {
  const { points, lengths, totalLength } = sampled
  if (points.length === 0) return { points: [], tip: [0, 0] }
  if (points.length === 1 || totalLength <= 1e-6) return { points: [points[0]], tip: points[0] }
  const target = clamp(arcDistance, 0, totalLength)
  if (target <= 0) return { points: [points[0]], tip: points[0] }
  if (target >= totalLength) return { points: [...points], tip: points[points.length - 1] }

  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prevLen = lengths[i - 1]
    const nextLen = lengths[i]
    if (nextLen < target) {
      out.push(points[i])
      continue
    }
    const segLen = Math.max(1e-6, nextLen - prevLen)
    const u = clamp((target - prevLen) / segLen)
    const tip: Point = [
      mix(points[i - 1][0], points[i][0], u),
      mix(points[i - 1][1], points[i][1], u),
    ]
    out.push(tip)
    return { points: out, tip }
  }
  return { points: out, tip: points[points.length - 1] }
}

function quadCurve(a: Point, ctrl: Point, b: Point, steps = 10): Point[] {
  return Array.from({ length: steps + 1 }, (_, i): Point => {
    const t = i / steps
    const u = 1 - t
    return [
      u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1],
    ]
  })
}

function lineBetween(a: Point, b: Point, n: number, bow: number): Point[] {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.max(1, Math.hypot(dx, dy))
  const nx = -dy / len, ny = dx / len
  return Array.from({ length: n + 1 }, (_, i): Point => {
    const p = i / n
    const arch = Math.sin(Math.PI * p) * bow
    return [mix(a[0], b[0], p) + nx * arch, mix(a[1], b[1], p) + ny * arch]
  })
}

function paged(f: Frame, n: number) {
  const pageStart = Math.floor(f.ti / n) * n
  return f.cue.tokens.slice(pageStart, pageStart + n)
}

function symbolFor(text: string): string | undefined {
  return lookupIcon(text) ? text : text.split(/\s+/u).find(t => lookupIcon(t))
}

function nodeText(f: Frame, token: Token, x: number, y: number, size: number, width: number, live: boolean, opacity: number) {
  const enter = live ? spring(f.advance(128, token.startMs)) : 1
  f.word(
    token.text,
    x,
    y - (1 - enter) * f.motion * size * .20,
    size,
    live ? f.active : f.foreground,
    { opacity, scale: live ? 1 + .045 * f.motion * (1 - enter) : 1 },
    live ? f.heavy : f.medium,
    width,
  )
}

export interface BranchesNodeLayout {
  readonly token: Token
  readonly junction: Point
  readonly endpoint: Point
  readonly twig: readonly Point[]
  readonly junctionArc: number
  readonly sign: number
}

export interface BranchesSceneLayout {
  readonly spine: SampledSpline
  readonly nodes: readonly BranchesNodeLayout[]
  readonly boxW: number
  readonly height: number
}

/**
 * Deterministic spline-and-twig branch layout for a sequence of tokens.
 * Exported for cumulative arc-length monotonicity and endpoint placement tests.
 */
export function layoutBranchesScene(
  tokens: readonly Token[],
  seed: number,
  lane: number,
  heightPx: number,
  centerY: number,
  unit: number,
): BranchesSceneLayout {
  const boxW = lane * .88
  const height = Math.min(heightPx * .22, 130 * unit)
  const n = Math.max(1, tokens.length)
  const anchors: Point[] = [[-boxW * .46, centerY - height * .10]]
  const junctions: Point[] = []

  for (let i = 0; i < tokens.length; i++) {
    const frac = n === 1 ? .55 : i / (n - 1)
    const jx = mix(-boxW * .30, boxW * .38, frac) + (rand(seed, i + 3) - .5) * Math.min(24 * unit, boxW * .04)
    const jy = centerY + Math.sin((i + .6) * 1.18 + (seed % 5) * .7) * height * .23
    const pt: Point = [jx, jy]
    anchors.push(pt)
    junctions.push(pt)
  }
  anchors.push([boxW * .47, centerY + (rand(seed, 99) - .5) * height * .16])

  const spine = sampleCubicSpline(anchors, 16)
  const nodes: BranchesNodeLayout[] = tokens.map((token, i) => {
    const j = junctions[i]
    const sign = ((i + (seed & 1)) % 2 === 0) ? 1 : -1
    const spreadX = (rand(seed, i + 23) - .35) * Math.min(34 * unit, boxW * .11)
    const reachY = sign * height * (.52 + rand(seed, i + 71) * .26)
    const endpoint: Point = [
      clamp(j[0] + spreadX, -boxW * .44, boxW * .44),
      j[1] + reachY,
    ]
    const ctrl: Point = [
      mix(j[0], endpoint[0], .38) + (i % 2 === 0 ? -10 : 10) * unit,
      mix(j[1], endpoint[1], .66),
    ]
    const twig = quadCurve(j, ctrl, endpoint, 10)
    return {
      token,
      junction: j,
      endpoint,
      twig,
      junctionArc: spine.anchorArcs[i + 1] ?? spine.totalLength,
      sign,
    }
  })

  return { spine, nodes, boxW, height }
}

/** Evaluate monotonic advancing spline arc length across tokens in Branches. */
export function evalBranchesArc(
  layout: BranchesSceneLayout,
  timeMs: number,
  speed: number,
  quiet: boolean,
): number {
  const { spine, nodes } = layout
  if (!nodes.length) return 0
  let reached = -1
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].token.startMs <= timeMs) reached = i
    else break
  }
  if (reached < 0) {
    const first = nodes[0]
    const lead = Math.min(180 / speed, Math.max(80, first.token.endMs - first.token.startMs))
    const p = quiet ? 0 : smooth(clamp((timeMs - (first.token.startMs - lead)) / Math.max(1, lead)))
    return mix(0, first.junctionArc, p)
  }
  const curr = nodes[reached]
  const nextArc = reached + 1 < nodes.length ? nodes[reached + 1].junctionArc : spine.totalLength
  if (quiet) return curr.junctionArc
  const span = Math.max(120, (nodes[reached + 1]?.token.startMs ?? curr.token.endMs) - curr.token.startMs)
  const prog = smooth(clamp((timeMs - curr.token.startMs) / Math.max(1, span / speed)))
  return mix(curr.junctionArc, nextArc, prog * .78)
}

export function branches(f: Frame) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const tokens = paged(f, f.w > 640 ? 7 : 5)
  if (!tokens.length) return
  const seed = hash(f.cue.text)
  const size = Math.min(f.em(28), f.h * .088)
  const layout = layoutBranchesScene(tokens, seed, f.lane, f.h, f.y - 6 * f.unit, f.unit)
  const tipArc = evalBranchesArc(layout, f.time, f.speed, f.quiet)
  const activeSlice = sliceSplineByArc(layout.spine, tipArc)

  // Subtle unrevealed guide backbone + bright advancing spine to live tip
  p.path(layout.spine.points, f.muted, 1.0, { opacity: .16 })
  if (activeSlice.points.length >= 2) {
    p.path(activeSlice.points, '#c4e0cd', 2.2, { opacity: .90 })
  }

  // Advancing glowing tip marker
  const [tipX, tipY] = activeSlice.tip
  f.circle(tipX, tipY, 6.2 * f.unit, '#c4e0cd', { opacity: .24 })
  f.circle(tipX, tipY, 2.8 * f.unit, '#f7fff9', { opacity: .98 })

  const obstacles: Rect[] = []
  for (let i = 0; i < layout.spine.points.length; i += 4) {
    const pt = layout.spine.points[i]
    obstacles.push({ x: pt[0], y: pt[1], w: 12 * f.unit, h: 12 * f.unit })
  }

  const labelRequests: LabelRequest[] = []
  const nodeStates: { node: BranchesNodeLayout; live: boolean; seen: boolean; twigFrac: number; fontSize: number; maxW: number; icon?: string }[] = []

  layout.nodes.forEach((node, i) => {
    const live = node.token === f.token
    const seen = f.time >= node.token.startMs
    if (!seen && !live && f.time < node.token.startMs - 80) return

    const twigFrac = f.quiet ? Number(seen) : settle(f.advance(170, node.token.startMs - 40))
    const twigOpacity = live ? .92 : seen ? .58 : .25
    const twigColor = live ? f.backing : '#a9c4b4'
    p.path(node.twig, f.muted, .85, { opacity: .14 })
    p.path(node.twig, twigColor, live ? 1.75 : 1.1, { opacity: twigOpacity }, Math.max(.12, twigFrac))

    // Junction & endpoint pinpoints
    f.circle(node.junction[0], node.junction[1], (live ? 3.2 : 2.1) * f.unit, live ? f.backing : '#b9d4c4', { opacity: live ? .96 : .72 })
    if (twigFrac > .85) {
      f.circle(node.endpoint[0], node.endpoint[1], (live ? 3.6 : 2.0) * f.unit, live ? f.backing : '#ddeae2', { opacity: live ? 1 : .78 })
    }
    obstacles.push({ x: node.endpoint[0], y: node.endpoint[1], w: 12 * f.unit, h: 12 * f.unit })

    const fontSize = size * (live ? 1.04 : .68)
    const maxW = tokens.length === 1 ? layout.boxW * .88 : Math.max(70 * f.unit, (layout.boxW / Math.max(2, tokens.length)) * (live ? 1.55 : 1.15))
    const textW = Math.min(maxW, f.atlas.width(node.token.text, fontSize, live ? f.heavy : f.medium))
    const icon = symbolFor(node.token.text)
    const iconPad = icon ? fontSize * .85 : 0
    const labelW = textW + iconPad
    const labelH = fontSize * 1.16

    const dyBase = node.sign * (labelH * .58 + 7 * f.unit)
    const candidates: LabelCandidate[] = [
      { dx: 0, dy: dyBase, penalty: 0 },
      { dx: labelW * .26, dy: dyBase, penalty: 4 },
      { dx: -labelW * .26, dy: dyBase, penalty: 4 },
      { dx: (node.endpoint[0] < 0 ? -1 : 1) * (labelW * .42 + 8 * f.unit), dy: node.sign * labelH * .28, penalty: 9 },
      { dx: 0, dy: dyBase + node.sign * labelH * .65, penalty: 14 },
      { dx: 0, dy: -dyBase, penalty: 24 },
    ]

    labelRequests.push({
      id: `br:${i}`,
      anchorX: node.endpoint[0],
      anchorY: node.endpoint[1],
      w: labelW,
      h: labelH,
      priority: live ? 3 : 1 - i * .04,
      candidates,
      allowShrink: !live,
    })
    nodeStates.push({ node, live, seen, twigFrac, fontSize, maxW, icon })
  })

  const bounds: Rect = { x: 0, y: f.y, w: f.lane * .94, h: f.h * .72 }
  const placed = placeLabels(labelRequests, obstacles, bounds, 6 * f.unit)

  nodeStates.forEach((st, idx) => {
    const pos = placed[idx]
    if (!pos || !pos.visible) return
    const opacity = st.live ? 1 : st.seen ? .62 : .24
    const drawSize = st.fontSize * pos.scale
    const iconSize = st.icon ? drawSize * .72 : 0
    const textX = st.icon ? pos.x + iconSize * .44 : pos.x
    nodeText(f, st.node.token, textX, pos.y, drawSize, st.maxW * pos.scale, st.live, opacity)
    if (st.icon) {
      const tw = Math.min(st.maxW * pos.scale, f.atlas.width(st.node.token.text, drawSize, st.live ? f.heavy : f.medium))
      f.icon(st.icon, textX - tw * .5 - iconSize * .66, pos.y, iconSize, st.live ? f.backing : '#d7e6dd', Math.max(.2, st.twigFrac), opacity * .92)
    }
  })
}

export interface WebPlacedNode {
  readonly token: Token
  readonly knot: Point
  readonly rayIdx: number
  readonly live: boolean
  readonly seen: boolean
  readonly fontSize: number
  readonly maxW: number
  readonly label: PlacedLabel
}

export interface WebSceneLayout {
  readonly hub: Point
  readonly hubRadius: number
  readonly hubObstacle: Rect
  readonly rays: readonly Point[]
  readonly rings: readonly (readonly Point[])[]
  readonly nodes: readonly WebPlacedNode[]
  readonly activeIndex: number
}

/**
 * Deterministic asymmetric partial radial web + central hub obstacle exclusion
 * and non-overlapping label resolution via `placeLabels`.
 */
export function layoutWebScene(
  tokens: readonly Token[],
  activeToken: Token | undefined,
  timeMs: number,
  seed: number,
  lane: number,
  heightPx: number,
  centerY: number,
  unit: number,
  measureText: (text: string, size: number, live: boolean) => number,
  size: number,
  lowDetail = false,
): WebSceneLayout {
  const rx = lane * .34
  const ry = Math.min(heightPx * .22, 148 * unit)
  const hubRadius = clamp(Math.min(lane * .062, heightPx * .072), 20 * unit, 44 * unit)
  const hub: Point = [lane * .03, centerY + 2 * unit]
  const hubObstacle: Rect = {
    x: hub[0],
    y: hub[1],
    w: hubRadius * 2.25,
    h: hubRadius * 2.25,
  }

  // Asymmetric partial sector (never a full 360-degree radar circle)
  const rayCount = 8
  const sectorStart = .42 * Math.PI + rand(seed, 2) * .28
  const sectorSpan = 1.46 * Math.PI
  const rays: Point[] = Array.from({ length: rayCount }, (_, i): Point => {
    const a = sectorStart + (i / (rayCount - 1)) * sectorSpan
    const rScale = .78 + rand(seed, i + 9) * .30
    return [
      hub[0] + Math.cos(a) * rx * rScale,
      hub[1] + Math.sin(a) * ry * rScale,
    ]
  })

  const ringRadii = lowDetail ? [.46, .82] : [.30, .54, .76, .96]
  const rings: Point[][] = ringRadii.map((scale, rIdx) => {
    const pts: Point[] = []
    for (let i = 0; i < rays.length - 1; i++) {
      const a: Point = [mix(hub[0], rays[i][0], scale), mix(hub[1], rays[i][1], scale)]
      const b: Point = [mix(hub[0], rays[i + 1][0], scale), mix(hub[1], rays[i + 1][1], scale)]
      const mid: Point = [mix(a[0], b[0], .5), mix(a[1], b[1], .5)]
      // Pull chord gently inward toward hub for authentic tensioned web arc
      const sag = mix(mid[0], hub[0], .16 + rIdx * .01)
      const sagY = mix(mid[1], hub[1], .16 + rIdx * .01)
      const seg = quadCurve(a, [sag, sagY], b, 6)
      pts.push(...(i === 0 ? seg : seg.slice(1)))
    }
    return pts
  })

  // Spread tokens cleanly across distinct rays and radial rings
  const knotMap: { token: Token; knot: Point; rayIdx: number; live: boolean; seen: boolean }[] = []
  let activeIndex = -1
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const live = token === activeToken
    const seen = timeMs >= token.startMs
    if (live) activeIndex = i
    if (!seen && !live && timeMs < token.startMs - 80) continue
    const rayIdx = Math.min(rayCount - 1, Math.round((i / Math.max(1, tokens.length - 1)) * (rayCount - 1)))
    const ringTier = tokens.length === 1 ? .65 : [.52, .86, .42, .94, .66, .78][i % 6]
    const rayTip = rays[rayIdx]
    const knot: Point = [
      mix(hub[0], rayTip[0], ringTier),
      mix(hub[1], rayTip[1], ringTier),
    ]
    knotMap.push({ token, knot, rayIdx, live, seen })
  }

  const obstacles: Rect[] = [
    hubObstacle,
    ...knotMap.map(k => ({ x: k.knot[0], y: k.knot[1], w: 12 * unit, h: 12 * unit })),
  ]
  const requests: LabelRequest[] = knotMap.map((k, idx) => {
    const fontSize = size * (k.live ? 1.04 : .72)
    const maxW = tokens.length === 1 ? lane * .75 : lane * (k.live ? .36 : .28)
    const w = Math.min(maxW, measureText(k.token.text, fontSize, k.live))
    const h = fontSize * 1.18
    const dxOut = k.knot[0] - hub[0]
    const dyOut = k.knot[1] - hub[1]
    const distOut = Math.max(1, Math.hypot(dxOut, dyOut))
    const ux = dxOut / distOut, uy = dyOut / distOut
    const tx = -uy, ty = ux
    const push = h * .64 + 10 * unit
    const candidates: LabelCandidate[] = [
      { dx: ux * push, dy: uy * push, penalty: 0 },
      { dx: ux * (push + h * .4), dy: uy * (push + h * .4), penalty: 4 },
      { dx: tx * (w * .34 + push * .5), dy: ty * (h * .8 + 6 * unit), penalty: 6 },
      { dx: -tx * (w * .34 + push * .5), dy: -ty * (h * .8 + 6 * unit), penalty: 6 },
      { dx: 0, dy: dyOut >= 0 ? push : -push, penalty: 8 },
      { dx: (dxOut >= 0 ? 1 : -1) * (w * .45 + 14 * unit), dy: 0, penalty: 10 },
      { dx: 0, dy: dyOut >= 0 ? -push : push, penalty: 18 },
      { dx: ux * (push + h * .95), dy: uy * (push + h * .95), penalty: 20 },
    ]
    return {
      id: `web:${idx}`,
      anchorX: k.knot[0],
      anchorY: k.knot[1],
      w,
      h,
      priority: k.live ? 3 : 1 - idx * .03,
      candidates,
      allowShrink: !k.live,
    }
  })

  const bounds: Rect = { x: 0, y: centerY, w: lane * .92, h: heightPx * .70 }
  const placed = placeLabels(requests, obstacles, bounds, 8 * unit)
  const nodes: WebPlacedNode[] = knotMap.map((k, idx) => ({
    token: k.token,
    knot: k.knot,
    rayIdx: k.rayIdx,
    live: k.live,
    seen: k.seen,
    fontSize: size * (k.live ? 1.04 : .72),
    maxW: tokens.length === 1 ? lane * .75 : lane * (k.live ? .36 : .28),
    label: placed[idx],
  }))

  return { hub, hubRadius, hubObstacle, rays, rings, nodes, activeIndex }
}

function drawHubMotif(f: Frame, [cx, cy]: Point, r: number) {
  const { p } = f
  // Central faceted weaver crest (body + inner highlight + 6 articulated geometric arms)
  p.card(cx, cy, r * .62, r * .84, '#e6e8ef', { radius: r * .28, accent: '#ffffff', sheen: .72, opacity: .94 })
  p.card(cx, cy - r * .36, r * .36, r * .36, '#f6f7fb', { radius: r * .18, opacity: .96 })
  const arms: Point[][] = [
    [[cx - r * .22, cy - r * .24], [cx - r * .68, cy - r * .52], [cx - r * .92, cy - r * .20]],
    [[cx - r * .26, cy - r * .04], [cx - r * .78, cy - r * .10], [cx - r * 1.02, cy + r * .30]],
    [[cx - r * .22, cy + r * .16], [cx - r * .64, cy + r * .46], [cx - r * .76, cy + r * .92]],
    [[cx + r * .22, cy - r * .24], [cx + r * .68, cy - r * .52], [cx + r * .92, cy - r * .20]],
    [[cx + r * .26, cy - r * .04], [cx + r * .78, cy - r * .10], [cx + r * 1.02, cy + r * .30]],
    [[cx + r * .22, cy + r * .16], [cx + r * .64, cy + r * .46], [cx + r * .76, cy + r * .92]],
  ]
  for (const arm of arms) {
    p.path(arm, '#f2f4fa', Math.max(1.4, r * .065), { opacity: .88 })
  }
}

export function web(f: Frame) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const tokens = paged(f, 6)
  if (!tokens.length) return
  const seed = hash(f.cue.text)
  const size = Math.min(f.em(29), f.h * .082)
  const layout = layoutWebScene(
    tokens,
    f.token,
    f.time,
    seed,
    f.lane,
    f.h,
    f.y,
    f.unit,
    (text, s, live) => f.atlas.width(text, s, live ? f.heavy : f.medium),
    size,
    f.low,
  )

  // Draw nonuniform radial spokes & concave web rings (no panel-wide rotation)
  for (const tip of layout.rays) {
    p.path([layout.hub, tip], f.muted, .9, { opacity: .26 })
  }
  layout.rings.forEach((ring, n) => {
    p.path(ring, n === layout.rings.length - 1 ? '#d0c4bc' : f.muted, n ? .95 : .75, { opacity: .16 + n * .055 })
  })

  // Draw traversing active strand & knot anchors
  layout.nodes.forEach((node, idx) => {
    const prevAnchor: Point = idx > 0 ? layout.nodes[idx - 1].knot : layout.hub
    const prog = node.live ? settle(f.advance(160, node.token.startMs)) : 1
    const bow = node.live ? (1 - prog) * (idx % 2 ? 1 : -1) * 14 * f.unit * f.motion : 0
    const strand = lineBetween(prevAnchor, node.knot, 12, bow)
    p.path(strand, node.live ? f.backing : '#c9d7ee', node.live ? 2.1 : 1.05, { opacity: node.live ? .92 : .42 }, node.live ? Math.max(.22, prog) : 1)
    if (node.live) f.circle(node.knot[0], node.knot[1], 7.5 * f.unit, f.backing, { opacity: .24 })
    f.circle(node.knot[0], node.knot[1], (node.live ? 3.8 : 2.2) * f.unit, node.live ? f.backing : '#e4ebf8', { opacity: node.live ? 1 : .66 })
  })

  // Draw dominant sculptural hub above backdrop strands
  drawHubMotif(f, layout.hub, layout.hubRadius)

  // Draw decluttered labels (settled active white foreground + quiet history)
  layout.nodes
    .slice()
    .sort((a, b) => Number(a.live) - Number(b.live))
    .forEach(node => {
      if (!node.label.visible) return
      const drawSize = node.fontSize * node.label.scale
      if (node.live && f.overlay) {
        const w = Math.min(node.maxW * node.label.scale, f.atlas.width(node.token.text, drawSize, f.heavy))
        p.card(node.label.x, node.label.y, w + 14 * f.unit, drawSize * 1.16, '#151926', {
          accent: '#4a556e', opacity: .82, radius: 7 * f.unit, border: .8,
        })
      }
      const opacity = node.live ? 1 : node.seen ? .56 : .24
      nodeText(f, node.token, node.label.x, node.label.y, drawSize, node.maxW * node.label.scale, node.live, opacity)
    })
}

export interface ConstellationStarNode {
  readonly id: string
  readonly cueIndex: number
  readonly token: Token
  readonly x: number
  readonly y: number
}

export interface ConstellationCluster {
  readonly cues: readonly Cue[]
  readonly nodes: readonly ConstellationStarNode[]
}

const CONSTELLATION_OFFSETS = [.42, .85, -.38, -.82, .64, -.18, .92, -.68, .25, -.54, .78]

/**
 * Partition contiguous timed cues into fixed star clusters (up to 3 cues or 11 stars),
 * keeping every already-visible star coordinate invariant across new cues inside the cluster.
 */
export function buildConstellationCluster(
  cues: readonly Cue[],
  activeCueIndex: number,
  lane: number,
  heightPx: number,
  centerY: number,
  unit: number,
): ConstellationCluster {
  const maxStars = lane < 520 ? 7 : 11
  let start = 0
  while (start < cues.length) {
    let count = 0
    let end = start
    while (end < cues.length && end - start < 3) {
      const c = cues[end]
      if (c.rtl || c.mixed || !c.timed) {
        if (end === start) end++
        break
      }
      if (end > start) {
        const prev = cues[end - 1]
        if (c.startMs - prev.endMs > 1650 || count + c.tokens.length > maxStars) break
      }
      count += c.tokens.length
      end++
    }
    if (activeCueIndex < end) {
      const slice = cues.slice(start, end)
      const clusterSeed = hash(`${slice[0].id}:${slice[0].text}`)
      const rx = lane * .38
      const ry = Math.min(heightPx * .22, 136 * unit)
      const allTokens: { cueIndex: number; token: Token }[] = []
      for (const c of slice) for (const t of c.tokens) allTokens.push({ cueIndex: c.index, token: t })
      const n = Math.max(1, allTokens.length)
      const nodes: ConstellationStarNode[] = []
      const rotIdx = clusterSeed % CONSTELLATION_OFFSETS.length
      for (let i = 0; i < allTokens.length; i++) {
        const { cueIndex, token } = allTokens[i]
        if (n === 1) {
          nodes.push({ id: token.id, cueIndex, token, x: 0, y: centerY })
          continue
        }
        const s = i / (n - 1)
        const baseX = mix(-rx * .86, rx * .92, s) + (rand(clusterSeed, i) - .5) * (rx * 1.9 / n)
        const band = CONSTELLATION_OFFSETS[(i + rotIdx) % CONSTELLATION_OFFSETS.length]
        const jitterY = (rand(clusterSeed, i + 17) - .5) * .28
        let x = clamp(baseX, -rx, rx)
        let y = centerY + clamp(band + jitterY, -1, 1) * ry
        // Push gently away from prior stars so constellation dots stay distinct
        for (let iter = 0; iter < 5; iter++) {
          for (const prev of nodes) {
            const dx = x - prev.x, dy = y - prev.y
            const d = Math.hypot(dx, dy)
            const minD = 42 * unit
            if (d < minD) {
              const push = (minD - d) * .65
              const angle = d > .01 ? Math.atan2(dy, dx) : (i % 2 ? 1.2 : -1.2)
              x = clamp(x + Math.cos(angle) * push, -rx, rx)
              y = clamp(y + Math.sin(angle) * push, centerY - ry, centerY + ry)
            }
          }
        }
        nodes.push({ id: token.id, cueIndex, token, x, y })
      }
      return { cues: slice, nodes }
    }
    start = end
  }
  return { cues: [], nodes: [] }
}

const sky = Array.from({ length: 16 }, (_, i) => [rand(0x7024, i), rand(0x7024, i + 89), rand(0x7024, i + 171)] as const)

export function constellation(f: Frame) {
  const { p } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const rx = f.lane * .40, ry = Math.min(f.h * .22, 138 * f.unit)
  const size = Math.min(f.em(26), f.h * .082)

  // Sparse stationary ambient sky pinpoints
  if (!f.overlay) {
    sky.slice(0, f.low ? 8 : 14).forEach(([sx, sy, mag], i) => {
      f.circle((sx - .5) * rx * 2.5, f.y + (sy - .5) * ry * 2.6, (.65 + mag * .8) * f.unit,
        i % 4 ? '#c7d6f8' : '#f8ca9f', { opacity: .07 + mag * .07 })
    })
  }

  const cluster = buildConstellationCluster(f.cues, f.cue.index, f.lane, f.h, f.y, f.unit)
  if (!cluster.nodes.length) return

  // Visible revealed subset in current cluster
  const visibleNodes = cluster.nodes.filter(n => n.token === f.token || f.time >= n.token.startMs - 60)

  // Connecting constellation edges between consecutive stars
  for (let i = 1; i < visibleNodes.length; i++) {
    const a = visibleNodes[i - 1], b = visibleNodes[i]
    const q = f.quiet ? Number(f.time >= b.token.startMs) : smooth(f.advance(160, b.token.startMs - 80))
    const liveEdge = b.token === f.token
    const ageFade = b.cueIndex < f.cue.index ? .34 : .64
    p.path([[a.x, a.y], [b.x, b.y]], f.muted, .7, { opacity: .14 })
    p.path([[a.x, a.y], [b.x, b.y]], liveEdge ? '#f0c6b8' : '#a8bee4', liveEdge ? 1.65 : .95, { opacity: liveEdge ? .84 : ageFade }, Math.max(.08, q))
  }

  // Stars & active flare
  const obstacles: Rect[] = []
  const labelRequests: LabelRequest[] = []
  const labelMeta: { node: ConstellationStarNode; live: boolean; seen: boolean; cueAge: number; fontSize: number; maxW: number }[] = []

  visibleNodes.forEach((node, idx) => {
    const live = node.token === f.token
    const seen = f.time >= node.token.startMs
    const cueAge = Math.max(0, f.cue.index - node.cueIndex)
    const mode = live ? f.backing : '#dfebff'
    const age = settle(f.advance(135, node.token.startMs))

    if (live && !f.quiet) {
      const flare = (7.5 + 9 * (1 - age) * f.motion) * f.unit
      f.circle(node.x, node.y, flare, f.backing, { opacity: .13 })
      p.path([[node.x - flare, node.y], [node.x + flare, node.y]], mode, .95, { opacity: .68 })
      p.path([[node.x, node.y - flare], [node.x, node.y + flare]], mode, .9, { opacity: .68 })
    }
    const starR = (live ? 3.5 : cueAge === 0 ? 2.2 : 1.75) * f.unit
    f.circle(node.x, node.y, starR, mode, { opacity: live ? 1 : seen ? (cueAge === 0 ? .84 : .58) : .36 })
    obstacles.push({ x: node.x, y: node.y, w: 12 * f.unit, h: 12 * f.unit })

    // Fade history labels earlier than star dots (Verci-style persistent star chart)
    const labelOpacity = live ? 1 : cueAge === 0 ? (seen ? .66 : .28) : (cueAge === 1 ? .26 : .11)
    if (labelOpacity <= .12) return

    const fontSize = size * (live ? 1.10 : cueAge === 0 ? .76 : .64)
    const maxW = visibleNodes.length === 1 ? f.lane * .80 : Math.max(68 * f.unit, rx * .46)
    const w = Math.min(maxW, f.atlas.width(node.token.text, fontSize, live ? f.heavy : f.medium))
    const h = fontSize * 1.15
    const prefSign = node.y < f.y ? -1 : 1
    const dyPref = prefSign * (h * .62 + 6 * f.unit)
    const candidates: LabelCandidate[] = [
      { dx: 0, dy: dyPref, penalty: 0 },
      { dx: 0, dy: -dyPref, penalty: 4 },
      { dx: w * .38 + 8 * f.unit, dy: 0, penalty: 6 },
      { dx: -(w * .38 + 8 * f.unit), dy: 0, penalty: 6 },
      { dx: w * .28, dy: dyPref, penalty: 8 },
      { dx: -w * .28, dy: dyPref, penalty: 8 },
    ]
    labelRequests.push({
      id: `con:${idx}`,
      anchorX: node.x,
      anchorY: node.y,
      w,
      h,
      priority: live ? 3 : cueAge === 0 ? 1.2 - idx * .02 : .35 - idx * .02,
      candidates,
      allowShrink: !live,
    })
    labelMeta.push({ node, live, seen, cueAge, fontSize, maxW })
  })

  const bounds: Rect = { x: 0, y: f.y, w: f.lane * .94, h: f.h * .70 }
  const placed = placeLabels(labelRequests, obstacles, bounds, 5 * f.unit)
  labelMeta.forEach((m, idx) => {
    const pos = placed[idx]
    if (!pos || !pos.visible) return
    const opacity = m.live ? 1 : m.cueAge === 0 ? (m.seen ? .66 : .28) : (m.cueAge === 1 ? .26 : .11)
    nodeText(f, m.node.token, pos.x, pos.y, m.fontSize * pos.scale, m.maxW * pos.scale, m.live, opacity)
  })
}

// Map Journey cached route splines & roads
function wayPoint(i: number): Point {
  return [i * 92 + 14 * Math.sin(i * 2.4), 42 * Math.sin(i * .82) + 30 * Math.sin(i * 1.87)]
}

const routeCache = new Map<number, SampledSpline>()
function routeSegmentSpline(i: number): SampledSpline {
  const cached = routeCache.get(i)
  if (cached) return cached
  const a = wayPoint(i), b = wayPoint(i + 1)
  const midX = mix(a[0], b[0], .5)
  const midY = mix(a[1], b[1], .5) + 19 * Math.cos(i * 2.3)
  const sampled = sampleCubicSpline([wayPoint(i - 1), a, [midX, midY], b, wayPoint(i + 2)], 12)
  // Slice specifically between anchors[1] (a) and anchors[3] (b)
  const startIdx = 12
  const endIdx = 36
  const segPts = sampled.points.slice(startIdx, endIdx + 1)
  const baseLen = sampled.lengths[startIdx]
  const segLens = sampled.lengths.slice(startIdx, endIdx + 1).map(l => l - baseLen)
  const out: SampledSpline = {
    points: segPts,
    lengths: segLens,
    totalLength: segLens[segLens.length - 1] ?? 0,
    anchorArcs: [0, segLens[segLens.length - 1] ?? 0],
  }
  if (routeCache.size > 64) routeCache.clear()
  routeCache.set(i, out)
  return out
}

export function mapJourney(f: Frame) {
  const { p, cue } = f
  p.root.rotation.set(0, 0, 0)
  p.root.position.set(0, 0, 0)

  const sceneWidth = f.lane * .96, height = Math.min(f.h * .45, 274 * f.unit)
  const half = sceneWidth / 2, rad = 23 * f.unit
  const clip = [f.y - height / 2 + 2, f.y + height / 2 - 2] as const
  const t = f.quiet ? 1 : smooth(f.advance(340))
  const arrive = f.quiet ? 1 : settle(f.advance(160))

  const activeSpline = cue.index > 0 ? routeSegmentSpline(cue.index - 1) : undefined
  const activeSlice = activeSpline ? sliceSplineByArc(activeSpline, activeSpline.totalLength * t) : undefined
  const activePos = activeSlice ? activeSlice.tip : wayPoint(cue.index)
  const end = wayPoint(cue.index)
  const camPos = f.quiet ? end : activePos

  const ax = camPos[0], ay = camPos[1]
  const px = -Math.min(96 * f.unit, half * .18), py = f.y - 34 * f.unit
  const project = ([x, y]: Point): Point => [(x - ax) * f.unit + px, (y - ay) * f.unit + py]
  const clampScreen = ([x, y]: Point): Point => [clamp(x, -half + 12 * f.unit, half - 12 * f.unit), y]

  p.card(0, f.y, sceneWidth, height, '#122c32', { radius: rad, accent: '#546e64', fill: .81, border: 1.2, sheen: .77, opacity: .92 })

  const worldX = (half - 10 * f.unit) / f.unit
  const xmin = ax - worldX - px / f.unit, xmax = ax + worldX - px / f.unit
  const yMin = ay - height * .49 / f.unit + (f.y - py) / f.unit
  const yMax = ay + height * .49 / f.unit + (f.y - py) / f.unit
  const major = f.low ? 53 : 34
  for (let r = Math.floor(yMin / major); r <= Math.ceil(yMax / major); r++) {
    const points = Array.from({ length: 34 }, (_, k): Point => {
      const x = mix(xmin, xmax, k / 33), v = r * major
      return project([x, v + Math.sin(x * .014 + r * .85) * 18 + Math.sin(x * .04 + r) * 7])
    })
    const color = r % 3 ? '#bdc4a9' : '#ead6af'
    p.path(points, color, r % 3 ? 1.05 : 2.0, { clip, opacity: r % 3 ? .22 : .42 })
  }
  for (let col = Math.floor(xmin / 47); col <= Math.ceil(xmax / 47); col++) {
    if (f.low && col % 2) continue
    const road = Array.from({ length: 22 }, (_, k): Point => {
      const y = mix(yMin, yMax, k / 21), x = col * 47 + Math.sin(y * .017 + col) * 17 + y * .25
      return project([clamp(x, xmin, xmax), y])
    })
    p.path(road, '#bbc2ac', col % 3 ? 1 : 1.5, { clip, opacity: col % 3 ? .26 : .39 })
  }

  const water = Array.from({ length: 44 }, (_, k): Point => {
    const x = mix(xmin, xmax, k / 43)
    return project([x, -45 + Math.sin(x * .009) * 38 + Math.cos(x * .017) * 8])
  })
  p.path(water, '#527f83', 18 * f.unit, { clip, opacity: .65 })
  p.path(water, '#81a9a2', 1.2, { clip, opacity: .52 })

  const through = Math.min(6, cue.index + 2)
  for (let j = through; j >= 0; j--) {
    const index = cue.index + 1 - j
    if (index < 0) continue
    const spline = routeSegmentSpline(index)
    const fullScreen = spline.points.map(project).map(clampScreen)
    p.path(fullScreen, '#101c2c', index < cue.index ? 4.8 : 1.5, { clip, opacity: .78 })
    if (index === cue.index - 1 && activeSlice) {
      const traveledScreen = activeSlice.points.map(project).map(clampScreen)
      if (traveledScreen.length >= 2) p.path(traveledScreen, '#f0bb86', 2.45, { clip, opacity: .98 })
      p.path(fullScreen, '#aad1b7', 1.1, { clip, opacity: .28 })
    } else {
      p.path(fullScreen, index < cue.index ? '#f0bb86' : '#aad1b7', index < cue.index ? 2.2 : 1.1, {
        clip,
        opacity: index < cue.index ? .68 : .34,
      })
    }
    if (index < cue.index) {
      const [wx, wy] = project(wayPoint(index))
      if (Math.abs(wx) < half - 18 * f.unit) f.circle(wx, wy, 3.4 * f.unit, '#f7c390', { clip, opacity: .60 })
    }
  }

  // Destination pin & moving traveler dot
  const [pinX, pinY] = project(end)
  const [travX, travY] = project(camPos)
  const pin = 9 * f.unit
  if (!f.quiet && t < .98) {
    f.circle(travX, travY, 4.5 * f.unit, '#fbd3b5', { clip, opacity: .92 })
  }
  f.circle(pinX, pinY, pin * (1 + (1 - arrive) * f.motion * .60), '#f7bd91', { clip, opacity: .30 + arrive * .22 })
  f.circle(pinX, pinY, pin * .56, '#fbd3b5', { clip })
  f.circle(pinX, pinY, pin * .22, '#503c41', { clip })

  // Occlusion-aware route label card placement inside map plate bounds
  const size = Math.min(f.em(30), f.h * .079), padding = 12 * f.unit
  const rowW = sceneWidth * .82
  const rows = f.page(cue, f.rows(cue, size, rowW, f.heavy), 2)
  const width = Math.max(size * 2, ...rows.map(row => row.width)) + padding * 2
  const boxH = rows.length * size * 1.12 + padding * 1.38
  const cardBounds: Rect = { x: 0, y: f.y, w: sceneWidth - 16 * f.unit, h: height - 16 * f.unit }
  const pinObs: Rect = { x: pinX, y: pinY, w: pin * 2.8, h: pin * 2.8 }
  const [placedCard] = placeLabels(
    [{
      id: 'map:card',
      anchorX: px + width * .24,
      anchorY: f.y + height * .25,
      w: width,
      h: boxH,
      priority: 3,
      candidates: [
        { dx: 0, dy: 0, penalty: 0 },
        { dx: 0, dy: height * .08, penalty: 2 },
        { dx: -width * .35, dy: 0, penalty: 4 },
        { dx: width * .3, dy: 0, penalty: 4 },
        { dx: 0, dy: -height * .46, penalty: 8 },
      ],
      allowShrink: false,
    }],
    [pinObs],
    cardBounds,
    8 * f.unit,
  )
  const [labelX, baseline] = clampBoxToBounds(placedCard.x, placedCard.y, width, boxH, cardBounds)
  const leaderY = baseline > pinY ? baseline - boxH * .5 - 5 * f.unit : baseline + boxH * .5 + 5 * f.unit
  p.path([[pinX, pinY + (baseline > pinY ? pin : -pin)], [pinX, leaderY], [labelX, leaderY]],
    '#f6d4ab', 1, { clip, opacity: .66 }, Math.max(.30, arrive))
  p.card(labelX, baseline, width, boxH, '#152631', { radius: 7 * f.unit, border: .95, accent: '#608080', sheen: .75, fill: .94 })
  rows.forEach((row, i) => {
    const run = f.atlas.get(row.text, size, f.heavy, f.dpr)
    f.row(cue, row, run, labelX, baseline + (rows.length / 2 - i - .5) * size * 1.12, f.foreground, f.backing, { clip }, f.heavy, size)
  })
}
