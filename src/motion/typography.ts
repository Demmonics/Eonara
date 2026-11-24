import { Frame, lift, lookupIcon } from './frame'
import { neighboring } from './heroGeometry'
import { mono } from './text'
import { safePieces, settle } from './timeline'
import type { GlyphPaint } from './painter'

function symbol(text: string) { return lookupIcon(text) ? text : text.split(/\s+/u).find(t => lookupIcon(t)) }

export function visual(f: Frame) {
  const mid = f.cue.tokens[f.ti]
  const size = Math.min(f.em(f.cue.timed ? 68 : 50), f.h * .133)
  const sign = symbol(mid.text)
  const iconW = sign ? Math.min(size * .85, 60 * f.unit) : 0
  const progress = settle(f.advance(140, mid.startMs))
  const run = f.run(mid.text, size, f.heavy, f.lane * .87 - iconW)
  const cx = iconW * .56
  for (const d of [-1, 1]) {
    const slot = neighboring(f.cues, f.cue, f.ti, d)
    if (!slot) continue
    const y = f.y - d * size * 1.18 - lift(f, 145, 9 * f.unit, mid.startMs)
    f.word(slot.token.text, 0, y, size * .39, f.muted, { opacity: d < 0 ? .53 : .4 }, f.regular)
  }
  const cy = f.y - lift(f, 105, 12 * f.unit, mid.startMs)
  f.p.glyph(run, cx, cy, f.token ? f.active : f.foreground)
  if (sign) f.icon(sign, cx - run.advance / 2 - iconW * .69,
    cy - (1 - progress) * iconW * .20 * f.motion, iconW, f.backing, progress)
}

export function code(f: Frame, annotated = false) {
  const width = f.lane * .90, size = Math.min(f.em(33), f.h * .105)
  const lineH = size * 1.35
  const gutter = 33 * f.unit, noteWidth = annotated && f.w > 560 ? 68 * f.unit : 0
  const left = -width / 2 + gutter, right = width / 2 - noteWidth
  let groups = f.rows(f.cue, size, right - left, mono)
  const page = f.page(f.cue, groups, 4)
  const pageOffset = Math.max(0, groups.indexOf(page[0]))
  const clip = [f.y - Math.min(2.7 * lineH, f.h * .30), f.y + Math.min(2.6 * lineH, f.h * .29)] as const
  const slide = lift(f, 182, lineH * .60)
  const height = Math.min(lineH * 4.85, f.h * .55)
  if (!f.overlay) {
    f.p.card(0, f.y, width + 26 * f.unit, height, '#11141e', {
      accent: '#434f6b', radius: 10 * f.unit, fill: .67, border: .8, opacity: .67, sheen: .78,
    })
    f.rule(-width / 2 + 8 * f.unit, width / 2 - 7 * f.unit, f.y + height * .39, f.muted, .22)
  }
  f.p.path([[left - 10 * f.unit, f.y - height * .45], [left - 10 * f.unit, f.y + height * .34]], f.muted, 1, { opacity: .29 })
  if (noteWidth) f.p.path([[right + 10 * f.unit, f.y - height * .45], [right + 10 * f.unit, f.y + height * .34]], f.muted, 1, { opacity: .27 })
  if (f.previous && pageOffset === 0 && page.length < 4) {
    groups = f.rows(f.previous, size, right - left, mono)
    const prev = groups.at(-1)
    if (prev) f.word(prev.text, left + prev.width / 2, f.y + lineH * (page.length / 2 + .53) - slide,
      size, f.muted, { opacity: .34, clip }, mono, right - left)
  }
  page.forEach((r, i) => {
    const y = f.y + (page.length / 2 - .5 - i) * lineH - slide - 6 * f.unit
    const x = (f.cue.rtl ? right - r.width : left) + r.width / 2
    const run = f.atlas.get(r.text, size, mono, f.dpr)
    const hasWord = !!f.token && f.token.to > r.from && f.token.from < r.to
    f.word(String(f.cue.index + 1).padStart(2, '0') + (pageOffset + i ? '›' : ' '),
      left - 22 * f.unit, y, size * .36, hasWord ? '#d89076' : f.muted, { opacity: hasWord ? .9 : .47, clip }, mono, gutter - 3)
    const paint: GlyphPaint = { clip, opacity: 1 }
    const mark = f.mark(f.cue, r, run, mono, size)
    let cursor: number | undefined
    if (hasWord && f.token && mark) {
      const part = r.text.slice(Math.max(0, f.token.from - r.from), Math.min(r.text.length, f.token.to - r.from))
      const pieces = safePieces(part)
      const len = Math.max(1, Math.min(pieces.length, Math.ceil(f.advance(Math.min(180, Math.max(80, pieces.length * 21)), f.token.startMs) * pieces.length)))
      const partial = f.atlas.width(pieces.slice(0, len).join(''), size, mono) / run.width
      paint.mark = run.rtl ? [Math.max(mark[0], mark[1] - partial), mark[1]] : [mark[0], Math.min(mark[1], mark[0] + partial)]
      cursor = run.rtl ? paint.mark[0] : paint.mark[1]
    } else if (hasWord && f.token) {
      cursor = run.rtl ? run.padding / run.width : 1 - run.padding / run.width
    }
    f.p.glyph(run, x, y, hasWord && !mark ? f.active : f.muted, { ...paint, accent: f.active })
    if (cursor !== undefined) {
      const flash = f.quiet ? .94 : .68 + .29 * Math.cos((f.time - (f.token?.startMs ?? f.start)) * Math.PI / 500)
      f.p.card(x + (cursor - .5) * run.width + (run.rtl ? -2 : 2) * f.unit, y - size * .035, 2 * f.unit, size * .69,
        '#ee8d88', { clip, opacity: flash, radius: 2 })
    }
    const glyph = noteWidth && hasWord && f.token ? symbol(f.token.text) : undefined
    if (glyph) {
      const xx = right + noteWidth * .62
      f.rule(right + 17 * f.unit, xx - 17 * f.unit, y, f.backing, .49)
      f.icon(glyph, xx, y, 23 * f.unit, f.backing, settle(f.advance(115, (f.token?.startMs ?? f.start) + 18)), .94)
    }
  })
}
