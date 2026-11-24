import { parseLrc } from './lrc'
import { parseLyricsfile } from './lyricsfile'
import { parseTtml } from './ttml'
import { plainResult } from './timing'
import { unavailable, type LyricsFormat, type LyricsResult } from './types'

/** Parses local or provider text. Untimed text stays untimed by default. */
export function parseLyrics(source: string, format: LyricsFormat, options?: { durationMs?: number | undefined }): LyricsResult {
  if (source.length > 256_000) return unavailable('Lyric text exceeds the supported size.')
  const durationMs = options?.durationMs
  const duration = Number.isFinite(durationMs) && durationMs! > 0 ? Math.round(durationMs!) : undefined
  const text = source.replace(/^\uFEFF/, '')
  switch (format) {
    case 'lrc': case 'standard-lrc': case 'enhanced-lrc': return parseLrc(text, duration)
    case 'ttml': return parseTtml(text, duration)
    case 'lyricsfile': return parseLyricsfile(text, duration)
    case 'plain': return plainResult(text)
    default: return unavailable('Unsupported lyric format.')
  }
}
