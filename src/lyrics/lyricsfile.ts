import { isCollection, isNode, parseDocument, visit } from 'yaml'
import { plainResult, timedResult, type RawCue } from './timing'
import { unavailable, type LyricsResult } from './types'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function cue(value: unknown): RawCue | undefined {
  if (!record(value) || typeof value.text !== 'string' || !timestamp(value.start_ms)) return
  const { text, start_ms: startMs, end_ms: endMs } = value
  if (endMs !== undefined && (!timestamp(endMs) || endMs < startMs)) return
  return { text, startMs, endMs }
}

export function parseLyricsfile(source: string, durationMs?: number): LyricsResult {
  let data: unknown
  try {
    const doc = parseDocument(source, { schema: 'core', uniqueKeys: true, strict: true })
    if (doc.errors.length || doc.warnings.length) return unavailable('Invalid Lyricsfile YAML.')
    visit(doc, (_key, node, path) => {
      if (path.length > 24) throw new Error('Lyricsfile nesting limit')
      if (isNode(node) && node.tag) throw new Error('Explicit YAML tags are not supported')
      if (isCollection(node) && node.items.length > 10_000) throw new Error('Lyricsfile collection limit')
    })
    data = doc.toJS({ maxAliasCount: 0 })
  } catch {
    return unavailable('Invalid or unsupported Lyricsfile YAML.')
  }
  if (!record(data) || data.version !== '1.0') return unavailable('Expected a Lyricsfile version 1.0 document.')
  const { metadata, plain, lines } = data
  if (!record(metadata) || typeof metadata.title !== 'string' || typeof metadata.artist !== 'string'
    || (metadata.duration_ms !== undefined && !timestamp(metadata.duration_ms))
    || (metadata.instrumental !== undefined && typeof metadata.instrumental !== 'boolean')
    || (plain !== undefined && typeof plain !== 'string') || (lines !== undefined && !Array.isArray(lines))) {
    return unavailable('Invalid Lyricsfile structure.')
  }
  if (metadata.instrumental === true) {
    if ((Array.isArray(lines) && lines.length) || (typeof plain === 'string' && plain.trim())) {
      return unavailable('Instrumental Lyricsfile also contains lyrics.')
    }
    return { lines: [], quality: 'instrumental' }
  }
  if (Array.isArray(lines)) {
    const cues: RawCue[] = []
    for (const item of lines) {
      const line = cue(item)
      if (!line || !record(item)) continue
      if (Array.isArray(item.words)) {
        const words = item.words.map(cue)
        // A malformed word list must not be presented as word-synchronized.
        if (words.every((word): word is RawCue => !!word)) line.words = words
      }
      cues.push(line)
    }
    const result = timedResult(cues, durationMs ?? (timestamp(metadata.duration_ms) ? metadata.duration_ms : undefined))
    if (result.quality !== 'unavailable') return result
  }
  // offset_ms has no agreed application in the 1.0 draft.
  return typeof plain === 'string' ? plainResult(plain) : unavailable('No lyrics in the Lyricsfile.')
}
