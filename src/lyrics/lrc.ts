import { type RawCue, timedResult } from './timing'

const clock = '(\\d{1,6}):([0-5]?\\d)(?:[.:](\\d{1,3}))?'
const stamp = new RegExp(`^\\[${clock}\\]`)
const inline = new RegExp(`<${clock}>`, 'g')

function milliseconds(match: RegExpMatchArray): number {
  return Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number((match[3] ?? '').padEnd(3, '0'))
}

export function parseLrc(source: string, durationMs?: number) {
  // The LRC offset tag convention is positive for earlier display.
  const offset = Number(source.match(/^\s*\[offset:\s*([+-]?\d{1,8})\s*\]/im)?.[1] ?? 0)
  const cues: RawCue[] = []
  for (const line of source.split(/\r\n?|\n/)) {
    let content = line.trimStart()
    const times: number[] = []
    let match: RegExpMatchArray | null
    while ((match = content.match(stamp))) {
      times.push(milliseconds(match))
      content = content.slice(match[0].length).trimStart()
    }
    if (!times.length) continue
    const anchors = [...content.matchAll(inline)]
    const text = content.replace(inline, '').trim()
    for (const time of times) {
      const startMs = Math.max(0, time - offset)
      const cue: RawCue = { startMs, text }
      const delta = time - times[0]! - offset
      if (anchors.length) {
        const words: RawCue[] = []
        let valid = true
        let previous = startMs
        const prefix = content.slice(0, anchors[0]!.index)
        if (prefix.trim()) words.push({ text: prefix.trimStart(), startMs })
        for (let i = 0; i < anchors.length; i++) {
          const anchor = anchors[i]!
          const next = anchors[i + 1]
          const wordTime = Math.max(0, milliseconds(anchor) + delta)
          if (wordTime < previous) valid = false
          previous = wordTime
          const segment = content.slice(anchor.index! + anchor[0].length, next?.index)
          if (segment.trim() || next) words.push({ startMs: wordTime, text: segment })
          else if (words.length) cue.endMs = wordTime
        }
        if (valid && words.length) {
          words[0]!.text = words[0]!.text.trimStart()
          words[words.length - 1]!.text = words[words.length - 1]!.text.trimEnd()
          cue.words = words
        } else delete cue.endMs
      }
      cues.push(cue)
    }
  }
  return timedResult(cues, durationMs)
}
