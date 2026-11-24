import { demoLines } from './demo'
import type { LyricLine, LyricWord } from './motion/types'

export type FixtureSetId =
  | 'demo'
  | 'one-word'
  | 'three-word'
  | 'six-word'
  | 'ten-plus'
  | 'punctuation'
  | 'repeated'
  | 'gaps'
  | 'rapid'
  | 'wide-word'
  | 'emoji'
  | 'rtl'
  | 'mixed-script'
  | 'line-only'
  | 'suite'

export interface FixtureSpec {
  id: FixtureSetId
  label: string
  durationMs: number
  sampleTimesMs: readonly number[]
  lines: readonly LyricLine[]
}

function timed(text: string, startMs: number, endMs: number, tokens?: readonly string[]): LyricLine {
  const list = tokens ? [...tokens] : text.split(/\s+/u).filter(Boolean)
  const weights = list.map(word => Math.sqrt(Math.max(1, Array.from(word).length) + 2))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let cursor = startMs
  const words: LyricWord[] = list.map((word, index) => {
    const next = index === list.length - 1 ? endMs : cursor + ((endMs - startMs) * weights[index]) / total
    const entry: LyricWord = { startMs: Math.round(cursor), endMs: Math.round(next), text: word }
    cursor = next
    return entry
  })
  return { startMs, endMs, text, words }
}

