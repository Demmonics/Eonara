import { cacheKey, getCached, setCached } from './cache'
import { lookupLrclib } from './lrclib'
import { estimateLyrics } from './timing'
import { unavailable, type LyricsResult, type Track } from './types'

export { clearLyricsCache } from './cache'
export { parseLyrics } from './parse'
export { estimateLyrics } from './timing'
export type { LyricsFormat, LyricsQuality, LyricsResult, LyricLine, LyricWord, Track } from './types'

export interface LookupOptions {
  signal?: AbortSignal | undefined
  /** Bypass the local lyrics cache for this lookup; don't store the response. */
  cache?: boolean
  /** Request fresh lyrics even when the track is cached. A confirmed result updates the cache. */
  force?: boolean
  /** Explicitly opt in to rough timing for plain lyrics. Estimated cues are never stored. */
  estimate?: boolean
}

export async function lookupLyrics(track: Track, { signal, cache = true, force = false, estimate = false }: LookupOptions = {}): Promise<LyricsResult> {
  signal?.throwIfAborted()
  const title = track.title.trim()
  const artist = track.artist.trim()
  const album = track.album?.trim()
  if (!title || !artist) return unavailable('A track title and artist are needed to look up lyrics.')
  if ([title, artist, album ?? ''].some(field => field.length > 512)) return unavailable('Track metadata is too long to look up.')
  const durationMs = track.durationMs
  const normalizedTrack: Track = { title, artist,
    ...(album ? { album } : {}),
    ...(typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
      ? { durationMs: Math.round(durationMs) } : {}),
  }
  const present = (result: LyricsResult) => estimate ? estimateLyrics(result, normalizedTrack.durationMs) : result
  const key = cacheKey(normalizedTrack)
  const cached = cache && !force ? getCached(key) : undefined
  if (cached) return present(cached)
  const { result, cacheable } = await lookupLrclib(normalizedTrack, signal)
  signal?.throwIfAborted()
  if (cache && cacheable) setCached(key, result)
  return present(result)
}
