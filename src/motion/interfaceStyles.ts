import { Frame, lift } from './frame'
import { mono } from './text'
import { activeToken, clamp, mix, settle, smooth, type Cue } from './timeline'
import type { GlyphPaint } from './painter'

export function thread(f: Frame) {
  const { p } = f
  const size = Math.min(f.em(28), f.h * .085)
  const left = -f.lane * .36, right = f.lane * .47
  const pad = 17 * f.unit, gap = 12 * f.unit
  const limit = Math.min(f.lane * .72, 470 * f.unit * Math.max(1, f.scale * .8))
  const hist = Math.min(f.cue.index, 3)
  const progress = settle(f.advance(226))
  const ly = f.y - Math.min(hist * 15 * f.unit, f.h * .095)
  const clip = [f.y - f.h * .26, f.y + f.h * .28] as const
  const entries = []
  let accum = 0
  for (let i = 0; i < Math.min(f.cue.index + 1, 5); i++) {
    const cue = f.cues[f.cue.index - i]
    const rows = f.page(cue, f.rows(cue, size, limit - 2 * pad, f.medium), i === 0 ? 3 : 2)
    const width = Math.max(62 * f.unit, ...rows.map(row => row.width + pad * 2))
    const height = rows.length * size * 1.22 + pad * 1.37
    const outgoing = cue.index % 2 === 0
    const x = outgoing ? right - width / 2 : left + width / 2
    const y = ly + accum + height / 2
    entries.push({ cue, rows, width, height, outgoing, x, y, i })
    accum += height + gap
  }
  const delta = (1 - progress) * f.motion * ((entries[0]?.height ?? 0) + gap)
  for (let j = entries.length - 1; j >= 0; j--) {
    const { cue, rows, width, height, outgoing, x, y, i } = entries[j]
    const py = i === 0 ? y - lift(f, 210, 12 * f.unit) : y - delta
    const fade = i === 0 ? mix(.84, 1, progress) : Math.max(0, .9 - i * .15) * (i === 4 ? 1 - progress : 1)
    const color = outgoing ? '#2455cc' : '#303443'
    const sheen = outgoing ? '#5c94ff' : '#626a82'
    const r = 15 * f.unit + 2
    const bubble: GlyphPaint = { opacity: fade, clip }
    p.card(x, py - 5 * f.unit, width + 5 * f.unit, height + 4 * f.unit, '#101222', { ...bubble, opacity: fade * .24, radius: r + 2 })
    p.card(x + (outgoing ? 1 : -1) * (width * .5 - 3 * f.unit), py - height * .5 + 7 * f.unit, 11 * f.unit, 9 * f.unit, color,
      { ...bubble, angle: (outgoing ? -1 : 1) * .28, radius: 2 })
    p.card(x, py, width, height, color, { ...bubble, accent: sheen, border: .85, radius: r, sheen: .74, fill: outgoing ? .94 : .92 })
    rows.forEach((row, r) => {
      const run = f.atlas.get(row.text, size, f.medium, f.dpr)
      const tx = x + (row.width - width) / 2 + pad
      const yy = py + (rows.length / 2 - r - .5) * size * 1.22 + size * .045
      const mark = i === 0 ? f.mark(cue, row, run, f.medium, size) : undefined
      if (mark) {
        const center = tx + (mark[0] + mark[1] - 1) * run.width / 2
        p.card(center, yy - size * .05, (mark[1] - mark[0]) * run.width + 4 * f.unit, size * .91,
          f.backing, { ...bubble, opacity: .98, radius: 4 * f.unit })
      }
      f.row(cue, row, run, tx, yy, i ? f.foreground : '#f1f1f7', mark ? f.onBacking : f.active, bubble, f.medium, size)
    })
  }
  if (!f.overlay) {
    const x = left - 16 * f.unit
    p.path([[x, f.y - f.h * .18], [x, f.y + f.h * .20]], f.muted, .8, { opacity: .21 })
    const amount = clamp((f.time - f.start) / (f.cue.endMs - f.start))
    f.circle(x, mix(f.y + f.h * .2, f.y - f.h * .18, f.quiet ? .5 : amount), 2.2 * f.unit, f.backing, { opacity: .8 })
  }
}