export const fixtureSpecs: Record<FixtureSetId, FixtureSpec> = {
  demo: {
    id: 'demo',
    label: 'Built-in Demo',
    durationMs: 25_000,
    sampleTimesMs: [120, 620, 1280, 2100, 3450, 4250, 5600, 7200],
    lines: demoLines,
  },
  'one-word': {
    id: 'one-word',
    label: 'Single Word',
    durationMs: 2200,
    sampleTimesMs: [0, 50, 100, 200, 350, 500, 750, 1000],
    lines: [timed('Still', 0, 1800, ['Still'])],
  },
  'three-word': {
    id: 'three-word',
    label: 'Three Words',
    durationMs: 2800,
    sampleTimesMs: [0, 120, 500, 900, 1500, 2100],
    lines: [timed('Blue hours open', 0, 2400)],
  },
  'six-word': {
    id: 'six-word',
    label: 'Six & Seven Words',
    durationMs: 5600,
    sampleTimesMs: [0, 100, 350, 500, 750, 1000, 1550, 1950, 2500, 3100, 3800],
    lines: [
      timed('Silver headlights drift across the avenue', 0, 2450),
      timed('Paper lanterns brighten every quiet corner tonight', 2700, 5400),
    ],
  },
  'ten-plus': {
    id: 'ten-plus',
    label: 'Ten Plus Words',
    durationMs: 5400,
    sampleTimesMs: [120, 950, 1800, 2700, 3600, 4600],
    lines: [
      timed('When evening settles down the narrow stone steps beside the water', 0, 5100),
    ],
  },
  punctuation: {
    id: 'punctuation',
    label: 'Sentence Punctuation',
    durationMs: 4200,
    sampleTimesMs: [120, 680, 1450, 2250, 3100, 3750],
    lines: [
      timed(
        'Wait—"hold on," she whispered; then, almost suddenly: quiet!',
        0,
        4000,
        ['Wait', 'hold', 'on', 'she', 'whispered', 'then', 'almost', 'suddenly', 'quiet'],
      ),
    ],
  },
  repeated: {
    id: 'repeated',
    label: 'Repeated Words (Distinct IDs)',
    durationMs: 4400,
    sampleTimesMs: [100, 620, 1150, 1700, 2300, 2850, 3450, 3950],
    lines: [
      timed(
        'night after night, light meets light inside the night',
        0,
        4200,
        ['night', 'after', 'night', 'light', 'meets', 'light', 'inside', 'the', 'night'],
      ),
    ],
  },
  gaps: {
    id: 'gaps',
    label: 'Instrumental & Intra-Cue Gaps',
    durationMs: 5600,
    sampleTimesMs: [650, 1300, 2400, 3750, 4300, 4850],
    lines: [
      timed('Silence keeps its own rhythm', 400, 1800),
      {
        startMs: 3600,
        endMs: 5200,
        text: 'Hold fast',
        words: [
          { startMs: 3600, endMs: 4050, text: 'Hold' },
          { startMs: 4650, endMs: 5200, text: 'fast' },
        ],
      },
    ],
  },
  rapid: {
    id: 'rapid',
    label: 'Near-Simultaneous Rapid Cadence',
    durationMs: 1400,
    sampleTimesMs: [0, 30, 60, 90, 140, 210, 350, 650],
    lines: [
      {
        startMs: 0,
        endMs: 1100,
        text: 'tap step spin turn drop hold still',
        words: [
          { startMs: 0, endMs: 32, text: 'tap' },
          { startMs: 32, endMs: 65, text: 'step' },
          { startMs: 65, endMs: 100, text: 'spin' },
          { startMs: 100, endMs: 140, text: 'turn' },
          { startMs: 140, endMs: 210, text: 'drop' },
          { startMs: 210, endMs: 480, text: 'hold' },
          { startMs: 480, endMs: 1100, text: 'still' },
        ],
      },
    ],
  },
  'wide-word': {
    id: 'wide-word',
    label: 'Unusually Wide Word',
    durationMs: 3200,
    sampleTimesMs: [100, 520, 1250, 2450],
    lines: [
      timed('the electroencephalographically bright room', 0, 3000),
    ],
  },
  emoji: {
    id: 'emoji',
    label: 'Emoji & Clusters',
    durationMs: 3200,
    sampleTimesMs: [120, 720, 1550, 2450],
    lines: [
      timed('Moonlight ✨ through rainy 🌧️🪟 streets 🎶', 0, 3000),
    ],
  },
  rtl: {
    id: 'rtl',
    label: 'Right-to-Left Arabic',
    durationMs: 3400,
    sampleTimesMs: [150, 820, 1650, 2600],
    lines: [
      timed('الليل يفتح نافذة للضوء الهادئ', 0, 3200),
    ],
  },
  'mixed-script': {
    id: 'mixed-script',
    label: 'Mixed Bidirectional & Multi-Script',
    durationMs: 3400,
    sampleTimesMs: [150, 820, 1700, 2600],
    lines: [
      timed('Night ليل 光 और सुबह dawn', 0, 3200),
    ],
  },
  'line-only': {
    id: 'line-only',
    label: 'Line-Only Input',
    durationMs: 4400,
    sampleTimesMs: [180, 1100, 2350, 3600],
    lines: [
      { startMs: 0, endMs: 2000, text: 'No per-word timing on this line' },
      { startMs: 2150, endMs: 4200, text: 'Second untimed line follows closely' },
    ],
  },
  suite: {
    id: 'suite',
    label: 'Multi-Phrase Comprehensive Suite',
    durationMs: 16_000,
    sampleTimesMs: [120, 750, 1450, 2900, 4400, 6200, 8100, 10_400, 12_600, 14_500],
    lines: [
      timed('Silver headlights drift across the avenue', 0, 2500),
      timed('Paper lanterns brighten every quiet corner tonight', 2700, 5300),
      timed('night after night, light meets light', 5600, 8200, ['night', 'after', 'night', 'light', 'meets', 'light']),
      timed('the electroencephalographically bright room', 8500, 11_000),
      { startMs: 11_400, endMs: 13_400, text: 'No per-word timing on this line' },
      timed('Blue hours open', 13_600, 15_700),
    ],
  },
}

export function getFixtureSpec(id?: string | null): FixtureSpec {
  if (id && id in fixtureSpecs) return fixtureSpecs[id as FixtureSetId]
  return fixtureSpecs.suite
}

export const allFixtureIds = Object.keys(fixtureSpecs) as FixtureSetId[]
