import { Frame } from './frame'
import { packShip, shipPan, shipWords, type ShipFocus, type ShipPage } from './heroGeometry'
import type { Row, TextAtlas } from './text'
import { activeToken, clamp, findCue, hash, settle, spring, tokenIndex, type Cue, type Token } from './timeline'

interface Plan {
  measure: number
  size: number
  step: number
  pages: ShipPage[]
  shaped?: Row[]
  rowsPerPage: number
}

const cache = new WeakMap<TextAtlas, WeakMap<Cue, { key: string; plan: Plan }>>()

function planFor(f: Frame, cue: Cue): Plan {
  let plans = cache.get(f.atlas)
  if (!plans) cache.set(f.atlas, plans = new WeakMap())
  const key = `${f.w}/${f.h}/${f.scale}/${f.overlay}/${f.heavy.css}/${f.heavy.weight}/${f.medium.weight}/${f.atlas.revision}`
  const existing = plans.get(cue)
  if (existing?.key === key) return existing.plan

  const measure = f.lane * .86
  const headline = Math.min(f.em(cue.tokens.length <= 3 ? 87 : 76), f.h * .137)
  const shaped = !cue.timed || cue.rtl || cue.text.length > 420
  const size = shaped ? Math.min(headline, f.em(68)) : headline
  const step = size * 1.15
  const rowsPerPage = clamp(Math.floor(f.h * (f.overlay ? .70 : .52) / step), 2, 4)
  const plan: Plan = { measure, size, step, rowsPerPage, pages: [] }
  if (shaped) {
    plan.shaped = f.rows(cue, size, measure, f.heavy)
  } else {
    const words = shipWords(cue)
    const displayWidths = words.map(word => f.atlas.width(word.text, size, f.heavy))
    const accentAt = displayWidths.indexOf(Math.max(...displayWidths))
    plan.pages = packShip(words.map((word, i) => {
      // Contrast comes from the measured face and size, not from assigning
      // semantic importance to an untimed word or moving it at each beat.
      const display = i === accentAt || displayWidths[i] > size * 2.1
      const face = display ? f.heavy : f.medium
      const nominal = size * (i === accentAt ? 1.10 : display ? .94 : displayWidths[i] < size * 1.08 ? .70 : .82)
      const fitted = f.fit(word.text, nominal, face, measure - size * .22)
      return { ...word, width: f.atlas.width(word.text, fitted, face), size: fitted, gap: word.spaced ? size * .28 : size * .045, display }
    }), measure, step, rowsPerPage, !!(hash(cue.text) & 1))
  }
  plans.set(cue, { key, plan })
  return plan
}

interface Pose {
  cue: Cue
  plan: Plan
  page: number
  focus: ShipFocus
}

function focusAt(f: Frame, cue: Cue, token: Token): Pose {
  const plan = planFor(f, cue)
  if (plan.shaped) {
    const index = Math.max(0, plan.shaped.findIndex(row => row.to > token.from))
    const page = Math.floor(index / plan.rowsPerPage)
    const count = Math.min(plan.rowsPerPage, plan.shaped.length - page * plan.rowsPerPage)
    return { cue, plan, page, focus: { x: 0, y: (count / 2 - .5 - index % plan.rowsPerPage) * plan.step } }
  }
  const page = Math.max(0, plan.pages.findIndex(slab => slab.words.some(word => word.token === token)))
  const focus = plan.pages[page]?.words.find(word => word.token === token) ?? { x: 0, y: 0 }
  return { cue, plan, page, focus }
}

