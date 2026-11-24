import type { LyricLine, LyricWord } from './types'

export function upperBound<T extends LyricWord>(items: readonly T[], t: number): number {
  let a = 0, b = items.length
  while (a < b) {
    const m = (a + b) >>> 1
    if (items[m].startMs <= t) a = m + 1
    else b = m
  }
  return a
}

export interface Token extends LyricWord {
  from: number
  to: number
}

export interface Cue extends LyricLine {
  index: number
  tokens: readonly Token[]
  timed: boolean
  rtl: boolean
  mixed: boolean
  prefixEnd: number
}

export const rtlScript = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u
const strongLtr = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Devanagari}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const lineBreaks = new Intl.Segmenter(undefined, { granularity: 'word' })

export function safePieces(text: string): string[] {
  return Array.from(graphemes.segment(text), ({ segment }) => segment)
}

export function breakPoints(text: string): number[] {
  return Array.from(lineBreaks.segment(text), ({ index, segment }) => index + segment.length)
}

function alignTokens(line: LyricLine): Token[] {
  const tokens: Token[] = []
  let cursor = 0
  const boundaries = new Set(Array.from(graphemes.segment(line.text), ({ index }) => index))
  boundaries.add(line.text.length)
  const lower = line.text.toLowerCase()
  for (const word of line.words ?? []) {
    const text = word.text.trim()
    if (!text || !Number.isFinite(word.startMs) || !Number.isFinite(word.endMs)) continue
    const startMs = Math.max(line.startMs, word.startMs)
    const endMs = Math.min(line.endMs, word.endMs)
    if (endMs <= startMs || startMs < (tokens.at(-1)?.startMs ?? -Infinity)) continue
    let from = line.text.indexOf(text, cursor)
    if (from < 0 && lower.length === line.text.length) from = lower.indexOf(text.toLowerCase(), cursor)
    const to = from + text.length
    if (from < 0 || !boundaries.has(from) || !boundaries.has(to)) continue
    tokens.push({ startMs, endMs, text: line.text.slice(from, to), from, to })
    cursor = to
  }
  return tokens
}

export function buildTimeline(lines: readonly LyricLine[]): Cue[] {
  let prefixEnd = -Infinity
  return lines
    .filter(line => line.text.trim() && Number.isFinite(line.startMs) && Number.isFinite(line.endMs) && line.endMs > line.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((line, index) => {
      const words = alignTokens(line)
      const rtl = rtlScript.test(line.text), mixed = rtl && strongLtr.test(line.text)
      prefixEnd = Math.max(prefixEnd, line.endMs)
      return {
        ...line, index, prefixEnd, rtl, mixed, timed: words.length > 0,
        tokens: words.length > 0 ? words : [{ ...line, from: 0, to: line.text.length }],
      }
    })
}

export function findCue(cues: readonly Cue[], t: number): Cue | undefined {
  for (let i = upperBound(cues, t) - 1; i >= 0 && cues[i].prefixEnd > t; i--) {
    if (t < cues[i].endMs) return cues[i]
  }
  return undefined
}

export function tokenIndex(cue: Cue, t: number): number {
  return Math.max(0, upperBound(cue.tokens, t) - 1)
}

export function activeToken(cue: Cue, t: number): Token | undefined {
  let i = upperBound(cue.tokens, t) - 1
  for (; i >= 0; i--) if (t < cue.tokens[i].endMs) return cue.tokens[i]
  return undefined
}

export const clamp = (n: number, l = 0, h = 1) => Math.min(h, Math.max(l, n))
export const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x) }
export const settle = (t: number) => { const x = clamp(t); return 1 - (1 - x) ** 3 }
export const spring = (t: number) => { const x = clamp(t); return 1 - (1 - x) ** 3 * Math.cos(x * 5.2) }

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export function rand(seed: number, slot: number): number {
  let h = seed ^ Math.imul(slot + 1, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}
