import { Texture, type BufferGeometry, type Mesh, type ShaderMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { lens } from './fisheye'
import { Frame } from './frame'
import {
  cylindricalLensPoint,
  evalShipRail,
  layoutShipWall,
  lensPoint,
  lensRail,
  neighboring,
  packShip,
  shipPan,
  shipWords,
  type LensField,
  type ShipWallInput,
} from './heroGeometry'
import { ledger, notifications, thread } from './interfaceStyles'
import { Painter } from './painter'
import { ship } from './ship'
import {
  branches,
  buildConstellationCluster,
  constellation,
  evalBranchesArc,
  layoutBranchesScene,
  layoutWebScene,
  mapJourney,
  sampleCubicSpline,
  sliceSplineByArc,
  web,
} from './spatial'
import { overlapArea } from './spatialLayout'
import type { Row, TextAtlas } from './text'
import { buildTimeline, findCue } from './timeline'
import type { LyricLine, MotionOptions } from './types'
import { code, visual } from './typography'

const timedLine = (text: string, words: string[], startMs: number, step = 180): LyricLine => ({
  text, startMs, endMs: startMs + step * words.length,
  words: words.map((word, i) => ({ text: word, startMs: startMs + step * i, endMs: startMs + step * i + step - 20 })),
})

describe('Ship composition', () => {
  it('preserves offsets and keeps touching punctuation with shaped words', () => {
    const [cue] = buildTimeline([timedLine('“Glow,” in the starlight!', ['Glow', 'in', 'starlight'], 100)])
    const words = shipWords(cue)
    expect(words.map(word => word.text)).toEqual(['“Glow,”', 'in', 'the', 'starlight!'])
    expect(words.map(word => word.token?.startMs)).toEqual([100, 280, undefined, 460])
  })

  it('paginates in reading order inside the measure, with meaningful stagger', () => {
    const text = ['we', 'turn', 'through', 'silver', 'streets', 'under', 'a', 'paper', 'moon']
    const [cue] = buildTimeline([timedLine(text.join(' '), text, 0)])
    const words = shipWords(cue).map(w => ({ ...w, width: w.text.length * 17, size: 38, gap: 16, display: false }))
    const pages = packShip(words, 245, 48, 2, false)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.flatMap(page => page.words.map(word => word.text))).toEqual(text)
    for (const page of pages) {
      expect(page.first).toBe(page.words[0].token)
      for (const word of page.words) expect(Math.abs(word.x) + word.width / 2).toBeLessThanOrEqual(122.50001)
    }
    const first = pages[0].words
    const nextRow = first.find(word => word.y < first[0].y)!
    expect(Math.abs((nextRow.x - nextRow.width / 2) - (first[0].x - first[0].width / 2))).toBeGreaterThan(12)
  })

  it('completes a pan before a rapid next onset and holds its endpoint', () => {
    const a = { x: -23, y: 4 }, b = { x: 15, y: -12 }
    expect(shipPan(a, b, 100, 100, 138, 1)).toEqual(a)
    expect(shipPan(a, b, 119, 100, 138, 1)).toEqual({ x: -4, y: -4 })
    expect(shipPan(a, b, 138, 100, 138, 1)).toEqual(b)
    expect(shipPan(b, a, 138, 138, 170, 1)).toEqual(b)
  })

  it('lays out a staggered vertical word-wall with guaranteed ink clearance and bounds', () => {
    const items: ShipWallInput[] = ['Every', 'clock', 'in', 'the', 'city', 'slows', 'down'].map((text, i) => ({
      id: `c0:w${i}`,
      cueIndex: 0,
      wordIndex: i,
      text,
      revealMs: i * 240,
      width: text.length * 26,
      size: i === 0 ? 58 : 48,
      display: i === 0 || i === 4,
      accented: i === 4,
    }))
    const nodes = layoutShipWall(items, 520, 56, false)
    expect(nodes).toHaveLength(7)
    for (let i = 0; i < nodes.length; i++) {
      expect(Math.abs(nodes[i].x) + nodes[i].width * .5).toBeLessThanOrEqual(520 * .47 + 1)
      if (i > 0) {
        const minClear = (nodes[i - 1].size * .58 + nodes[i].size * .58) * 1.12
        expect(nodes[i - 1].y - nodes[i].y).toBeGreaterThanOrEqual(minClear - 1e-4)
        expect(Math.abs(nodes[i].x - nodes[i - 1].x)).toBeGreaterThan(10)
      }
    }
  })

  it('climbs continuously along evalShipRail even under rapid cadence', () => {
    const items: ShipWallInput[] = ['tap', 'step', 'spin', 'turn', 'drop'].map((text, i) => ({
      id: `c0:w${i}`,
      cueIndex: 0,
      wordIndex: i,
      text,
      revealMs: i * 40,
      width: text.length * 24,
      size: 50,
      display: i === 0,
      accented: false,
    }))
    const nodes = layoutShipWall(items, 500, 58, false)
    let prev = evalShipRail(nodes, 0, 1, false, 40)
    for (let t = 5; t <= 420; t += 5) {
      const y = evalShipRail(nodes, t, 1, false, 40)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-4)
      prev = y
    }
    expect(evalShipRail(nodes, 400, 1, false, 40)).toBeGreaterThan(evalShipRail(nodes, 0, 1, false, 40) + 120)
    expect(evalShipRail(nodes, 20, 1, true, 40)).toBe(evalShipRail(nodes, 39, 1, true, 40))
  })
})

