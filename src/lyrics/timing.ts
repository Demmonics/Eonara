import { unavailable, type LyricsResult } from './types'

export interface RawCue {
  startMs: number
  endMs?: number | undefined
  text: string
  words?: RawCue[] | undefined
}

export function timedResult(raw: RawCue[], durationMs?: number): LyricsResult {
  const cues = raw.sort((a, b) => a.startMs - b.startMs)
  let nextStart = Infinity
  const lines = cues.map((cue, i) => {
    const { startMs, text } = cue
    return { startMs, endMs: startMs, text, i }
  })
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (lines[i + 1] && lines[i + 1]!.startMs > line.startMs) nextStart = lines[i + 1]!.startMs
    const cue = cues[i]!
    const wordBoundary = cue.words?.reduce((last, word) => Math.max(last, word.endMs ?? word.startMs + 1), line.startMs)
    const inferred = Number.isFinite(nextStart) ? nextStart : (durationMs ?? 0) > line.startMs ? durationMs! : line.startMs + 4000
    line.endMs = cue.endMs ?? Math.max(inferred, wordBoundary ?? 0)
  }
  const visible = lines.filter(({ text }) => text.trim()).map(({ i, ...line }) => {
    const rawWords = cues[i]!.words
    if (!rawWords?.length || rawWords.map(word => word.text).join('') !== line.text) return line
    const words = rawWords.map((word, j) => ({
      startMs: word.startMs,
      endMs: word.endMs ?? rawWords[j + 1]?.startMs ?? line.endMs,
      text: word.text,
    }))
    if (words.some((word, j) => word.startMs < line.startMs || word.endMs < word.startMs
      || word.endMs > line.endMs || (j > 0 && word.startMs < words[j - 1]!.startMs))) return line
    return { ...line, words }
  })
  return visible.length
    ? { lines: visible, quality: visible.some(line => 'words' in line) ? 'word' : 'line' }
    : unavailable('No timed lyrics in the file.')
}

export function plainResult(source: string): LyricsResult {
  const lines = source.replace(/^\uFEFF/, '').trim().split(/\r\n?|\n/).map(text => ({ startMs: 0, endMs: 0, text }))
  return lines.some(line => line.text.trim()) ? { lines, quality: 'plain' } : unavailable('No lyrics in the file.')
}

/** Call only after the user opts in. This spreads text across the track without analyzing the audio. */
export function estimateLyrics(result: LyricsResult, durationMs?: number): LyricsResult {
  if (result.quality !== 'plain' || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return result
  const lines = result.lines.filter(line => line.text.trim())
  const weights = lines.map(line => Math.max(1, Math.sqrt([...line.text.trim()].length)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let position = 0
  return {
    ...result,
    quality: 'estimated',
    message: 'Estimated timing only; not synchronized to the audio.',
    lines: lines.map((line, i) => {
      const startMs = Math.round(position / total * durationMs)
      position += weights[i]!
      return { text: line.text, startMs, endMs: Math.round(position / total * durationMs) }
    }),
  }
}