function paint(f: Frame, pose: Pose, x: number, y: number, z: number, opacity: number, retired: boolean, arrive = 1) {
  const { cue, plan, page } = pose
  const clip = [f.y - f.h * .37, f.y + f.h * .324] as const
  if (plan.shaped) {
    const rows = plan.shaped.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage)
    const width = Math.max(...rows.map(row => row.width))
    rows.forEach((row, i) => {
      const run = f.atlas.get(row.text, plan.size, f.heavy, f.dpr)
      const left = -.5 * width + (width - row.width) * (cue.rtl ? .78 : .16)
      const yy = y + (rows.length / 2 - .5 - i) * plan.step
      f.row(cue, row, run, x + left + row.width / 2, yy, retired ? f.muted : f.foreground,
        retired ? f.muted : f.active, { z, clip, opacity }, f.heavy, plan.size)
    })
    return
  }
  const slab = plan.pages[page]
  if (!slab) return
  for (const word of slab.words) {
    const live = !retired && word.token === f.token && !!word.token
    const future = !retired && !!word.token && f.time < word.token.startMs
    const land = !retired && !future && word.token ? (1 - spring(f.advance(177, word.token.startMs))) * Math.min(1, f.motion) : 0
    const px = x + word.x, py = y + word.y - word.size * .16 * land
    const depth = z - (future ? 12 * f.unit : 15 * f.unit * land) + (live ? 14 * f.unit * (1 - land) : 0)
    const face = word.display ? f.heavy : f.medium
    const run = f.atlas.get(word.text, word.size, face, f.dpr)
    if (live) f.p.card(px + run.ink.x, py + run.ink.y, Math.max(run.ink.width, run.advance) + word.size * .22,
      Math.max(run.ink.height + word.size * .19, word.size * .70), f.backing,
      { z: depth, clip, opacity, radius: word.size * .085, accent: f.active, sheen: .10, border: .85 })
    f.p.glyph(run, px, py, live ? f.onBacking : future || retired ? f.muted : f.foreground, {
      z: depth, clip, opacity: opacity * (live || retired ? 1 : future ? .37 : .73) * (live ? 1 : arrive),
    })
  }
}

export function ship(f: Frame) {
  const { cue, p } = f
  const index = f.ti
  const rail = cue.tokens[index]
  const current = focusAt(f, cue, f.token ?? rail)
  const motion = Math.min(f.motion, 1.22)
  const next = cue.tokens[index + 1]?.startMs ?? cue.endMs
  const shooting = rail === f.token || !f.token ? current : focusAt(f, cue, rail)
  // Reconstruct the actual preceding shot, not simply the previous array
  // element (lines can overlap, or the old scene might already be blank).
  const oldTime = cue.startMs - .001
  const formerCue = motion && (index === 0 || f.time < cue.startMs + 235 / f.speed) ? findCue(f.cues, oldTime) : undefined
  const formerIndex = formerCue ? tokenIndex(formerCue, oldTime) : 0
  const formerRail = formerCue?.tokens[formerIndex]
  const former = formerCue && formerRail && focusAt(f, formerCue, activeToken(formerCue, oldTime) ?? formerRail)
  const aimAt = (pose?: Pose) => ({
    x: clamp((pose?.focus.x ?? 0) * .14, -31 * f.unit, 31 * f.unit),
    y: clamp((pose?.focus.y ?? 0) * .19, -19 * f.unit, 19 * f.unit),
  })
  let from = aimAt(index ? focusAt(f, cue, cue.tokens[index - 1]) : undefined)
  if (!index && formerCue && formerRail) {
    from = shipPan(
      aimAt(formerIndex ? focusAt(f, formerCue, formerCue.tokens[formerIndex - 1]) : undefined),
      aimAt(focusAt(f, formerCue, formerRail)), oldTime, formerRail.startMs,
      formerCue.tokens[formerIndex + 1]?.startMs ?? formerCue.endMs, f.speed,
    )
  }
  const aim = shipPan(from, aimAt(shooting), f.time, rail.startMs, next, f.speed)
  const idle = Math.sin(f.time * .00086)
  p.root.rotation.set(motion * (.037 + idle * .016 - aim.y / f.h * .60),
    motion * (Math.cos(f.time * .00064) * .031 - aim.x / f.w * 1.55), motion * -.012)
  p.root.position.set(motion * (-aim.x + idle * 8 * f.unit), -aim.y * motion, motion * (idle * 10 * f.unit - 6 * f.unit))

  let start = cue.startMs
  let outgoing = former
  if (current.page > 0) {
    const { plan, page } = current
    const firstRow = plan.shaped?.[page * plan.rowsPerPage]
    const first = firstRow ? cue.tokens.find(token => token.to > firstRow.from) : plan.pages[page]?.first
    start = first?.startMs ?? rail.startMs
    const lastIndex = first ? cue.tokens.indexOf(first) - 1 : -1
    outgoing = lastIndex >= 0 ? focusAt(f, cue, cue.tokens[lastIndex]) : undefined
  }
  const phase = settle(f.advance(235, start))
  if (outgoing && phase < 1) {
    paint(f, outgoing, -phase * 31 * f.unit * motion, f.y + phase * f.h * .16 * motion, -phase * 112 * f.unit * motion,
      .41 * (1 - phase) ** 1.7, true)
  }
  const enter = (1 - phase) * motion
  paint(f, current, enter * 21 * f.unit, f.y - enter * 35 * f.unit, -enter * 35 * f.unit, 1, false, 1 - .24 * enter)
}
