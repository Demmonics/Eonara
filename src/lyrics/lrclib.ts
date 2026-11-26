import { durationDifference, matchRecords, readRecord, sameAlbum, withoutFeatured, type LrclibRecord } from './matching'
import { parseLyrics } from './parse'
import { unavailable, type LyricsResult, type Track } from './types'

const origin = 'https://lrclib.net'
const minSpacing = 400
const requestTimeout = 5500
const maxAutoWait = 2500
const maxResponseBytes = 8 * 1024 * 1024
const attribution = { source: 'LRCLIB', sourceUrl: origin }
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
const clientHeader = env?.VITE_LRCLIB_CLIENT?.trim() || 'Eonara/0.3.0'
const appId = env?.VITE_LRCLIB_APP_ID?.trim()
let queue: Promise<unknown> = Promise.resolve()
let nextRequest = 0
let cooldownStatus: number | undefined

class ProviderError extends Error {
  readonly status: number | undefined

  constructor(status?: number) {
    super(status ? `LRCLIB responded with HTTP ${status}` : 'LRCLIB network request failed')
    this.status = status
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason) }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function retryDelay(response: Response, fallback: number): number {
  const header = response.headers.get('Retry-After')?.trim()
  const delay = !header ? fallback : /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()
  const base = Math.max(0, Number.isNaN(delay) ? fallback : delay)
  return base + Math.min(1000, Math.ceil(base * 0.2 * Math.random()))
}

async function readJson(response: Response): Promise<unknown> {
  if (!/^(?:application\/json|application\/[\w.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    || !response.body || Number(response.headers.get('Content-Length')) > maxResponseBytes) {
    void response.body?.cancel().catch(() => {})
    throw new ProviderError()
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxResponseBytes) {
        void reader.cancel().catch(() => {})
        throw new ProviderError()
      }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally {
    reader.releaseLock()
  }
}

async function fetchJson(path: 'get' | 'search', params: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    const wait = nextRequest - Date.now()
    if (wait > maxAutoWait) throw new ProviderError(cooldownStatus)
    if (wait > 0) await sleep(wait, signal)
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), requestTimeout)
    let retry = 0
    cooldownStatus = undefined
    try {
      let response: Response
      try {
        response = await fetch(`${origin}/api/${path}?${params}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json', 'X-User-Agent': clientHeader, ...(appId ? { 'Lrclib-App-Id': appId } : {}) },
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          redirect: 'error',
        })
      } catch {
        signal?.throwIfAborted()
        if (attempt === 0) {
          retry = 500
          continue
        }
        throw new ProviderError()
      }
      if (response.ok) return await readJson(response)
      void response.body?.cancel().catch(() => {})
      const { status } = response
      if (status === 404 && path === 'get') return null
      const temporary = [429, 500, 502, 503, 504].includes(status)
      retry = temporary ? retryDelay(response, status === 429 ? 60_000 : 1000) : 0
      if (temporary) cooldownStatus = status
      if (!temporary || attempt > 0 || retry > maxAutoWait) throw new ProviderError(status)
    } finally {
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timeout)
      nextRequest = Date.now() + Math.max(minSpacing, retry)
    }
  }
}

function request(path: 'get' | 'search', params: URLSearchParams, signal?: AbortSignal) {
  const task = queue.then(() => fetchJson(path, params, signal))
  queue = task.catch(() => {}) // Serialize requests even when an earlier lookup fails.
  return abortable(task, signal)
}

function lyricsFor(record: LrclibRecord, track: Track): LyricsResult {
  if (record.instrumental) return { ...attribution, lines: [], quality: 'instrumental' }
  const durationMs = track.durationMs ?? (record.duration === undefined ? undefined : record.duration * 1000)
  const file = record.lyricsfile ? parseLyrics(record.lyricsfile, 'lyricsfile', { durationMs }) : undefined
  if (file?.quality === 'word') return { ...file, ...attribution }
  const lrc = record.syncedLyrics ? parseLyrics(record.syncedLyrics, 'lrc', { durationMs }) : undefined
  if (lrc?.quality === 'word') return { ...lrc, ...attribution }
  if (file?.quality === 'line') return { ...file, ...attribution }
  if (lrc?.quality === 'line') return { ...lrc, ...attribution }
  if (file?.quality === 'plain') return { ...file, ...attribution }
  if (record.plainLyrics) return { ...parseLyrics(record.plainLyrics, 'plain'), ...attribution }
  return { ...unavailable('LRCLIB returned no usable lyrics for this track.'), ...attribution }
}

async function searchRecords(track: Track, signal?: AbortSignal): Promise<LrclibRecord[]> {
  const data = await request('search', new URLSearchParams({ track_name: track.title, artist_name: track.artist }), signal)
  if (!Array.isArray(data)) throw new ProviderError()
  const records = data.slice(0, 20).map(readRecord).filter((record): record is LrclibRecord => !!record)
  if (data.length && !records.length) throw new ProviderError()
  return records
}

// "cacheable" distinguishes confirmed misses from network/provider failures.
export async function lookupLrclib(track: Track, signal?: AbortSignal): Promise<{ result: LyricsResult; cacheable: boolean }> {
  let exact: LyricsResult | undefined
  try {
    if (track.album && track.durationMs && track.durationMs >= 1000 && track.durationMs <= 3_600_000) {
      const params = new URLSearchParams({
        track_name: track.title, artist_name: track.artist, album_name: track.album,
        duration: String(Math.round(track.durationMs / 1000)),
      })
      const data = await request('get', params, signal)
      const record = readRecord(data)
      if (data !== null && !record) throw new ProviderError()
      if (record && sameAlbum(track, record) && durationDifference(track, record) <= 2000
        && matchRecords(track, [record]).matches.length) {
        exact = lyricsFor(record, track)
        if (['word', 'line', 'instrumental'].includes(exact.quality)) return { result: exact, cacheable: true }
      }
    }
    let matched = matchRecords(track, await searchRecords(track, signal))
    const featuredBase = { ...track, title: withoutFeatured(track.title), artist: withoutFeatured(track.artist) }
    if (!matched.matches.length && !matched.ambiguous && (featuredBase.title !== track.title || featuredBase.artist !== track.artist)) {
      matched = matchRecords(track, await searchRecords(featuredBase, signal))
    }
    const parsed = matched.matches.map(record => lyricsFor(record, track))
    const result = parsed.find(candidate => candidate.quality === 'word')
      ?? parsed.find(candidate => candidate.quality === 'line' || candidate.quality === 'instrumental')
      ?? parsed.find(candidate => candidate.quality === 'plain')
      ?? (exact?.quality === 'plain' ? exact : undefined)
      ?? { ...unavailable(matched.ambiguous
        ? 'LRCLIB found conflicting matches for this track.'
        : 'No matching lyrics were found in LRCLIB.'), ...attribution }
    return { result, cacheable: true }
  } catch (error) {
    signal?.throwIfAborted()
    if (exact?.quality === 'plain') return { result: exact, cacheable: false }
    const message = error instanceof ProviderError && error.status === 429
      ? 'LRCLIB is rate-limiting requests. Please try again later.'
      : 'Could not reach LRCLIB or read its response. Please try again later.'
    return { result: { ...unavailable(message), ...attribution }, cacheable: false }
  }
}