describe('Fisheye projection', () => {
  const field: LensField = [180, 80, 1, 0, 17]

  it('bends a baseline rather than merely scaling each centered run', () => {
    expect(lensPoint(field, 0, 17)).toEqual([0, 17])
    expect(lensPoint(field, 9, 17)[0]).toBeGreaterThan(11)
    const [left, center, right] = [-145, 0, 145].map(x => lensPoint(field, x, 85))
    expect(left[0]).toBeCloseTo(-right[0])
    expect(left[1]).toBeCloseTo(right[1])
    expect(center[1] - left[1]).toBeGreaterThan(9)
  })

  it('preserves radial ordering and has bounded distortion at maximum strength', () => {
    for (const angle of [0, .6, 1.2, Math.PI / 2, 2.8]) {
      let prev = 0
      for (let i = 1; i <= 180; i++) {
        const x = Math.cos(angle) * i * 4, y = 17 + Math.sin(angle) * i * 4
        const [xx, yy] = lensPoint(field, x, y)
        const distance = Math.hypot(xx, yy - 17)
        expect(distance).toBeGreaterThan(prev)
        expect(distance / (i * 4)).toBeGreaterThanOrEqual(.24)
        expect(distance / (i * 4)).toBeLessThanOrEqual(1.36)
        prev = distance
      }
    }
    expect(lensPoint([180, 80, 0, 0, 17], 100, -35)).toEqual([100, -35])
  })

  it('keeps positive Jacobian determinant across 101x101 cylindrical lens domain and compresses height more than width', () => {
    const cyl: LensField = [240, 110, .94, 0, 20]
    const eps = .5
    let minDet = Infinity
    for (let ix = -50; ix <= 50; ix++) {
      const x = (ix / 50) * cyl[0] * 1.15
      for (let iy = -50; iy <= 50; iy++) {
        const y = cyl[4] + (iy / 50) * cyl[1] * 1.15
        const [xR, yR] = cylindricalLensPoint(cyl, x + eps, y)
        const [xL, yL] = cylindricalLensPoint(cyl, x - eps, y)
        const [xU, yU] = cylindricalLensPoint(cyl, x, y + eps)
        const [xD, yD] = cylindricalLensPoint(cyl, x, y - eps)
        const dXdx = (xR - xL) / (2 * eps)
        const dYdx = (yR - yL) / (2 * eps)
        const dXdy = (xU - xD) / (2 * eps)
        const dYdy = (yU - yD) / (2 * eps)
        const det = dXdx * dYdy - dXdy * dYdx
        if (det < minDet) minDet = det
      }
    }
    expect(minDet).toBeGreaterThan(.22)

    // Compare box compression at upper slot (y = oy + 108) vs focal middle (y = oy)
    const boxAt = (cy: number) => {
      const [lx] = cylindricalLensPoint(cyl, -90, cy)
      const [rx] = cylindricalLensPoint(cyl, 90, cy)
      const [, ty] = cylindricalLensPoint(cyl, 0, cy + 28)
      const [, by] = cylindricalLensPoint(cyl, 0, cy - 28)
      return { w: rx - lx, h: ty - by }
    }
    const mid = boxAt(20)
    const upper = boxAt(20 + 108)
    const wRatio = upper.w / mid.w
    const hRatio = upper.h / mid.h
    expect(wRatio).toBeGreaterThan(.55)
    expect(wRatio).toBeLessThan(.78)
    expect(hRatio).toBeGreaterThan(.42)
    expect(hRatio).toBeLessThan(wRatio)
  })

  it('preserves the same rail coordinate across an onset at rapid cadence', () => {
    const a = 300, b = 354, c = 398, d = 440
    const before = lensRail(b - .0001, a, undefined, b, c, 1.2)
    const entered = 1 + lensRail(b, b, a, c, d, 1.2)
    expect(before).toBeCloseTo(entered, 7)
    expect(lensRail(b + 9, b, a, c, d, 1.2)).toBeGreaterThan(lensRail(b, b, a, c, d, 1.2))
    expect(lensRail(c - 3, b, a, c, d, 1.2)).toBeGreaterThan(0)
  })

  it('walks neighboring cues without inventing words or bridging a long silence', () => {
    const cues = buildTimeline([
      timedLine('a star', ['a', 'star'], 0), timedLine('at dawn', ['at', 'dawn'], 360),
      { text: 'After silence', startMs: 3000, endMs: 4000 },
    ])
    expect(neighboring(cues, cues[0], 1, 1)?.token).toBe(cues[1].tokens[0])
    expect(neighboring(cues, cues[1], 0, -2)?.token).toBe(cues[0].tokens[0])
    expect(neighboring(cues, cues[1], 1, 1)).toBeUndefined()
    expect(neighboring(cues, cues[2], 0, 0)?.token.text).toBe('After silence')
  })
})

