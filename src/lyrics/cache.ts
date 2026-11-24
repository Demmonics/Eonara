import type { LyricWord, LyricsResult, Track } from './types'

const STORAGE_KEY = 'lyricmotion.lyrics.lrclib.v1'
const MAX_ENTRIES = 60
const MAX_LENGTH = 450_000 // JSON code units; under ~900 KB of UTF-16 storage.
const FOUND_TTL = 48 * 60 * 60_000
const MISSING_TTL = 15 * 60_000
type Entry = { key: string; expires: number; result: LyricsResult }
let memory: Entry[] = []
let storageFailed = false

export function cacheKey(track: Track): string {
  const key = (value?: string) => value?.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
  return JSON.stringify([key(track.title), key(track.artist), key(track.album), track.durationMs ?? 0])
}

function word(value: unknown): value is LyricWord {
  if (!value || typeof value !== 'object') return false
  const item = value as LyricWord
  return typeof item.text === 'string' && Number.isFinite(item.startMs) && item.startMs >= 0
    && Number.isFinite(item.endMs) && item.endMs >= item.startMs
}

function validEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false
  const { key, expires, result } = value as Entry
  if (typeof key !== 'string' || !Number.isFinite(expires) || !result
    || !['word', 'line', 'plain', 'instrumental', 'unavailable'].includes(result.quality)
    || !Array.isArray(result.lines) || !result.lines.every(line => word(line)
      && (line.words === undefined || (Array.isArray(line.words) && line.words.every(word))))) return false
  return (result.source === undefined || result.source === 'LRCLIB')
    && (result.sourceUrl === undefined || result.sourceUrl === 'https://lrclib.net')
    && (result.message === undefined || typeof result.message === 'string')
}

function load(): Entry[] {
  if (storageFailed) return memory
  try {
    const storage = globalThis.localStorage
    if (!storage) return memory
    const stored = storage.getItem(STORAGE_KEY)
    if (!stored) return []
    const entries: unknown = stored.length <= MAX_LENGTH ? JSON.parse(stored) : []
    return Array.isArray(entries) ? entries.slice(0, MAX_ENTRIES).filter(validEntry) : []
  } catch {
    return memory
  }
}

function save(entries: Entry[]) {
  const limited = entries.slice(0, MAX_ENTRIES)
  let serialized = JSON.stringify(limited)
  while (serialized.length > MAX_LENGTH) {
    limited.pop()
    serialized = JSON.stringify(limited)
  }
  memory = limited
  if (storageFailed) return
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, serialized)
  } catch {
    // Storage can be disabled or full. The app can still use the memory cache.
    storageFailed = true
  }
}

export function getCached(key: string): LyricsResult | undefined {
  const loaded = load()
  const entries = loaded.filter(entry => entry.expires > Date.now())
  const found = entries.find(entry => entry.key === key)
  if ((found && found !== entries[0]) || entries.length !== loaded.length) {
    save(found ? [found, ...entries.filter(entry => entry !== found)] : entries)
  }
  return found && structuredClone(found.result)
}

export function setCached(key: string, result: LyricsResult) {
  const now = Date.now()
  const expires = now + (result.quality === 'unavailable' ? MISSING_TTL : FOUND_TTL)
  const entry = { key, expires, result: structuredClone(result) }
  if (JSON.stringify(entry).length + 2 > MAX_LENGTH) return
  save([entry, ...load().filter(item => item.key !== key && item.expires > now)])
}

export function clearLyricsCache() {
  memory = []
  storageFailed = false
  try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* unavailable storage */ }
}
