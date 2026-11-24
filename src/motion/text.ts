import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import { breakPoints, rtlScript, safePieces } from './timeline'

export interface Face {
  css: string
  weight: number
}

export interface Run {
  text?: string
  texture: CanvasTexture
  width: number
  height: number
  advance: number
  padding: number
  ink: { x: number; y: number; width: number; height: number }
  rtl: boolean
  pixels: number
}

export interface Row {
  text: string
  from: number
  to: number
  width: number
}

export const mono: Face = { css: '"Cascadia Mono", Consolas, monospace', weight: 550 }

export function face(font: string, weight = 650): Face {
  const name = font?.trim() || 'Segoe UI Variable'
  const css = name.includes(',') || /^(serif|sans-serif|monospace|system-ui)$/i.test(name)
    ? name
    : `"${name.replaceAll(/["\\]/g, '')}", "Segoe UI", sans-serif`
  return { css, weight }
}

function fontKey(f: Face, size: number) { return `${f.weight} ${size}px ${f.css}` }
const quantize = (size: number) => Math.max(1, Math.round(size * 2) * .5)

/** Canvas shapes the complete run, rather than rasterizing letters in isolation. */
export class TextAtlas {
  private meter?: CanvasRenderingContext2D
  private runs = new Map<string, Run>()
  private metrics = new Map<string, number>()
  private layouts = new Map<string, Row[]>()
  private pixels = 0
  private usedThisFrame = new Set<Run>()
  private fontVersion?: Set<string>
  private fontEpoch = 0
  private readonly onFonts = () => { this.invalidate() }

  get revision() { return this.fontEpoch }

  invalidate() {
    this.fontEpoch++
    this.metrics.clear()
    this.layouts.clear()
  }

  private context() {
    if (!this.meter) {
      const canvas = document.createElement('canvas')
      this.meter = canvas.getContext('2d') ?? undefined
      if (!this.meter) throw new Error('Canvas2D is unavailable for lyric shaping')
      if (document.fonts) {
        this.fontVersion = new Set()
        document.fonts.addEventListener('loadingdone', this.onFonts)
      }
    }
    return this.meter
  }

  width(text: string, size: number, f: Face) {
    const font = fontKey(f, quantize(size)), key = font + '\0' + text
    const cached = this.metrics.get(key)
    if (cached !== undefined) return cached
    const ctx = this.context()
    if (this.fontVersion && !this.fontVersion.has(f.css)) {
      this.fontVersion.add(f.css)
      void document.fonts.load(font).catch(() => undefined)
    }
    ctx.font = font
    const result = ctx.measureText(text).width
    if (this.metrics.size >= 4096) this.metrics.clear()
    this.metrics.set(key, result)
    return result
  }

  rows(text: string, size: number, f: Face, width: number): Row[] {
    const key = fontKey(f, quantize(size)) + '\0' + Math.round(width) + '\0' + text
    const cached = this.layouts.get(key)
    if (cached) return cached
    const result: Row[] = []
    const breaks = breakPoints(text)
    let from = 0, last = 0
    const add = (a: number, b: number) => {
      const raw = text.slice(a, b), content = raw.trim()
      if (!content) return
      const start = a + raw.indexOf(content)
      result.push({ text: content, from: start, to: start + content.length, width: this.width(content, size, f) })
    }
    for (const end of breaks) {
      const trial = text.slice(from, end)
      if (!/[\r\n]/.test(trial) && this.width(trial.trim(), size, f) <= width) { last = end; continue }
      if (last > from) { add(from, last); from = last }
      if (/[\r\n]/.test(text.slice(from, end))) { add(from, end); from = end; last = end; continue }
      const span = text.slice(from, end).trim()
      if (this.width(span, size, f) > width) {
        let chunk = ''
        for (const cluster of safePieces(text.slice(from, end))) {
          if (chunk && this.width((chunk + cluster).trim(), size, f) > width) {
            add(from, from + chunk.length)
            from += chunk.length
            chunk = ''
          }
          chunk += cluster
        }
      }
      last = end
    }
    if (from < text.length) add(from, text.length)
    if (this.layouts.size >= 180) this.layouts.clear()
    this.layouts.set(key, result)
    return result
  }

  get(text: string, nominal: number, f: Face, dpr: number): Run {
    const size = quantize(nominal), scale = Math.max(1, Math.min(3, Math.ceil(dpr * 1.15)))
    const font = fontKey(f, size), key = `${this.fontEpoch}/${scale}/${font}\0${text}`
    let run = this.runs.get(key)
    if (run) {
      this.runs.delete(key)
      this.runs.set(key, run)
      this.usedThisFrame.add(run)
      return run
    }
    const m = this.context()
    const rtl = rtlScript.test(text)
    m.font = font
    m.textAlign = 'left'
    m.direction = rtl ? 'rtl' : 'ltr'
    const tm = m.measureText(text)
    const advance = tm.width
    const padding = Math.max(3, Math.ceil(size * .12), Math.ceil(tm.actualBoundingBoxLeft + 3), Math.ceil(tm.actualBoundingBoxRight - advance + 3))
    const asc = Math.max(size * .76, tm.actualBoundingBoxAscent)
    const desc = Math.max(size * .24, tm.actualBoundingBoxDescent)
    const width = Math.max(1, advance + padding * 2), height = asc + desc + 8
    const ink = {
      x: (tm.actualBoundingBoxRight - tm.actualBoundingBoxLeft - advance) / 2,
      y: (desc - asc + tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2,
      width: tm.actualBoundingBoxLeft + tm.actualBoundingBoxRight,
      height: tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent,
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(2048, Math.ceil(width * scale))
    canvas.height = Math.min(1024, Math.ceil(height * scale))
    const ctx = canvas.getContext('2d')!
    ctx.scale(canvas.width / width, canvas.height / height)
    ctx.font = font
    ctx.textAlign = 'left'
    ctx.direction = rtl ? 'rtl' : 'ltr'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(12,12,17,.74)'
    ctx.lineWidth = Math.min(2.6, Math.max(1.2, size * .029))
    ctx.strokeText(text, padding, asc + 4)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, padding, asc + 4)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    run = { text, texture, width, height, advance, padding, ink, rtl, pixels: canvas.width * canvas.height }
    this.usedThisFrame.add(run)
    this.runs.set(key, run)
    this.pixels += run.pixels
    return run
  }

  finish() {
    for (const [key, run] of this.runs) {
      if (this.pixels <= 6_000_000 && this.runs.size <= 160) break
      if (this.usedThisFrame.has(run)) continue
      this.runs.delete(key)
      this.pixels -= run.pixels
      run.texture.dispose()
    }
    this.usedThisFrame.clear()
  }

  dispose() {
    if (this.fontVersion) document.fonts.removeEventListener('loadingdone', this.onFonts)
    for (const run of this.runs.values()) run.texture.dispose()
    this.runs.clear()
    this.metrics.clear()
    this.layouts.clear()
    this.usedThisFrame.clear()
    this.pixels = 0
  }
}
