import { describe, expect, it } from 'vitest'
import { estimateLyrics, parseLyrics } from './index'

describe('lyric parsing', () => {
  it('sorts LRC, expands repeated stamps, applies the offset and keeps blank cue boundaries', () => {
    const result = parseLyrics('\uFEFF[ar:Example]\r\n[00:03.00][00:01.00]Again\r\n[00:02.25]\r\n[offset:+50]', 'lrc', { durationMs: 5000 })
    expect(result).toEqual({ quality: 'line', lines: [
      { text: 'Again', startMs: 950, endMs: 2200 },
      { text: 'Again', startMs: 2950, endMs: 5000 },
    ] })
  })

  it('keeps equal-start lines visible through the next distinct time', () => {
    const result = parseLyrics('[00:01]One\n[00:01]Two\n[00:06]Next', 'standard-lrc')
    expect(result.lines.map(line => [line.startMs, line.endMs])).toEqual([[1000, 6000], [1000, 6000], [6000, 10000]])
  })

  it('reads word anchors, trailing end stamps and repeated enhanced cues', () => {
    const result = parseLyrics('[00:04.00][00:08.00]<00:04.00>Glow <00:04.45>now <00:05.63>', 'enhanced-lrc')
    expect(result).toEqual({ quality: 'word', lines: [
      { text: 'Glow now', startMs: 4000, endMs: 5630, words: [
        { text: 'Glow ', startMs: 4000, endMs: 4450 }, { text: 'now', startMs: 4450, endMs: 5630 },
      ] },
      { text: 'Glow now', startMs: 8000, endMs: 9630, words: [
        { text: 'Glow ', startMs: 8000, endMs: 8450 }, { text: 'now', startMs: 8450, endMs: 9630 },
      ] },
    ] })
  })

  it('falls back to line timing for non-monotonic LRC word anchors', () => {
    expect(parseLyrics('[00:02]<00:03>Moon <00:01>rise', 'lrc')).toMatchObject({
      quality: 'line', lines: [{ text: 'Moon rise', startMs: 2000 }],
    })
  })

  const metadata = `version: "1.0"
metadata: { title: Example, artist: Artist, duration_ms: 7500 }
`

  it('parses draft Lyricsfile words, preserves overlap and infers missing end times', () => {
    const result = parseLyrics(`${metadata}
lines:
  - text: 'Look up'
    start_ms: 1000
    end_ms: 3800
    words:
      - { text: "Look ", start_ms: 1000 }
      - { text: up, start_ms: 1700 }
  - { text: Stars, start_ms: 3500 }
`, 'lyricsfile')
    expect(result).toEqual({ quality: 'word', lines: [
      { text: 'Look up', startMs: 1000, endMs: 3800,
        words: [{ text: 'Look ', startMs: 1000, endMs: 1700 }, { text: 'up', startMs: 1700, endMs: 3800 }] },
      { text: 'Stars', startMs: 3500, endMs: 7500 },
    ] })
  })

  it('supports Lyricsfile plain and instrumental representations', () => {
    const result = parseLyrics(`${metadata}plain: |\n  First\n\n  Last`, 'lyricsfile')
    expect(result.quality).toBe('plain')
    expect(result.lines.map(line => line.text)).toEqual(['First', '', 'Last'])
    expect(parseLyrics(`version: '1.0'\nmetadata: { title: T, artist: A, instrumental: true }`, 'lyricsfile').quality).toBe('instrumental')
  })

  it('rejects duplicate fields, unknown versions, multiple documents, aliases and tags', () => {
    for (const source of [
      `${metadata}version: '1.0'`,
      `${metadata.replace('1.0', '2.0')}plain: Hello`,
      `${metadata}plain: Hi\n---\nplain: Bye`,
      `${metadata}unknown: &s Hello\nplain: *s`,
      `${metadata}plain: !!str 123`,
    ]) expect(parseLyrics(source, 'lyricsfile').quality, source).toBe('unavailable')
  })

  it('only exposes estimated timing when requested for plain lyrics with a valid duration', () => {
    const plain = parseLyrics('First\r\n\r\nSecond', 'plain')
    expect(plain).toMatchObject({ quality: 'plain', lines: [{ startMs: 0, endMs: 0 }, { text: '' }, { startMs: 0, endMs: 0 }] })
    expect(estimateLyrics(plain)).toBe(plain)
    const estimated = estimateLyrics(plain, 7000)
    expect(estimated.quality).toBe('estimated')
    expect(estimated.lines[0]!.endMs).toBe(estimated.lines[1]!.startMs)
    expect(estimated.lines[1]!.endMs).toBe(7000)
    expect(plain.quality).toBe('plain')
  })
})
