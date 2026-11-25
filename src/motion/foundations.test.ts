import { PerspectiveCamera, Texture } from 'three'
import { describe, expect, it } from 'vitest'
import { evalChannel, lexicalGroups } from './choreography'
import { Frame } from './frame'
import { Painter } from './painter'
import { overlapArea, placeLabels, type Rect } from './spatialLayout'
import type { TextAtlas } from './text'
import { buildTimeline, cueWindow } from './timeline'
import type { LyricLine, MotionOptions } from './types'

const makeOptions = (overrides: Partial<MotionOptions> = {}): MotionOptions => ({
  width: 800,
  height: 600,
  foreground: '#ffffff',
  active: '#ffffff',
  muted: '#b8c0d5',
  highlightBackground: '#f2e8f5',
  highlightForeground: '#151922',
  font: 'Inter Variable',
  size: 1,
  intensity: 1,
  speed: 1,
  reducedMotion: false,
  ...overrides,
})

describe('Stable timeline IDs & cue windowing', () => {
  it('assigns unique scoped IDs even for repeated tokens and reconstructs bounded windows', () => {
    const lines: LyricLine[] = [
      {
        startMs: 100,
        endMs: 900,
        text: 'light meets light',
        words: [
          { startMs: 100, endMs: 320, text: 'light' },
          { startMs: 350, endMs: 560, text: 'meets' },
          { startMs: 600, endMs: 900, text: 'light' },
        ],
      },
      { startMs: 1200, endMs: 2200, text: 'line only next' },
      { startMs: 15000, endMs: 16000, text: 'after long silence' },
    ]
    const cues = buildTimeline(lines)
    expect(cues.map(c => c.id)).toEqual(['c0', 'c1', 'c2'])
    expect(cues[0].tokens.map(t => t.id)).toEqual(['c0:t0', 'c0:t1', 'c0:t2'])
    expect(cues[1].tokens.map(t => t.id)).toEqual(['c1:t0'])

    const groups = lexicalGroups(cues[0])
    expect(groups.map(g => g.id)).toEqual(['c0:g0', 'c0:g1', 'c0:g2'])

    expect(cueWindow(cues, 1, 1400, 4, 3000).map(c => c.id)).toEqual(['c0', 'c1'])
    expect(cueWindow(cues, 2, 15200, 4, 3000).map(c => c.id)).toEqual(['c2'])
  })
})

describe('Velocity-matched channel interruptions', () => {
  it('preserves position and derivative continuity when a new segment interrupts mid-flight', () => {
    const segs = [
      { startMs: 100, durationMs: 300, target: 100, ease: 'smooth' as const },
      { startMs: 220, durationMs: 240, target: 240, ease: 'smooth' as const },
    ]
    const before = evalChannel(0, segs, 219.9)
    const at = evalChannel(0, segs, 220)
    const after = evalChannel(0, segs, 220.1)

    expect(at.value).toBeCloseTo(before.value, 1)
    expect(after.value).toBeGreaterThan(at.value)
    // Numeric derivative right after interruption matches incoming velocity
    const numericSlopeAfter = (after.value - at.value) / .1
    expect(numericSlopeAfter).toBeCloseTo(before.velocity, 1)
    // Settles cleanly at final target
    expect(evalChannel(0, segs, 460).value).toBeCloseTo(240, 5)
    expect(evalChannel(0, segs, 460).velocity).toBeCloseTo(0, 5)
    // Seeking directly matches forward playback
    expect(evalChannel(0, segs, 300)).toEqual(evalChannel(0, segs, 300))
  })
})

describe('Spatial label collision resolver', () => {
  it('keeps labels clear of obstacles, each other, and safe bounds deterministically', () => {
    const bounds: Rect = { x: 0, y: 0, w: 600, h: 400 }
    const hub: Rect = { x: 0, y: 0, w: 90, h: 90 }
    const placed = placeLabels(
      [
        {
          id: 'a',
          anchorX: 0,
          anchorY: 0,
          w: 80,
          h: 28,
          priority: 1,
          candidates: [
            { dx: 0, dy: 0 },
            { dx: 0, dy: 70 },
            { dx: 95, dy: 0 },
          ],
        },
        {
          id: 'b',
          anchorX: 10,
          anchorY: 70,
          w: 80,
          h: 28,
          priority: 0.8,
          candidates: [
            { dx: 0, dy: 0 },
            { dx: 0, dy: -140 },
            { dx: -110, dy: 0 },
          ],
        },
      ],
      [hub],
      bounds,
    )
    expect(placed).toHaveLength(2)
    expect(placed.every(p => p.visible)).toBe(true)
    const boxA: Rect = { x: placed[0].x, y: placed[0].y, w: placed[0].w, h: placed[0].h }
    const boxB: Rect = { x: placed[1].x, y: placed[1].y, w: placed[1].w, h: placed[1].h }
    expect(overlapArea(boxA, hub)).toBe(0)
    expect(overlapArea(boxB, hub)).toBe(0)
    expect(overlapArea(boxA, boxB)).toBe(0)
  })
})

describe('Scene typography & Painter asymmetric/softness hooks', () => {
  it('resolves style typography profiles while preserving custom user font overrides', () => {
    const painter = new Painter()
    const texture = new Texture()
    const atlas = {
      revision: 0,
      width: (t: string, s: number) => t.length * s * .5,
      get: () => ({ texture, width: 40, height: 20, advance: 32, padding: 4, ink: { x: 0, y: 0, width: 32, height: 14 }, rtl: false, pixels: 800 }),
    } as unknown as TextAtlas
    const [cue] = buildTimeline([{ startMs: 0, endMs: 1000, text: 'hello world' }])

    const codeFrame = new Frame(painter, atlas, makeOptions({ font: 'Inter Variable' }), [cue], cue, 200, 'codestyle')
    expect(codeFrame.typography.fontRole).toBe('mono')
    expect(codeFrame.medium.css).toContain('Cascadia Mono')

    const customCodeFrame = new Frame(painter, atlas, makeOptions({ font: 'LyricMotion Imported Custom' }), [cue], cue, 200, 'codestyle')
    expect(customCodeFrame.medium.css).toContain('Custom')

    painter.begin()
    painter.glyph(atlas.get('hello', 20, codeFrame.medium, 1), 10, 20, '#ffffff', { scaleX: 1.5, scaleY: 0.7, softness: 0.65 })
    painter.finish()

    const cam = new PerspectiveCamera(36, 800 / 600, .5, 5000)
    cam.position.z = 600 / (2 * Math.tan(Math.PI / 10))
    const inspected = painter.inspect(cam, 800, 600)
    expect(inspected.glyphs).toHaveLength(1)
    expect(inspected.glyphs[0].softness).toBeCloseTo(0.65, 5)
    expect(inspected.glyphs[0].pxWidth / inspected.glyphs[0].pxHeight).toBeGreaterThan(2.5)

    painter.dispose()
    texture.dispose()
  })
})
