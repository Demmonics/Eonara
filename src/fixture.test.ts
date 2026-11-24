import { describe, expect, it } from 'vitest'
import { allFixtureIds, fixtureSpecs, getFixtureSpec } from './fixture'
import { activeToken, buildTimeline, findCue } from './motion/timeline'

describe('Visual fixture cue sets', () => {
  it('includes all required edge-case cue sets', () => {
    const required = [
      'one-word',
      'three-word',
      'six-word',
      'ten-plus',
      'punctuation',
      'repeated',
      'gaps',
      'rapid',
      'wide-word',
      'emoji',
      'rtl',
      'mixed-script',
      'line-only',
      'suite',
      'demo',
    ] as const
    for (const id of required) {
      expect(allFixtureIds).toContain(id)
      const spec = getFixtureSpec(id)
      expect(spec.lines.length).toBeGreaterThan(0)
      expect(spec.sampleTimesMs.length).toBeGreaterThan(0)
    }
  })

  it('builds valid timelines with distinct token boundaries for repeated, punctuated, and Unicode cues', () => {
    const repeated = buildTimeline(fixtureSpecs.repeated.lines)
    expect(repeated).toHaveLength(1)
    expect(repeated[0].timed).toBe(true)
    expect(repeated[0].tokens.map(t => t.text)).toEqual(['night', 'after', 'night', 'light', 'meets', 'light', 'inside', 'the', 'night'])
    expect(new Set(repeated[0].tokens.map(t => t.from)).size).toBe(repeated[0].tokens.length)

    const punctuated = buildTimeline(fixtureSpecs.punctuation.lines)
    expect(punctuated[0].tokens.length).toBe(9)

    const rtl = buildTimeline(fixtureSpecs.rtl.lines)
    expect(rtl[0].rtl).toBe(true)
    expect(rtl[0].mixed).toBe(false)

    const mixed = buildTimeline(fixtureSpecs['mixed-script'].lines)
    expect(mixed[0].rtl).toBe(true)
    expect(mixed[0].mixed).toBe(true)

    const lineOnly = buildTimeline(fixtureSpecs['line-only'].lines)
    expect(lineOnly.every(cue => !cue.timed && cue.tokens.length === 1)).toBe(true)

    const gaps = buildTimeline(fixtureSpecs.gaps.lines)
    expect(findCue(gaps, 2400)).toBeUndefined()
    const holdCue = findCue(gaps, 4300)
    expect(holdCue).toBeDefined()
    expect(activeToken(holdCue!, 4300)).toBeUndefined()
  })
})
