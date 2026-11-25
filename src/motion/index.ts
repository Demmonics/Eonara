import { PerspectiveCamera, Scene } from 'three'
import { Frame } from './frame'
import { ledger, notifications, thread } from './interfaceStyles'
import { Painter, type PainterInspection } from './painter'
import { branches, constellation, mapJourney, web } from './spatial'
import { TextAtlas } from './text'
import { activeToken, buildTimeline, findCue, tokenIndex, type Cue } from './timeline'
import { code, visual } from './typography'
import { lens } from './fisheye'
import { ship } from './ship'
import type { LyricLine, MotionOptions } from './types'

export { styles } from './types'
export type { LyricLine, LyricWord, MotionOptions, StyleId } from './types'
export type { InspectedCard, InspectedGlyph, NormalizedBox, PainterInspection } from './painter'

export interface MotionInspection extends PainterInspection {
  styleId: string
  timeMs: number
  width: number
  height: number
  cueIndex: number
  cueText?: string
  cueTimed: boolean
  cueRtl: boolean
  cueMixed: boolean
  activeTokenIndex: number
  activeTokenText?: string
  atlasRevision: number
}

/**
 * A transparent, media-clock-independent lyric scene. The caller owns the
 * renderer, its clear/background pass, frame scheduling, and the viewport.
 * Keep a lyrics array immutable; provide a new reference for edited cues.
 */
export class MotionScene {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(36, 1, .5, 5000)

  private p = new Painter()
  private atlas = new TextAtlas()
  private source?: readonly LyricLine[]
  private cues: Cue[] = []
  private width = 0
  private height = 0
  private disposed = false
  private lastSample?: { styleId: string; timeMs: number; cue?: Cue }

  constructor() {
    this.scene.name = 'Lyric motion · transparent pass'
    this.scene.add(this.p.root)
  }

  /** Sample directly at absolute media time; return false when no cue is drawn. */
  sample(styleId: string, lines: readonly LyricLine[], timeMs: number, options: MotionOptions): boolean {
    if (this.disposed) return false
    this.p.begin()
    this.p.root.rotation.set(0, 0, 0)
    this.p.root.position.set(0, 0, 0)
    if (lines !== this.source) {
      this.source = lines
      this.cues = buildTimeline(lines)
    }
    let drew = false
    let cue: Cue | undefined
    try {
      cue = findCue(this.cues, timeMs)
      if (!cue || !Number.isFinite(timeMs) || !Number.isFinite(options.width) || !Number.isFinite(options.height) || options.width < 2 || options.height < 2) {
        this.lastSample = { styleId, timeMs, cue: undefined }
        return false
      }

      if (this.width !== options.width || this.height !== options.height) {
        this.width = options.width
        this.height = options.height
        this.camera.aspect = this.width / this.height
        this.camera.position.z = this.height / (2 * Math.tan(Math.PI / 10))
        this.camera.far = Math.max(5000, this.camera.position.z * 3)
        this.camera.updateProjectionMatrix()
      }
      const f = new Frame(this.p, this.atlas, options, this.cues, cue, timeMs, styleId)
      switch (styleId) {
        case 'fisheye': lens(f); break
        case 'visual': visual(f); break
        case 'fisheye-visual': lens(f, true); break
        case 'codestyle': code(f); break
        case 'codestyle-visual': code(f, true); break
        case 'branches': branches(f); break
        case 'web': web(f); break
        case 'constellation': constellation(f); break
        case 'thread':
        case 'message-thread': thread(f); break
        case 'payments': ledger(f); break
        case 'map':
        case 'map-journey': mapJourney(f); break
        case 'notifications': notifications(f); break
        case 'ship':
        default: ship(f)
      }
      drew = true
      this.lastSample = { styleId, timeMs, cue }
    } finally {
      this.p.finish()
      this.atlas.finish()
    }
    return drew
  }

  /** Inspect projected geometry and active cue state from the most recent sample. */
  inspect(): MotionInspection {
    const base = this.p.inspect(this.camera, Math.max(1, this.width), Math.max(1, this.height))
    const sample = this.lastSample
    const cue = sample?.cue
    const token = cue && sample ? activeToken(cue, sample.timeMs) : undefined
    return {
      ...base,
      styleId: sample?.styleId ?? '',
      timeMs: sample?.timeMs ?? 0,
      width: this.width,
      height: this.height,
      cueIndex: cue?.index ?? -1,
      cueText: cue?.text,
      cueTimed: cue?.timed ?? false,
      cueRtl: cue?.rtl ?? false,
      cueMixed: cue?.mixed ?? false,
      activeTokenIndex: cue && sample ? tokenIndex(cue, sample.timeMs) : -1,
      activeTokenText: token?.text,
      atlasRevision: this.atlas.revision,
    }
  }

  /** Refresh shape caches after a caller adds or replaces a font face. */
  invalidateText() {
    if (!this.disposed) this.atlas.invalidate()
  }

  /** Release all scene-owned GPU textures, materials, geometry, and font listeners. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.scene.clear()
    this.p.dispose()
    this.atlas.dispose()
    this.source = undefined
    this.cues = []
    this.lastSample = undefined
  }
}
