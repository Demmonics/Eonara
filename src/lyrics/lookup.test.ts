import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchRecords } from './matching'

const track = { title: 'A Small Light', artist: 'Example Artist', album: 'Original', durationMs: 180_000 }
const record = { trackName: track.title, artistName: track.artist, albumName: 'Original', duration: 180,
  instrumental: false, syncedLyrics: '[00:01]A small light' }

describe('metadata matching', () => {
  it('prefers the requested album and rejects remixes, wrong artists and conflicting duration', () => {
    expect(matchRecords(track, [
      { ...record, trackName: 'A Small Light (Live)' }, { ...record, artistName: 'Someone Else' },
      { ...record, albumName: 'Other', duration: 240 }, { ...record, albumName: 'Compilation' }, record,
    ])).toEqual({ matches: [record], ambiguous: false })
  })

  it('does not guess between conflicting recordings with identical evidence', () => {
    expect(matchRecords({ title: track.title, artist: track.artist }, [
      record, { ...record, duration: 210, syncedLyrics: '[00:20]Different intro' },
    ])).toEqual({ matches: [], ambiguous: true })
  })

  it('relaxes featured-credit differences only with duration or album corroboration', () => {
    const feature = { title: track.title + ' (feat. Guest)', artist: track.artist }
    expect(matchRecords(feature, [record]).matches).toHaveLength(0)
    expect(matchRecords({ ...feature, durationMs: 180_000 }, [record]).matches).toEqual([record])
  })
})

describe('LRCLIB client', () => {
  let response: ReturnType<typeof vi.fn<typeof fetch>>
  const storage = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  }

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    storage.clear()
    response = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', response)
    vi.stubGlobal('localStorage', localStorage)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses public exact lookup with client identification and persists without reference leakage', async () => {
    const { lookupLyrics } = await import('./index')
    response.mockResolvedValueOnce(Response.json(record))
    const first = await lookupLyrics(track)
    expect(first).toMatchObject({ quality: 'line', source: 'LRCLIB' })
    const [url, init] = response.mock.calls[0]!
    expect(String(url)).toContain('/api/get?track_name=A+Small+Light')
    expect(String(url)).toContain('duration=180')
    expect(new Headers(init?.headers).get('X-User-Agent')).toContain('LyricMotion')
    first.lines[0]!.text = 'Changed'
    vi.resetModules()
    const fresh = await import('./index')
    expect((await fresh.lookupLyrics(track)).lines[0]!.text).toBe('A small light')
    expect(response).toHaveBeenCalledTimes(1)
  })

  it('searches after a signature miss and prefers real Lyricsfile words', async () => {
    const { lookupLyrics } = await import('./index')
    const lyricsfile = `version: "1.0"\nmetadata: { title: Example, artist: Artist }\nlines:\n- text: Light\n  start_ms: 1000\n  end_ms: 2000\n  words: [{ text: Light, start_ms: 1000 }]\n`
    response.mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json([{ ...record, lyricsfile }]))
    const result = lookupLyrics(track)
    await vi.advanceTimersByTimeAsync(400)
    expect(await result).toMatchObject({ quality: 'word', lines: [{ text: 'Light', words: [{ text: 'Light' }] }] })
    expect(String(response.mock.calls[1]?.[0])).toContain('/api/search?')
  })

  it('returns instrumental and plain as distinct states, without estimated timing', async () => {
    const { lookupLyrics } = await import('./index')
    response.mockResolvedValueOnce(Response.json([{ ...record, instrumental: true, syncedLyrics: null }]))
      .mockResolvedValueOnce(Response.json([{ ...record, syncedLyrics: null, plainLyrics: 'A small light' }]))
    const metadata = { title: track.title, artist: track.artist }
    expect((await lookupLyrics(metadata, { cache: false })).quality).toBe('instrumental')
    const second = lookupLyrics(metadata, { cache: false })
    await vi.advanceTimersByTimeAsync(400)
    expect(await second).toMatchObject({ quality: 'plain', lines: [{ startMs: 0, endMs: 0 }] })
    expect(storage.size).toBe(0)
  })

  it('supports forced refresh and only estimates at presentation time', async () => {
    const { lookupLyrics } = await import('./index')
    const metadata = { title: track.title, artist: track.artist, durationMs: 180_000 }
    response.mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([{ ...record, syncedLyrics: null, plainLyrics: 'A small light' }]))
    expect((await lookupLyrics(metadata)).quality).toBe('unavailable')
    const refreshed = lookupLyrics(metadata, { force: true, estimate: true })
    await vi.advanceTimersByTimeAsync(400)
    expect(await refreshed).toMatchObject({ quality: 'estimated', lines: [{ startMs: 0, endMs: 180_000 }] })
    expect((await lookupLyrics(metadata)).quality).toBe('plain')
    expect(response).toHaveBeenCalledTimes(2)
  })

  it('caches definite misses briefly and does not cache provider failures', async () => {
    const { lookupLyrics } = await import('./index')
    const metadata = { title: track.title, artist: track.artist }
    response.mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json([record]))
    expect((await lookupLyrics(metadata)).message).toContain('No matching lyrics')
    expect((await lookupLyrics(metadata)).message).toContain('No matching lyrics')
    expect(response).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1)
    expect((await lookupLyrics(metadata)).message).toContain('Could not reach LRCLIB')
    const later = lookupLyrics(metadata)
    await vi.advanceTimersByTimeAsync(400)
    expect((await later).quality).toBe('line')
  })

  it('honors a long Retry-After without holding the caller or sending another request', async () => {
    const { lookupLyrics } = await import('./index')
    const metadata = { title: track.title, artist: track.artist }
    response.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }))
      .mockResolvedValueOnce(Response.json([record]))
    expect((await lookupLyrics(metadata)).message).toContain('rate-limiting')
    expect((await lookupLyrics(metadata)).message).toContain('rate-limiting')
    expect(response).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(31_001)
    expect((await lookupLyrics(metadata)).quality).toBe('line')
  })

  it('retires an aborted lookup promptly and does not cache the result', async () => {
    const { lookupLyrics } = await import('./index')
    const signal = new AbortController()
    const metadata = { title: track.title, artist: track.artist }
    response.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })).mockResolvedValueOnce(Response.json([record]))
    const pending = lookupLyrics(metadata, { signal: signal.signal })
    const aborted = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    await vi.advanceTimersByTimeAsync(0)
    signal.abort()
    await aborted
    expect(storage.size).toBe(0)
    const next = lookupLyrics(metadata)
    await vi.advanceTimersByTimeAsync(400)
    expect((await next).quality).toBe('line')
  })
})
