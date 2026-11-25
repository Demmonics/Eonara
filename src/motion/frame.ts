import type { ColorRepresentation } from 'three'
import { Painter, type GlyphPaint, type Paint, type Point } from './painter'
import { TextAtlas, face, mono, systemUiFont, type Face, type Row, type Run } from './text'
import { activeToken, clamp, mix, settle, tokenIndex, type Cue, type Token } from './timeline'
import { normalizeStyleId, sceneTypography, type MotionOptions, type SceneTypography, type StyleId } from './types'

export function multiplier(value: number, min: number, max: number) {
  const v = Number.isFinite(value) ? value : 1
  return clamp(v > 4 ? v / 100 : v, min, max)
}

export class Frame {
  readonly w: number
  readonly h: number
  readonly unit: number
  readonly y: number
  readonly scale: number
  readonly intensity: number
  readonly speed: number
  readonly style: StyleId
  readonly typography: SceneTypography
  readonly regular: Face
  readonly medium: Face
  readonly heavy: Face
  readonly token?: Token
  readonly ti: number
  readonly foreground: string
  readonly active: string
  readonly muted: string
  readonly backing: string
  readonly onBacking: string
  readonly dpr: number
  readonly quiet: boolean
  readonly overlay: boolean
  readonly low: boolean

  constructor(
    readonly p: Painter, readonly atlas: TextAtlas,
    readonly options: MotionOptions, readonly cues: readonly Cue[],
    readonly cue: Cue, readonly time: number,
    styleId: string = 'ship',
  ) {
    this.w = options.width
    this.h = options.height
    this.overlay = options.overlay === true
    this.low = options.lowDetail === true
    this.style = normalizeStyleId(styleId)
    this.typography = sceneTypography[this.style]
    this.unit = clamp(Math.min(this.w / 1110, this.h / 680), .38, 1.5)
    this.y = this.overlay ? 0 : this.h * .066
    this.scale = multiplier(options.size, .5, 2)
    this.intensity = multiplier(options.intensity, 0, 2)
    this.speed = multiplier(options.speed, .25, 3)

    // fontWeight is an absolute per-scene override. Legacy `weight` is the global
    // toolbar dial (600 is its shipped neutral), applied as an offset to each role.
    // Treating that dial as literal body weight made default chat text 700 and
    // display words 800, wiping out the scene's intended typography.
    const userWeight = options.fontWeight
    const dial = Number.isFinite(options.weight) ? options.weight! : 600
    const weightOffset = dial - 600
    const customFont = options.font?.trim()
    const useUserFont = !!customFont && (
      this.typography.fontRole === 'kinetic'
      || customFont.startsWith('LyricMotion Imported ')
      || (customFont !== 'Inter Variable' && customFont !== 'Segoe UI Variable')
    )
    const family = useUserFont
      ? customFont!
      : this.typography.fontRole === 'mono'
        ? mono.css
        : this.typography.fontRole === 'system'
          ? systemUiFont
          : customFont || 'Inter Variable'

    const explicit = typeof userWeight === 'number' && Number.isFinite(userWeight)
    this.regular = face(family, clamp(explicit ? userWeight - 80 : this.typography.historyWeight + weightOffset, 300, 900))
    this.medium = face(family, clamp(explicit ? userWeight : this.typography.normalWeight + weightOffset, 300, 900))
    this.heavy = face(family, clamp(explicit ? userWeight + 80 : this.typography.displayWeight + weightOffset, 350, 900))
    this.token = activeToken(cue, time)
    this.ti = tokenIndex(cue, time)
    this.dpr = clamp(options.pixelRatio ?? 1.5, 1, 2.5)
    this.foreground = options.foreground || '#f5eee5'
    this.active = options.active || '#fff1dc'
    this.muted = options.muted || '#c6c5d2'
    this.backing = options.highlightBackground || '#f9bf96'
    this.onBacking = options.highlightForeground || '#221923'
    this.quiet = options.reducedMotion || this.intensity === 0
  }

