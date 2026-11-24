export interface Track {
  title: string
  artist: string
  album?: string
  durationMs?: number
}

export interface LyricWord {
  startMs: number
  endMs: number
  text: string
}

export interface LyricLine extends LyricWord {
  words?: LyricWord[]
}

export type LyricsQuality = 'word' | 'line' | 'estimated' | 'plain' | 'unavailable' | 'instrumental'

export interface LyricsResult {
  lines: LyricLine[]
  quality: LyricsQuality
  source?: string
  message?: string
  sourceUrl?: string
}

export type LyricsFormat = 'lrc' | 'enhanced-lrc' | 'standard-lrc' | 'plain' | 'ttml' | 'lyricsfile'

export const unavailable = (message: string): LyricsResult => ({ lines: [], quality: 'unavailable', message })
