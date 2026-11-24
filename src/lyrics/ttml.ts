import { plainResult, timedResult, type RawCue } from './timing'
import { unavailable, type LyricsResult } from './types'

interface Rate { frames: number; subframes: number; ticks: number }
interface Bounds { start: number; end: number }
type Piece = { text: string; timing?: Bounds | undefined; preserve?: boolean | undefined }
const parameterNs = 'http://www.w3.org/ns/ttml#parameter'
const xmlNs = 'http://www.w3.org/XML/1998/namespace'
const ttNs = 'http://www.w3.org/ns/ttml'

function position(value: string, rate: Rate): number {
  const secondsClock = value.match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d(?:\.\d+)?)$/)
  if (secondsClock) return ((Number(secondsClock[1] ?? 0) * 60 + Number(secondsClock[2])) * 60 + Number(secondsClock[3])) * 1000
  const frameClock = value.match(/^(\d+):([0-5]\d):([0-5]\d):(\d+)(?:\.(\d+))?$/)
  if (frameClock) {
    const [, h, m, s, f, sf] = frameClock
    return (((Number(h) * 60 + Number(m)) * 60 + Number(s)) + (Number(f) + Number(sf ?? 0) / rate.subframes) / rate.frames) * 1000
  }
  const offset = value.match(/^(\d+(?:\.\d+)?)(ms|h|m|s|f|t)$/)
  if (!offset) return NaN
  return Number(offset[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, f: 1000 / rate.frames, t: 1000 / rate.ticks })[offset[2] as 'ms' | 's' | 'm' | 'h' | 'f' | 't']
}

function bounds(node: Element, parent: Bounds, rate: Rate, base: number): Bounds | undefined {
  const read = (name: string, fallback: number) => {
    const value = node.getAttribute(name)
    return value === null ? fallback : position(value.trim(), rate)
  }
  const start = base + read('begin', 0)
  const end = Math.min(base + read('end', Infinity), start + read('dur', Infinity), parent.end)
  if (!Number.isFinite(start) || Number.isNaN(end) || end < start) return
  return { start, end }
}

function paragraph(pieces: Piece[]): { text: string; words: RawCue[] } {
  const grouped: Piece[] = []
  let pending: Piece | undefined
  const append = (text: string, timing?: Bounds) => {
    const previous = grouped[grouped.length - 1]
    if (previous && previous.timing === timing) previous.text += text
    else grouped.push({ text, timing })
  }
  for (const piece of pieces) {
    if (piece.preserve || piece.text === '\n') {
      if (pending && piece.preserve) append(' ', pending.timing ?? piece.timing)
      pending = undefined
      append(piece.text, piece.timing ?? grouped[grouped.length - 1]?.timing)
      continue
    }
    for (const part of piece.text.split(/([ \t\r\n]+)/)) {
      if (!part) continue
      const previous = grouped[grouped.length - 1]
      if (/^[ \t\r\n]+$/.test(part)) {
        if (previous && !previous.text.endsWith('\n')) pending = piece
      } else {
        if (pending) append(' ', pending.timing ?? previous?.timing ?? piece.timing)
        pending = undefined
        append(part, piece.timing)
      }
    }
  }
  return {
    text: grouped.map(piece => piece.text).join(''),
    words: grouped.flatMap(({ text, timing }) => timing ? [{
      text, startMs: Math.round(timing.start), endMs: Number.isFinite(timing.end) ? Math.round(timing.end) : undefined,
    }] : []),
  }
}

