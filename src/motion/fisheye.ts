import { Frame, lookupIcon } from './frame'
import { lensPoint, lensRail, neighboring, type LensField } from './heroGeometry'
import { clamp, mix, settle, smooth } from './timeline'

export function lens(f: Frame, visual = false) {
  const slot = (offset: number) => neighboring(f.cues, f.cue, f.ti, offset)
  const mid = f.cue.tokens[f.ti]
  const previous = slot(-1)?.token, next = slot(1)?.token
  const offset = f.quiet ? 0 : lensRail(f.time, mid.startMs, previous?.startMs, next?.startMs, slot(2)?.token.startMs, f.speed)
  const space = Math.min(f.em(97), f.h * .184)
  const size = Math.min(f.em(70), space * .76)
  const max = f.lane * .75
  const strength = (f.quiet ? .38 : clamp(.51 + f.motion * .32, .51, 1)) * clamp(f.w / 720, .53, 1)
  const field: LensField = [Math.min(max * .58, 2.13 * space), space * .85, strength, 0, f.y]
  const edge = Math.min(space * 1.61, f.h * .278)
  const clip = [f.y - edge, f.y + edge] as const

  for (const i of [-2, 2, -1, 1, 0]) {
    const entry = slot(i)
    if (!entry) continue
    const d = offset - i
    const distance = Math.abs(d)
    const live = f.token === entry.token
    // There is no active accent in a genuine timing gap. Keep the last
    // focused run readable without inventing anything to highlight.
    const focus = 1 - smooth(distance / 1.44)
    const visible = 1 - smooth((distance - 1.08) / .76)
    if (visible < .003) continue
    const y = f.y + d * space
    const scale = mix(.78, 1, focus)
    const icon = visual && lookupIcon(entry.token.text) ? entry.token.text : undefined
    const gutter = icon ? size * .73 : 0
    const run = f.run(entry.token.text, size, f.heavy, max - gutter)
    const x = gutter * scale * .5
    const opacity = visible * (live ? 1 : mix(mix(.47, .57, smooth((d + .4) / .8)), .96, focus))
    if (live && !f.overlay) {
      f.p.card(x + run.ink.x * scale, y + run.ink.y * scale, (Math.max(run.ink.width, run.advance) + size * .24) * scale,
        Math.max(run.ink.height + size * .18, size * .69) * scale, f.backing, {
        accent: f.active, opacity: .97, lens: field, clip, radius: size * .08 * scale, border: .9, sheen: .09,
      })
    }
    f.p.glyph(run, x, y, live ? (f.overlay ? f.active : f.onBacking) : distance < .54 ? f.foreground : f.muted,
      { opacity, clip, scale, lens: field })
    if (icon) {
      // Anchor symbols to the same optical field without distorting their
      // strokes. The gutter belongs to the run for its whole trip.
      const [ix, iy] = lensPoint(field, x - (run.advance + gutter) * .5 * scale, y)
      const mask = smooth((iy - clip[0]) / 18) * smooth((clip[1] - iy) / 18)
      f.icon(icon, ix, iy, size * mix(.42, .52, focus), live ? f.backing : f.foreground,
        live ? settle(f.advance(110, entry.token.startMs)) : 1, mask * opacity * (live ? .98 : .43))
    }
  }
}
