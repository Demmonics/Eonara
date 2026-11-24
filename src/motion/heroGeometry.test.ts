import { Texture, type BufferGeometry, type Mesh, type ShaderMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { lens } from './fisheye'
import { Frame } from './frame'
import { lensPoint, lensRail, neighboring, packShip, shipPan, shipWords, type LensField } from './heroGeometry'
import { Painter } from './painter'
import { ship } from './ship'
import type { TextAtlas } from './text'
import { buildTimeline, findCue } from './timeline'
import type { LyricLine, MotionOptions } from './types'

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
  ])
  const options: MotionOptions = {
    width: 760, height: 530, size: 1, intensity: 1, speed: 1, font: 'sans-serif', reducedMotion: false,
    foreground: '#fff', active: '#fff', muted: '#ccc', highlightBackground: '#abc', highlightForeground: '#111',
  }

  it.each([['Ship', ship], ['Fisheye', lens], ['Fisheye Visual', (f: Frame) => lens(f, true)]] as const)(
    '%s reconstructs a seek and samples exact accent boundaries without a renderer',
    (_name, draw) => {
      const painter = new Painter()
      const texture = new Texture()
      const width = (text: string, size: number) => Array.from(text).length * size * .58
      const atlas = {
        revision: 0, width,
        get: (text: string, size: number) => {
          const advance = width(text, size)
          return { width: advance + 10, advance, height: size + 8, texture, ink: { x: 0, y: 0, width: advance, height: size * .72 } }
        },
      } as unknown as TextAtlas

      function frame(time: number, reducedMotion = false) {
        painter.begin()
        const cue = findCue(cues, time)!
        draw(new Frame(painter, atlas, { ...options, reducedMotion }, cues, cue, time))
        painter.finish()
        const meshes = (painter.root.children as Mesh<BufferGeometry, ShaderMaterial>[]).filter(mesh => mesh.visible)
        return {
          position: painter.root.position.toArray(),
          rotation: [painter.root.rotation.x, painter.root.rotation.y, painter.root.rotation.z],
          accents: meshes.filter(mesh => mesh.material.uniforms.uCard).length,
          planes: meshes.map(mesh => [mesh.position.toArray(), mesh.scale.toArray(), mesh.renderOrder, mesh.material.uniforms.uOpacity.value])
            .sort((a, b) => Number(a[2]) - Number(b[2])),
        }
      }
      const direct = frame(845)
      frame(281)
      frame(619)
      frame(825)
      frame(1200)
      expect(frame(845)).toEqual(direct)
      expect(frame(799).accents).toBe(1)
      expect(frame(800).accents).toBe(0)
      expect(frame(820).accents).toBe(1)
      const quiet = frame(845, true)
      expect(quiet.position.map(Math.abs)).toEqual([0, 0, 0])
      expect(quiet.rotation.map(Math.abs)).toEqual([0, 0, 0])
      expect(quiet.planes).toEqual(frame(890, true).planes)
      painter.dispose()
      texture.dispose()
    },
  )
})
