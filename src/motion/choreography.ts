import { clamp, mix, settle, smooth, smoother, spring, type Cue, type Token } from './timeline'

export type EaseName = 'linear' | 'smooth' | 'smoother' | 'settle' | 'spring'

export interface ChannelSegment {
  startMs: number
  durationMs: number
  target: number
  ease?: EaseName
}

export interface ChannelSample {
  value: number
  velocity: number
}

export function easeValue(ease: EaseName, u: number): number {
  const x = clamp(u)
  switch (ease) {
    case 'linear': return x
    case 'smooth': return smooth(x)
    case 'smoother': return smoother(x)
    case 'spring': return spring(x)
    case 'settle':
    default: return settle(x)
  }
}

export function easeSlope(ease: EaseName, u: number): number {
  if (u <= 0 || u >= 1) return 0
  switch (ease) {
    case 'linear': return 1
    case 'smooth': return 6 * u * (1 - u)
    case 'smoother': return 30 * u * u * (1 - u) * (1 - u)
    case 'spring': {
      const m = 1 - u
      return 3 * m * m * Math.cos(u * 5.2) + 5.2 * m * m * m * Math.sin(u * 5.2)
    }
    case 'settle':
    default: return 3 * (1 - u) * (1 - u)
  }
}

/** Cubic Hermite segment matching position and velocity at both endpoints. */
export function hermiteSegment(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  timeMs: number,
  startMs: number,
  durationMs: number,
): ChannelSample {
  const d = Math.max(1, durationMs)
  if (timeMs <= startMs) return { value: p0, velocity: v0 }
  if (timeMs >= startMs + d) return { value: p1, velocity: v1 }
  const u = (timeMs - startMs) / d
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  const value = h00 * p0 + h10 * (v0 * d) + h01 * p1 + h11 * (v1 * d)
  const dh00 = 6 * u2 - 6 * u
  const dh10 = 3 * u2 - 4 * u + 1
  const dh01 = -6 * u2 + 6 * u
  const dh11 = 3 * u2 - 2 * u
  const velocity = (dh00 * p0 + dh10 * (v0 * d) + dh01 * p1 + dh11 * (v1 * d)) / d
  return { value, velocity }
}

/**
 * Evaluate a seek-invariant sequence of target keyframes with analytic easing
 * and C1 velocity-matched Hermite handoffs whenever a new segment interrupts
 * an active motion.
 */
export function evalChannel(initialValue: number, segments: readonly ChannelSegment[], timeMs: number): ChannelSample {
  let pos = initialValue
  let vel = 0
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (timeMs <= seg.startMs) return { value: pos, velocity: vel }
    const d = Math.max(1, seg.durationMs)
    const nextStart = segments[i + 1]?.startMs ?? Infinity
    const evalUntil = Math.min(timeMs, nextStart)
    const ease = seg.ease ?? 'smooth'
    const interrupted = Math.abs(vel) > 1e-6

    let nextPos: number
    let nextVel: number
    if (interrupted) {
      // Bound tangent impulse across extreme sudden reversals while matching entry slope.
      const clampedVel = clamp(vel, -Math.abs(seg.target - pos) / d * 3 - 2, Math.abs(seg.target - pos) / d * 3 + 2)
      const sampled = hermiteSegment(pos, clampedVel, seg.target, 0, evalUntil, seg.startMs, d)
      nextPos = sampled.value
      nextVel = sampled.velocity
    } else if (evalUntil >= seg.startMs + d) {
      nextPos = seg.target
      nextVel = 0
    } else {
      const u = (evalUntil - seg.startMs) / d
      nextPos = mix(pos, seg.target, easeValue(ease, u))
      nextVel = (seg.target - pos) * easeSlope(ease, u) / d
    }

    pos = nextPos
    vel = nextVel
    if (timeMs <= nextStart) return { value: pos, velocity: vel }
  }
  return { value: pos, velocity: vel }
}

export interface LexicalGroup {
  id: string
  text: string
  token?: Token
  spaced: boolean
}

/** Split a cue into shaped lexical runs, attaching punctuation and unaligned affixes cleanly. */
export function lexicalGroups(cue: Cue): LexicalGroup[] {
  const words: LexicalGroup[] = []
  let end = 0
  function add(from: number, to: number, token?: Token) {
    const last = words.at(-1)
    const spaced = from > end
    const text = cue.text.slice(from, to)
    if (last && !spaced && (!last.token || !token)) {
      last.text += text
      last.token ??= token
    } else {
      words.push({ id: `${cue.id}:g${words.length}`, text, token, spaced })
    }
    end = to
  }
  function unaligned(to: number) {
    const from = end
    for (const match of cue.text.slice(from, to).matchAll(/\S+/gu)) {
      add(from + match.index, from + match.index + match[0].length)
    }
  }
  for (const token of cue.tokens) {
    unaligned(token.from)
    add(token.from, token.to, token)
  }
  unaligned(cue.text.length)
  return words
}