export function parseTtml(source: string, durationMs?: number): LyricsResult {
  if (typeof DOMParser === 'undefined') return unavailable('TTML requires an XML parser in this runtime.')
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) return unavailable('TTML document types and entities are not supported.')
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  const root = doc.documentElement
  if (root.localName !== 'tt' || (root.namespaceURI && root.namespaceURI !== ttNs) || doc.getElementsByTagNameNS('*', 'parsererror').length) {
    return unavailable('Invalid TTML XML.')
  }
  const param = (key: string) => root.getAttributeNS(parameterNs, key)
  const timeBase = param('timeBase')
  if ((timeBase && timeBase !== 'media' && timeBase !== 'smpte') || (param('dropMode') && param('dropMode') !== 'nonDrop')) {
    return unavailable('Unsupported TTML time base.')
  }
  const [mult = 1, div = 1] = (param('frameRateMultiplier') ?? '1 1').trim().split(/\s+/).map(Number)
  const frames = Number(param('frameRate') ?? 30) * mult / div
  const subframes = Number(param('subFrameRate') ?? 1)
  const ticks = Number(param('tickRate') ?? (param('frameRate') || timeBase === 'smpte' ? frames * subframes : 1))
  if ([frames, subframes, ticks].some(value => !Number.isFinite(value) || value <= 0)) return unavailable('Invalid TTML frame or tick rate.')
  const rate = { frames, subframes, ticks }
  const cues: RawCue[] = []
  const plain: string[] = []
  const isTtml = (node: Element) => node.namespaceURI === root.namespaceURI
  // Apple Music's explicitly marked karaoke profile uses media-absolute span clocks.
  const absoluteKaraoke = Array.from(root.attributes).some(attr => attr.localName === 'timing'
    && attr.namespaceURI === 'http://music.apple.com/lyric-ttml-internal' && attr.value === 'Word')

  function walk(node: Element, parent: Bounds, base: number, inherited: boolean, preserve: boolean, depth: number,
    collect?: Piece[], wordTiming?: Bounds): Bounds | undefined {
    if (depth > 64 || !isTtml(node) || !['tt', 'body', 'div', 'p', 'span', 'br'].includes(node.localName)) return
    const explicit = ['begin', 'end', 'dur'].some(attr => node.hasAttribute(attr))
    const isP = node.localName === 'p'
    const isSpan = node.localName === 'span'
    const interval = bounds(node, parent, rate, absoluteKaraoke && explicit && (isP || isSpan) ? 0 : base)
    if (!interval) return
    interval.start = Math.max(parent.start, interval.start)
    if (interval.end < interval.start) return
    const xmlSpace = node.getAttributeNS(xmlNs, 'space')
    preserve = xmlSpace ? xmlSpace === 'preserve' : preserve
    const pieces = isP ? [] : collect
    const timing = isSpan && explicit ? interval : wordTiming
    const sequential = node.getAttribute('timeContainer') === 'seq'
    let previousEnd = interval.start
    let extent = interval.start
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        if (!Number.isFinite(previousEnd)) break
        const childElement = child as Element
        if (childElement.localName === 'br' && isTtml(childElement)) pieces?.push({ text: '\n', timing })
        const childInterval = walk(childElement, interval, sequential ? previousEnd : interval.start, inherited || explicit,
          preserve, depth + 1, pieces, timing)
        if (childInterval) {
          extent = Math.max(extent, childInterval.end)
          if (sequential) previousEnd = childInterval.end
        }
      } else if ((child.nodeType === 3 || child.nodeType === 4) && pieces) {
        pieces.push({ text: child.nodeValue ?? '', timing, preserve })
      }
    }
    if (isP) {
      const { text, words } = paragraph(pieces!)
      if (text.trim()) {
        plain.push(text)
        if (explicit || inherited || words.length) cues.push({
          startMs: explicit || inherited ? Math.round(interval.start) : words[0]!.startMs,
          endMs: Number.isFinite(interval.end) ? Math.round(interval.end) : undefined,
          text, words,
        })
      }
    }
    return { start: interval.start, end: Number.isFinite(interval.end) || extent === interval.start ? interval.end : extent }
  }
  walk(root, { start: 0, end: Infinity }, 0, false, false, 0)
  return cues.length ? timedResult(cues, durationMs) : plainResult(plain.join('\n'))
}