export function ledger(f: Frame) {
  const { p } = f
  const width = Math.min(f.lane * .94, 588 * f.unit * Math.max(1, f.scale * .72))
  const height = Math.min(310 * f.unit, f.h * .56)
  const count = Math.min(4, f.cue.index + 1)
  const rowH = height * .16, size = Math.min(f.em(23), rowH * .53)
  const top = f.y + height * .5, bottom = f.y - height * .5
  const left = -width * .5 + 21 * f.unit, right = width * .5 - 21 * f.unit
  const pad = 10 * f.unit
  const clip = [bottom + 8 * f.unit, top - height * .24] as const
  const roll = settle(f.advance(170))
  const paper = '#e8decd', edge = '#fff2df', ink = '#302724', secondary = '#5a504c', line = '#786b65'
  p.card(0, f.y - 5 * f.unit, width + 9 * f.unit, height + 6 * f.unit, '#181118', { opacity: .27, radius: 9 })
  p.card(0, f.y, width, height, paper, { accent: edge, sheen: .59, border: 1.1, radius: 6 })
  f.word('LYRIC LEDGER', left + 40 * f.unit, top - height * .115, 12 * f.unit, ink, {}, mono, 81 * f.unit)
  f.word('CUE NO.', right - 22 * f.unit, top - height * .115, 11 * f.unit, secondary, {}, mono)
  f.rule(left, right, top - height * .197, line, .68)
  f.rule(left, right, bottom + height * .084, line, .42)
  for (let i = count - 1; i >= 0; i--) {
    const cue = f.cues[f.cue.index - i]
    const y = top - height * .31 - rowH * i + (1 - roll) * f.motion * rowH
    const shade = i === 0 ? ink : secondary
    const max = width - 114 * f.unit
    const row = f.page(cue, f.rows(cue, size, max, f.medium), 1)[0]
    if (!row) continue
    const run = f.atlas.get(row.text, size, f.medium, f.dpr)
    const x = left + pad + row.width / 2
    if (!i) {
      p.card(0, y, width - 30 * f.unit, rowH * .83, '#56463c', { accent: '#443537', sheen: .62, radius: 2, clip })
      const mark = f.mark(cue, row, run, f.medium, size)
      if (mark) {
        p.card(x + (mark[0] + mark[1] - 1) * run.width / 2, y - size * .47, (mark[1] - mark[0]) * run.width, 2.3 * f.unit,
          f.backing, { radius: 1.5, clip })
      }
    } else f.rule(left, right, y - rowH / 2, line, .27)
    f.row(cue, row, run, x, y, i ? shade : '#f4e8d5', i ? shade : '#fff7ea', { opacity: i ? .94 - i * .09 : 1, clip }, f.medium, size)
    const n = String(cue.index + 1).padStart(3, '0')
    const countY = y + (i ? 0 : (1 - settle(f.advance(130))) * rowH * -.21 * f.motion)
    f.word(n, right - 18 * f.unit, countY, 12.5 * f.unit, i ? secondary : '#f7cda9', { clip }, mono, 39 * f.unit)
  }
  const tail = Math.max(3, Math.floor(width / (24 * f.unit)))
  for (let n = 0; n < tail; n++) {
    f.rule(left + n * (right - left) / tail, left + (n + .52) * (right - left) / tail, bottom + height * .045, line, .43)
  }
}

export function notifications(f: Frame) {
  const { p } = f
  const size = Math.min(f.em(35), f.h * .104)
  const width = Math.min(f.lane * .91, 553 * f.unit * Math.max(1, f.scale * .79))
  const pad = 20 * f.unit
  const currentRows = f.page(f.cue, f.rows(f.cue, size, width - pad * 3, f.medium), 3)
  const height = Math.min(f.h * .36, Math.max(88 * f.unit, currentRows.length * size * 1.12 + 37 * f.unit))
  const e = settle(f.advance(200))
  const state = smooth(f.advance(170))
  const tail = Math.min(3, f.cue.index)
  for (let i = tail; i >= 1; i--) {
    const cue = f.cues[f.cue.index - i]
    const tier = i - (1 - e) * f.motion
    const k = 1 - tier * .078
    const y = f.y + tier * 25 * f.unit
    const opacity = (i === 3 ? (1 - state) * .40 : 1 - i * .22)
    const w = width * k
    p.card(tier * 6 * f.unit, y, w, height * k, '#283447', {
      accent: '#6a7189', sheen: 1, radius: 16 * f.unit, fill: .84, border: 1, opacity,
    })
    const old = activeToken(cue, cue.endMs - 1)?.text ?? cue.text
    f.word(old, tier * 6 * f.unit, y + height * k * .39, Math.min(size * .36, 14 * f.unit), f.foreground,
      { opacity: opacity * .68 }, f.regular, w * .65)
  }
  const y = f.y - lift(f, 185, 16 * f.unit)
  p.card(0, y - 5 * f.unit, width + 8 * f.unit, height + 6 * f.unit, '#11121e', { opacity: .29, radius: 17 * f.unit })
  p.card(0, y, width, height, '#181e2b', { accent: '#6c778e', sheen: 1.24, radius: 15 * f.unit, border: 1.1, opacity: .96, fill: .88 })
  const left = -width / 2 + pad
  const dotX = left + 9 * f.unit
  const iconY = y + height / 2 - 18 * f.unit
  f.circle(dotX, iconY, 4.1 * f.unit, f.backing, { opacity: .9 })
  f.rule(dotX + 12 * f.unit, dotX + 36 * f.unit, iconY, f.muted, .53)
  for (let i = 0; i < 3; i++) f.circle(width / 2 - (20 + 7 * i) * f.unit, iconY, 1.2 * f.unit, f.muted, { opacity: .53 })
  currentRows.forEach((row, i) => {
    const run = f.atlas.get(row.text, size, f.medium, f.dpr)
    const py = y + (currentRows.length / 2 - i - .5) * size * 1.12 - 7 * f.unit
    const clip = [y - height * .46, y + height * .31] as const
    f.row(f.cue, row, run, left + row.width / 2 + 3 * f.unit, py, f.foreground, f.backing, { opacity: mix(.8, 1, e), clip }, f.medium, size)
  })
}