describe('Hero frame reconstruction', () => {
  const cues = buildTimeline([
    timedLine('we walk under stars', ['we', 'walk', 'under', 'stars'], 100),
    timedLine('dawn is turning', ['dawn', 'is', 'turning'], 820),
    timedLine('bright windows open', ['bright', 'windows', 'open'], 1420),
    timedLine('across the quiet', ['across', 'the', 'quiet'], 2020),
  ])
  const options: MotionOptions = {
    width: 760, height: 530, size: 1, intensity: 1, speed: 1, font: 'sans-serif', reducedMotion: false,
    foreground: '#fff', active: '#fff', muted: '#ccc', highlightBackground: '#abc', highlightForeground: '#111',
  }

  function makeHarness(customCues = cues) {
    const painter = new Painter()
    const texture = new Texture()
    const width = (text: string, size: number) => Array.from(text).length * size * .58
    const rows = (text: string, size: number, faceOrLimit: unknown, limit?: number): Row[] => {
      const maxW = typeof faceOrLimit === 'number' ? faceOrLimit : (limit ?? 9999)
      const words = text.split(/\s+/).filter(Boolean)
      const out: Row[] = []
      let current = '', from = 0, cursor = 0
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word
        const w = width(candidate, size)
        if (current && w > maxW) {
          out.push({ text: current, width: width(current, size), from, to: from + current.length })
          from = text.indexOf(word, cursor)
          current = word
        } else {
          if (!current) from = text.indexOf(word, cursor)
          current = candidate
        }
        cursor = from + current.length
      }
      if (current) out.push({ text: current, width: width(current, size), from, to: from + current.length })
      return out
    }
    const atlas = {
      revision: 0, width, rows,
      get: (text: string, size: number) => {
        const advance = width(text, size)
        return { width: advance + 10, advance, padding: 5, height: size + 8, texture, ink: { x: 0, y: 0, width: advance, height: size * .72 } }
      },
    } as unknown as TextAtlas

    function frame(draw: (f: Frame) => void, time: number, reducedMotion = false, styleId = 'ship') {
      painter.begin()
      const cue = findCue(customCues, time)!
      draw(new Frame(painter, atlas, { ...options, reducedMotion }, customCues, cue, time, styleId))
      painter.finish()
      const meshes = (painter.root.children as Mesh<BufferGeometry, ShaderMaterial>[]).filter(mesh => mesh.visible)
      const glyphMeshes = meshes.filter(mesh => mesh.material.uniforms.uMap)
      const cardMeshes = meshes.filter(mesh => mesh.material.uniforms.uCard)
      return {
        position: painter.root.position.toArray(),
        rotation: [painter.root.rotation.x, painter.root.rotation.y, painter.root.rotation.z],
        accents: cardMeshes.length,
        glyphs: glyphMeshes.length,
        strokes: meshes.filter(mesh => !mesh.material.uniforms.uCard && !mesh.material.uniforms.uMap).length,
        planes: meshes.map(mesh => [mesh.position.toArray(), mesh.scale.toArray(), mesh.renderOrder, mesh.material.uniforms.uOpacity.value])
          .sort((a, b) => Number(a[2]) - Number(b[2])),
        glyphDetails: glyphMeshes.map(mesh => ({
          x: mesh.position.x,
          y: mesh.position.y,
          w: mesh.scale.x,
          h: mesh.scale.y,
          reveal: Number(mesh.material.uniforms.uReveal.value),
          softness: Number(mesh.material.uniforms.uSoftness.value),
          opacity: Number(mesh.material.uniforms.uOpacity.value),
        })),
        cardDetails: cardMeshes.map(mesh => ({
          x: mesh.position.x,
          y: mesh.position.y,
          w: mesh.scale.x,
          h: mesh.scale.y,
          angle: mesh.rotation.z,
          opacity: Number(mesh.material.uniforms.uOpacity.value),
          radius: Number(mesh.material.uniforms.uCard.value.x),
        })),
      }
    }

    return {
      frame,
      dispose: () => {
        painter.dispose()
        texture.dispose()
      },
    }
  }

  it('reconstructs Ship word-wall seeks, isolates lead beat, and retains accented history', () => {
    const h = makeHarness()
    const direct = h.frame(ship, 845, false, 'ship')
    h.frame(ship, 281, false, 'ship')
    h.frame(ship, 619, false, 'ship')
    h.frame(ship, 825, false, 'ship')
    h.frame(ship, 1200, false, 'ship')
    expect(h.frame(ship, 845, false, 'ship')).toEqual(direct)

    const lead = h.frame(ship, 100, false, 'ship')
    expect(lead.glyphs).toBe(1)
    expect(lead.accents).toBe(0)

    const endCue0 = h.frame(ship, 799, false, 'ship')
    const tailCue0 = h.frame(ship, 800, false, 'ship')
    const nextCue = h.frame(ship, 820, false, 'ship')
    expect(endCue0.accents).toBeGreaterThanOrEqual(1)
    expect(tailCue0.accents).toBeGreaterThanOrEqual(1)
    expect(nextCue.accents).toBeGreaterThanOrEqual(1)

    const quiet = h.frame(ship, 845, true, 'ship')
    expect(quiet.position.map(Math.abs)).toEqual([0, 0, 0])
    expect(quiet.rotation.map(Math.abs)).toEqual([0, 0, 0])
    expect(quiet.planes).toEqual(h.frame(ship, 890, true, 'ship').planes)
    h.dispose()
  })

  it('reconstructs Visual editorial ladder seeks, omits strokes for plain words, and attaches icons cleanly', () => {
    const h = makeHarness()
    const direct = h.frame(visual, 845, false, 'visual')
    h.frame(visual, 100, false, 'visual')
    h.frame(visual, 640, false, 'visual')
    h.frame(visual, 1200, false, 'visual')
    expect(h.frame(visual, 845, false, 'visual')).toEqual(direct)

    const plain = h.frame(visual, 100, false, 'visual')
    expect(plain.glyphs).toBe(1)
    expect(plain.strokes).toBe(0)

    const starred = h.frame(visual, 640, false, 'visual')
    expect(starred.strokes).toBeGreaterThan(0)

    const quiet = h.frame(visual, 845, true, 'visual')
    expect(quiet.position.map(Math.abs)).toEqual([0, 0, 0])
    expect(quiet.rotation.map(Math.abs)).toEqual([0, 0, 0])
    expect(quiet.planes).toEqual(h.frame(visual, 890, true, 'visual').planes)
    h.dispose()
  })

  it.each([['Fisheye', lens], ['Fisheye Visual', (f: Frame) => lens(f, true)]] as const)(
    '%s reconstructs a seek and samples exact accent boundaries without a renderer',
    (_name, draw) => {
      const h = makeHarness()
      const direct = h.frame(draw, 845, false, 'fisheye')
      h.frame(draw, 281, false, 'fisheye')
      h.frame(draw, 619, false, 'fisheye')
      h.frame(draw, 825, false, 'fisheye')
      h.frame(draw, 1200, false, 'fisheye')
      expect(h.frame(draw, 845, false, 'fisheye')).toEqual(direct)
      expect(h.frame(draw, 799, false, 'fisheye').accents).toBe(1)
      expect(h.frame(draw, 800, false, 'fisheye').accents).toBe(0)
      expect(h.frame(draw, 820, false, 'fisheye').accents).toBe(1)
      const quiet = h.frame(draw, 845, true, 'fisheye')
      expect(quiet.position.map(Math.abs)).toEqual([0, 0, 0])
      expect(quiet.rotation.map(Math.abs)).toEqual([0, 0, 0])
      expect(quiet.planes).toEqual(h.frame(draw, 890, true, 'fisheye').planes)
      h.dispose()
    },
  )

  it('renders Codestyle without container cards, tracks caret <=0.25em, leaks 0% future ink, and shares reveal with Codestyle Visual', () => {
    const h = makeHarness()
    const direct = h.frame(code, 845, false, 'codestyle')
    h.frame(code, 120, false, 'codestyle')
    h.frame(code, 650, false, 'codestyle')
    h.frame(code, 1450, false, 'codestyle')
    expect(h.frame(code, 845, false, 'codestyle')).toEqual(direct)

    // 0 container cards: only the single caret card (accents === 1)
    expect(direct.accents).toBe(1)
    expect(direct.strokes).toBe(0)

    // At t=115 inside cue 0 ('we walk under stars'), only token 0 ('we') has started -> reveal < 0.35 (0% future ink leak)
    const early = h.frame(code, 115, false, 'codestyle')
    expect(early.accents).toBe(1)
    expect(early.glyphDetails[0].reveal).toBeGreaterThan(0)
    expect(early.glyphDetails[0].reveal).toBeLessThan(.35)

    // Caret stays within <= 0.25 em of the revealed glyph right edge
    const caret = early.cardDetails[0]
    const glyph = early.glyphDetails[0]
    const caretLeft = caret.x - (caret.w - 3) * .5
    const advance = glyph.w - 10
    const revealedW = Math.max(0, glyph.reveal * glyph.w - 5.6)
    const glyphRight = glyph.x - advance * .5 + revealedW
    expect(caretLeft - glyphRight).toBeGreaterThanOrEqual(0)
    expect(caretLeft - glyphRight).toBeLessThanOrEqual(glyph.h * .25)

    // History softness progresses from active (0) -> tier 1 (~0.36) -> tier 2 (~0.76)
    const multi = h.frame(code, 1620, false, 'codestyle')
    expect(multi.glyphDetails.length).toBe(3)
    expect(multi.glyphDetails[0].softness).toBeGreaterThan(multi.glyphDetails[1].softness)
    expect(multi.glyphDetails[1].softness).toBeGreaterThan(multi.glyphDetails[2].softness)

    // Codestyle Visual shares identical uReveal timing and adds inline motifs cleanly
    const plainVis = h.frame(f => code(f, true), 115, false, 'codestyle-visual')
    expect(plainVis.glyphDetails[0].reveal).toBeCloseTo(early.glyphDetails[0].reveal, 5)
    const iconVis = h.frame(f => code(f, true), 1620, false, 'codestyle-visual')
    expect(iconVis.strokes).toBeGreaterThan(0)

    const quiet = h.frame(code, 845, true, 'codestyle')
    expect(quiet.glyphDetails.at(-1)!.reveal).toBeGreaterThan(0)
    expect(quiet.glyphDetails.at(-1)!.reveal).toBeLessThan(.45)
    expect(quiet.planes).toEqual(h.frame(code, 890, true, 'codestyle').planes)
    h.dispose()
  })

  it('groups same-side runs in Message Thread, preserves settled bubble size, and avoids opaque word pills', () => {
    const h = makeHarness()
    const direct = h.frame(thread, 1500, false, 'message-thread')
    h.frame(thread, 250, false, 'message-thread')
    h.frame(thread, 950, false, 'message-thread')
    h.frame(thread, 2100, false, 'message-thread')
    expect(h.frame(thread, 1500, false, 'message-thread')).toEqual(direct)

    const atCue1Settled = h.frame(thread, 1300, false, 'message-thread')
    const atCue2Mid = h.frame(thread, 1460, false, 'message-thread')
    const atCue2Settled = h.frame(thread, 1850, false, 'message-thread')

    // Extract main body cards (highest opacity per bubble)
    const mainCards = (res: ReturnType<typeof h.frame>) =>
      res.cardDetails.filter(c => c.opacity > .42 && c.w > 40)

    const c1Bodies = mainCards(atCue1Settled)
    const c2Bodies = mainCards(atCue2Settled)
    expect(c1Bodies.length).toBe(2)
    expect(c2Bodies.length).toBe(3)

    // Cue 1 and Cue 2 share the outgoing right-aligned edge and >= 0.3em vertical separation
    const unit = Math.min(options.width / 1110, options.height / 680)
    const threadSize = Math.min(27 * unit, options.height * .080)
    const cue0InFrame2 = c2Bodies[c2Bodies.length - 3]
    const cue1InFrame1 = c1Bodies.at(-1)!
    const cue1InFrame2 = c2Bodies[c2Bodies.length - 2]
    const cue2InFrame2 = c2Bodies.at(-1)!
    // Old card (cue 1) retains exact settled dimensions across cue transition
    expect(cue1InFrame2.w).toBeCloseTo(cue1InFrame1.w, 3)
    expect(cue1InFrame2.h).toBeCloseTo(cue1InFrame1.h, 3)
    // Same-side right alignment edge matches within < 1px
    const cue1Right = cue1InFrame2.x + (cue1InFrame2.w - 3) * .5
    const cue2Right = cue2InFrame2.x + (cue2InFrame2.w - 3) * .5
    expect(Math.abs(cue1Right - cue2Right)).toBeLessThan(1)
    // Separation between same-side grouped bubbles is >= 0.3em, and between-group >= 0.7em
    const sameSideGap = (cue1InFrame2.y - (cue1InFrame2.h - 3) * .5) - (cue2InFrame2.y + (cue2InFrame2.h - 3) * .5)
    const oppositeGap = (cue0InFrame2.y - (cue0InFrame2.h - 3) * .5) - (cue1InFrame2.y + (cue1InFrame2.h - 3) * .5)
    expect(sameSideGap).toBeGreaterThanOrEqual(threadSize * .3)
    expect(oppositeGap).toBeGreaterThanOrEqual(threadSize * .7)

    // Transient angled entry on active bubble near onset (t=1460 vs onset=1420), then flat at settled t=1850
    const activeMid = mainCards(atCue2Mid).at(-1)!
    expect(Math.abs(activeMid.angle)).toBeGreaterThan(.01)
    expect(Math.abs(cue2InFrame2.angle)).toBeLessThan(1e-4)

    // Reduced motion is completely flat and static across time
    const quietA = h.frame(thread, 1460, true, 'message-thread')
    const quietB = h.frame(thread, 1850, true, 'message-thread')
    expect(mainCards(quietA).every(c => c.angle === 0)).toBe(true)
    expect(quietA.planes).toEqual(quietB.planes)
    h.dispose()
  })

  it('grows Branches splines monotonically by cumulative arc length and reconstructs seeks cleanly', () => {
    const spline = sampleCubicSpline([[-120, 0], [-40, 22], [40, -18], [130, 12]], 16)
    expect(spline.lengths.length).toBe(spline.points.length)
    for (let i = 1; i < spline.lengths.length; i++) {
      expect(spline.lengths[i]).toBeGreaterThanOrEqual(spline.lengths[i - 1])
    }
    const mid = sliceSplineByArc(spline, spline.totalLength * .5)
    expect(mid.points.length).toBeGreaterThan(2)
    expect(mid.points.at(-1)).toEqual(mid.tip)

    const layout = layoutBranchesScene(cues[0].tokens, 42, 600, 600, 30, 1)
    let prevArc = evalBranchesArc(layout, 50, 1, false)
    for (let t = 70; t <= 820; t += 20) {
      const arc = evalBranchesArc(layout, t, 1, false)
      expect(arc).toBeGreaterThanOrEqual(prevArc - 1e-6)
      prevArc = arc
    }

    const h = makeHarness()
    const direct = h.frame(branches, 480, false, 'branches')
    h.frame(branches, 120, false, 'branches')
    h.frame(branches, 1200, false, 'branches')
    expect(h.frame(branches, 480, false, 'branches')).toEqual(direct)
    const quietA = h.frame(branches, 480, true, 'branches')
    const quietB = h.frame(branches, 520, true, 'branches')
    expect(quietA.planes).toEqual(quietB.planes)
    h.dispose()
  })

  it('keeps >=95% of readable Web labels free of hub and pairwise overlap across viewports', () => {
    const viewports = [
      { w: 760, h: 530 },
      { w: 1182, h: 741 },
      { w: 1280, h: 800 },
    ]
    const measure = (text: string, s: number) => Array.from(text).length * s * .56
    let totalReadable = 0
    let nonOverlapping = 0

    for (const vp of viewports) {
      const unit = Math.min(vp.w / 1110, vp.h / 680)
      const lane = vp.w * .72
      const centerY = vp.h * .066
      const size = Math.min(29 * unit, vp.h * .082)
      for (const cue of cues) {
        const lastTok = cue.tokens.at(-1)!
        const scene = layoutWebScene(
          cue.tokens,
          lastTok,
          lastTok.startMs + 40,
          cue.index * 97 + 13,
          lane,
          vp.h,
          centerY,
          unit,
          measure,
          size,
        )
        const visible = scene.nodes.filter(n => n.label.visible)
        for (let i = 0; i < visible.length; i++) {
          totalReadable++
          const boxA = { x: visible[i].label.x, y: visible[i].label.y, w: visible[i].label.w, h: visible[i].label.h }
          const hubHit = overlapArea(boxA, scene.hubObstacle)
          let peerHit = 0
          for (let j = 0; j < visible.length; j++) {
            if (i === j) continue
            const boxB = { x: visible[j].label.x, y: visible[j].label.y, w: visible[j].label.w, h: visible[j].label.h }
            peerHit += overlapArea(boxA, boxB)
          }
          if (hubHit <= .5 && peerHit <= .5) nonOverlapping++
        }
      }
    }

    expect(totalReadable).toBeGreaterThan(10)
    expect(nonOverlapping / totalReadable).toBeGreaterThanOrEqual(.95)

    const h = makeHarness()
    const direct = h.frame(web, 480, false, 'web')
    h.frame(web, 120, false, 'web')
    h.frame(web, 1200, false, 'web')
    expect(h.frame(web, 480, false, 'web')).toEqual(direct)
    h.dispose()
  })

  it('holds previously visible Constellation stars within <=1% stage diagonal across new cluster cues', () => {
    const diag = Math.hypot(options.width, options.height)
    const unit = Math.min(options.width / 1110, options.height / 680)
    const lane = options.width * .72
    const c0 = buildConstellationCluster(cues, 0, lane, options.height, options.height * .066, unit)
    const c1 = buildConstellationCluster(cues, 1, lane, options.height, options.height * .066, unit)
    const byId0 = new Map(c0.nodes.map(n => [n.id, n]))
    let shared = 0
    for (const node of c1.nodes) {
      const prev = byId0.get(node.id)
      if (!prev) continue
      shared++
      expect(Math.hypot(node.x - prev.x, node.y - prev.y)).toBeLessThanOrEqual(diag * .01)
    }
    expect(shared).toBe(c0.nodes.length)
    expect(shared).toBeGreaterThanOrEqual(cues[0].tokens.length)

    const h = makeHarness()
    const direct = h.frame(constellation, 920, false, 'constellation')
    h.frame(constellation, 120, false, 'constellation')
    h.frame(constellation, 1600, false, 'constellation')
    expect(h.frame(constellation, 920, false, 'constellation')).toEqual(direct)
    const quietA = h.frame(constellation, 845, true, 'constellation')
    const quietB = h.frame(constellation, 890, true, 'constellation')
    expect(quietA.planes).toEqual(quietB.planes)
    h.dispose()
  })

  it('reconstructs Map Journey routes deterministically across seeks and reduced motion', () => {
    const h = makeHarness()
    const direct = h.frame(mapJourney, 950, false, 'map-journey')
    h.frame(mapJourney, 150, false, 'map-journey')
    h.frame(mapJourney, 1650, false, 'map-journey')
    expect(h.frame(mapJourney, 950, false, 'map-journey')).toEqual(direct)
    const quietA = h.frame(mapJourney, 845, true, 'map-journey')
    const quietB = h.frame(mapJourney, 890, true, 'map-journey')
    expect(quietA.planes).toEqual(quietB.planes)
    h.dispose()
  })

  it('stacks multi-line Ledger rows by final height without overlap and reconstructs seeks cleanly', () => {
    const multiCues = buildTimeline([
      timedLine('short start line', ['short', 'start', 'line'], 100),
      timedLine(
        'long amber sunlight pouring slowly across every quiet tall open paper window in town',
        ['long', 'amber', 'sunlight', 'pouring', 'slowly', 'across', 'every', 'quiet', 'tall', 'open', 'paper', 'window', 'in', 'town'],
        900,
      ),
    ])
    const h = makeHarness(multiCues)
    const direct = h.frame(ledger, 1450, false, 'payments')
    h.frame(ledger, 200, false, 'payments')
    h.frame(ledger, 1100, false, 'payments')
    expect(h.frame(ledger, 1450, false, 'payments')).toEqual(direct)

    // Active highlight row grew taller for the wrapped 2-line cue than a 1-line cue
    const single = h.frame(ledger, 320, false, 'payments')
    const plateSingle = single.cardDetails.find(c => c.w > 300 && c.h < 90)!
    const plateMulti = direct.cardDetails.find(c => c.w > 300 && c.h < 90)!
    expect(plateMulti.h).toBeGreaterThan(plateSingle.h)

    // History row sits strictly below the active plate bottom with zero overlap
    const historyRowGlyphs = direct.glyphDetails.filter(g => g.y < plateMulti.y - plateMulti.h * .45 && g.h > 10)
    expect(historyRowGlyphs.length).toBeGreaterThanOrEqual(1)

    const quietA = h.frame(ledger, 1000, true, 'payments')
    const quietB = h.frame(ledger, 1040, true, 'payments')
    expect(quietA.planes).toEqual(quietB.planes)
    h.dispose()
  })

  it('derives Notifications depth strips from active card height across 1- and 3-line cues without occluding labels', () => {
    const variedCues = buildTimeline([
      timedLine('first line', ['first', 'line'], 100),
      timedLine('second quiet step', ['second', 'quiet', 'step'], 700),
      timedLine('third calm beat', ['third', 'calm', 'beat'], 1300),
      timedLine(
        'fourth cue spans several bright open horizontal words across multiple wrapped glass lines now',
        ['fourth', 'cue', 'spans', 'several', 'bright', 'open', 'horizontal', 'words', 'across', 'multiple', 'wrapped', 'glass', 'lines', 'now'],
        1900,
      ),
    ])
    const h = makeHarness(variedCues)
    const direct = h.frame(notifications, 2300, false, 'notifications')
    h.frame(notifications, 300, false, 'notifications')
    h.frame(notifications, 1400, false, 'notifications')
    expect(h.frame(notifications, 2300, false, 'notifications')).toEqual(direct)

    // Active card is the tallest opaque card (>100px width, opacity ~0.96); exclude drop shadow (wider than active)
    const activeCard = direct.cardDetails.find(c => c.w > 200 && c.opacity > .9)!
    const activeTop = activeCard.y + activeCard.h * .5
    const tierCards = direct.cardDetails
      .filter(c => c.w > 200 && c.w < activeCard.w - 4 && c.opacity < .85 && c.opacity > .05)
      .sort((a, b) => (a.y + a.h * .5) - (b.y + b.h * .5))
    expect(tierCards.length).toBeGreaterThanOrEqual(2)

    // Exposed header strip between activeCard and first tier stays cleanly wide even on 3-line cards
    const firstTierTop = tierCards[0].y + tierCards[0].h * .5
    expect(firstTierTop - activeTop).toBeGreaterThan(12)

    // History headline labels sit above activeTop so active card never hides them
    const historyHeadlines = direct.glyphDetails.filter(g => g.y > activeTop)
    expect(historyHeadlines.length).toBeGreaterThanOrEqual(2)

    const quietA = h.frame(notifications, 2000, true, 'notifications')
    const quietB = h.frame(notifications, 2350, true, 'notifications')
    expect(quietA.planes).toEqual(quietB.planes)
    h.dispose()
  })
})
