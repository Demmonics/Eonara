import type { Track } from './types'

export interface LrclibRecord {
  trackName: string
  artistName: string
  albumName?: string | undefined
  duration?: number | undefined
  instrumental: boolean
  lyricsfile?: string | undefined
  syncedLyrics?: string | undefined
  plainLyrics?: string | undefined
}

export function readRecord(value: unknown): LrclibRecord | undefined {
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  const text = (key: string) => typeof record[key] === 'string' ? record[key] : undefined
  const trackName = text('trackName') ?? text('name')
  const artistName = text('artistName')
  if (!trackName?.trim() || !artistName?.trim()) return
  return {
    trackName, artistName, albumName: text('albumName'),
    duration: typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0 ? record.duration : undefined,
    instrumental: record.instrumental === true,
    lyricsfile: text('lyricsfile'), syncedLyrics: text('syncedLyrics'), plainLyrics: text('plainLyrics'),
  }
}

export function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/['’]/g, '').replace(/[\p{P}\s]+/gu, ' ').trim()
}

function equivalent(a: string, b: string): boolean {
  return !!a && !!b && (a === b || (!!normalize(a) && normalize(a) === normalize(b)))
}

export function withoutFeatured(value: string): string {
  return value.replace(/\s+[\[(]?(?:feat(?:uring)?|ft)\.?\s+.+$/iu, '').trim()
}

export const sameAlbum = (track: Track, record: LrclibRecord) =>
  equivalent(track.album ?? '', record.albumName ?? '')

export const durationDifference = (track: Track, record: LrclibRecord) =>
  track.durationMs && record.duration ? Math.abs(track.durationMs - record.duration * 1000) : Infinity

function matchingEvidence(track: Track, record: LrclibRecord): number {
  const exactTitle = equivalent(track.title, record.trackName)
  const exactArtist = equivalent(track.artist, record.artistName)
  const closeDuration = durationDifference(track, record)
  const album = sameAlbum(track, record)
  if (track.durationMs && record.duration && closeDuration > 2500) return -1
  if (!exactTitle || !exactArtist) {
    // Only relax differences in featured credits with independent edition evidence.
    if (closeDuration > 1500 && !album) return -1
    if (!equivalent(withoutFeatured(track.title), withoutFeatured(record.trackName))
      || !equivalent(withoutFeatured(track.artist), withoutFeatured(record.artistName))) return -1
  }
  return (album ? 16 : 0) + (exactTitle ? 4 : 0) + (exactArtist ? 4 : 0)
    + (closeDuration <= 1000 ? 8 : closeDuration <= 2000 ? 7 : closeDuration <= 2500 ? 5 : 0)
}

function payload(record: LrclibRecord): string {
  const text = (record.syncedLyrics || record.plainLyrics || record.lyricsfile || '').replace(/\r\n/g, '\n').trim()
  return record.instrumental ? '\0instrumental' : text
}

/** Conflicting candidates without stronger edition evidence are not guessed. */
export function matchRecords(track: Track, records: LrclibRecord[]): { matches: LrclibRecord[]; ambiguous: boolean } {
  const ranked = records.filter(record => payload(record)).map(record => ({ record, score: matchingEvidence(track, record) }))
    .filter(({ score }) => score >= 0).sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best) return { matches: [], ambiguous: false }
  const tied = ranked.filter(({ score }) => score === best.score)
  if (tied.some(({ record }) => payload(record) !== payload(best.record))) return { matches: [], ambiguous: true }
  return { matches: tied.map(({ record }) => record), ambiguous: false }
}