  get motion() { return this.quiet ? 0 : this.intensity }
  get start() { return this.cue.startMs }
  get previous() { return this.cues[this.cue.index - 1] }
  get next() { return this.cues[this.cue.index + 1] }
  get lane() { return this.w * (this.overlay ? .86 : .72) }

  advance(duration: number, start = this.start) {
    return this.quiet ? 1 : clamp((this.time - start) / (duration / this.speed))
  }

  em(atBaseline: number) { return atBaseline * this.unit * this.scale }

  fit(text: string, nominal: number, f: Face, width: number) {
    const raw = this.atlas.width(text, nominal, f)
    return Math.max(1, nominal * Math.min(1, width / Math.max(1, raw)))
  }

  run(text: string, nominal: number, f = this.medium, width = this.lane, outline = this.overlay) {
    return this.atlas.get(text, this.fit(text, nominal, f, width), f, this.dpr, outline)
  }

  word(text: string, x: number, y: number, nominal: number, color: ColorRepresentation,
    p: GlyphPaint = {}, f = this.medium, width = this.lane, outline = this.overlay) {
    const run = this.run(text, nominal, f, width, outline)
    this.p.glyph(run, x, y, color, p)
    return run
  }

  row(cue: Cue, row: Row, run: Run, x: number, y: number, base: ColorRepresentation, accent: ColorRepresentation, p: GlyphPaint = {}, f = this.medium, nominal = 30) {
    const mark = cue === this.cue ? this.mark(cue, row, run, f, nominal) : undefined
    const color = cue === this.cue && (cue.mixed || !cue.timed) && this.token ? accent : base
    this.p.glyph(run, x, y, color, { ...p, accent, mark })
  }

  /** The mask is applied to a full shaped run. Mixed-direction visual order is not
   * inferable from Canvas metrics; those lines emphasize as a single shaped unit. */
  mark(cue: Cue, row: Row, run: Run, f: Face, nominal: number): readonly [number, number] | undefined {
    if (!this.token || !cue.timed || cue.mixed || this.token.to <= row.from || this.token.from >= row.to) return undefined
    const a = this.atlas.width(row.text.slice(0, Math.max(0, this.token.from - row.from)), nominal, f)
    const b = this.atlas.width(row.text.slice(0, Math.min(row.text.length, this.token.to - row.from)), nominal, f)
    return run.rtl
      ? [(run.width - run.padding - b - 1) / run.width, (run.width - run.padding - a + 1) / run.width]
      : [(run.padding + a - 1) / run.width, (run.padding + b + 1) / run.width]
  }

  rows(cue: Cue, nominal: number, width: number, f = this.medium, variant = this.style) {
    return this.atlas.rows(cue.text, nominal, f, width, variant)
  }

  page(cue: Cue, rows: readonly Row[], limit: number) {
    const i = cue === this.cue ? Math.max(0, rows.findIndex(row => row.to > (this.token ?? cue.tokens[this.ti]).from)) : rows.length - 1
    const a = Math.floor(i / limit) * limit
    return rows.slice(a, a + limit)
  }

  framedLine(text: string, x: number, y: number, size: number, width: number, f = this.medium, p: GlyphPaint = {}) {
    this.word(text, x, y, size, this.active, p, f, width)
  }

  rule(x1: number, x2: number, y: number, color: ColorRepresentation, opacity = .22) {
    this.p.path([[x1, y], [x2, y]], color, 1, { opacity })
  }

  circle(x: number, y: number, r: number, color: ColorRepresentation, p: Paint = {}) {
    this.p.card(x, y, r * 2, r * 2, color, { ...p, radius: r * 2 })
  }

  icon(text: string, x: number, y: number, size: number, color: ColorRepresentation, progress = 1, opacity = 1) {
    const shape = lookupIcon(text)
    if (!shape) return false
    for (const path of shape) {
      const points = path.map(([a, b]): Point => [x + a * size, y + b * size])
      this.p.path(points, color, Math.max(1, size * .043), { opacity }, progress)
    }
    return true
  }
}

type Icon = readonly (readonly Point[])[]
export function ellipse(rx: number, ry: number, n = 32, x = 0, y = 0, start = 0, end = Math.PI * 2): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = mix(start, end, i / n)
    return [x + rx * Math.cos(a), y + ry * Math.sin(a)] as const
  })
}
const rays = (inner: number, outer: number, count: number): Icon => Array.from({ length: count }, (_, i) => {
  const a = i / count * Math.PI * 2
  return [[Math.cos(a) * inner, Math.sin(a) * inner], [Math.cos(a) * outer, Math.sin(a) * outer]] as const
})
const wave: Point[] = Array.from({ length: 20 }, (_, i) => [i / 19 - .5, .13 * Math.sin(i / 19 * Math.PI * 3)] as const)
const dictionaries: readonly (readonly [RegExp, Icon])[] = [
  [/^(window|windows|fenêtre|fenêtres|ventana|ventanas|窓|खिड़की)$/u, [
    [[-.43, -.39], [.43, -.39], [.43, .39], [-.43, .39], [-.43, -.39]],
    [[0, -.39], [0, .39]], [[-.43, .03], [.43, .03]],
  ]],
  [/^(light|sun|sunlight|dawn|morning|bright|amber|sol|soleil|太陽|सूरज)$/u, [ellipse(.27, .27, 24), ...rays(.38, .52, 8)]],
  [/^(star|stars|spark|sparks|glow|lucero|etoile|étoile|星|तारा)$/u, [
    [[0, .54], [.13, .14], [.5, 0], [.13, -.12], [0, -.54], [-.13, -.12], [-.5, 0], [-.13, .14], [0, .54]],
  ]],
  [/^(moon|night|midnight|luna|lune|月|चाँद)$/u, [
    ellipse(.46, .46, 30, 0, 0, 1.19, 5.25),
    ellipse(.34, .35, 22, .22, .03, 4.57, 1.73),
  ]],
  [/^(river|water|wave|waves|sea|ocean|rain|blue|agua|eau|水|बारिश)$/u, [
    wave.map(([x, y]) => [x, y + .21]), wave, wave.map(([x, y]) => [x, y - .21]),
  ]],
  [/^(wind|air|cloud|sky|breath|smoke|cielo|ciel|空|हवा)$/u, [
    [[-.46, -.13], [-.35, .08], [-.18, .10], [-.10, .30], [.08, .35], [.25, .27], [.30, .13], [.44, .09], [.50, -.13], [-.46, -.13]],
    [[-.27, -.31], [.28, -.31]],
  ]],
  [/^(road|street|streets|path|turn|home|door|doors|route|camino|道|घर)$/u, [
    [[-.43, -.40], [-.12, .35], [.32, .35], [.08, -.40]], [[-.22, -.34], [-.09, -.08]], [[-.04, .02], [.05, .25]],
  ]],
  [/^(flower|flowers|garden|green|leaf|leaves|bloom|flora|fleur|花|फूल)$/u, [
    ellipse(.16, .32, 20, 0, .13), ellipse(.32, .16, 20, 0, .13), [[0, -.03], [0, -.49]], [[0, -.32], [.29, -.22]],
  ]],
  [/^(heart|love|amor|amour|愛|प्यार)$/u, [
    [[0, -.43], [-.45, -.01], [-.45, .25], [-.24, .42], [0, .30], [.24, .42], [.45, .25], [.45, -.01], [0, -.43]],
  ]],
]
export function lookupIcon(text: string): Icon | undefined {
  return dictionaries.find(([pattern]) => pattern.test(text.normalize('NFC').toLocaleLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')))?.[1]
}

export function lift(f: Frame, duration: number, distance: number, start?: number) {
  return (1 - settle(f.advance(duration, start))) * distance * f.motion
}
