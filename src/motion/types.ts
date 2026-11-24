export interface LyricWord {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
}

export interface LyricLine extends LyricWord {
  readonly words?: readonly LyricWord[]
}

export interface MotionOptions {
  width: number
  height: number
  foreground: string
  active: string
  muted: string
  highlightBackground: string
  highlightForeground: string
  font: string
  /** 1 is default (100 is also accepted for percentage-based controls). */
  size: number
  intensity: number
  speed: number
  reducedMotion: boolean
  /** True on the desktop overlay: drops nonessential scene decoration. */
  overlay?: boolean
  weight?: number
  fontWeight?: number
  pixelRatio?: number
  lowDetail?: boolean
  contrast?: number
  motionBlur?: number
}

export const styles = [
  { id: 'ship', name: 'Ship', category: 'Typography', description: 'Words land on a drifting wall of type.' },
  { id: 'fisheye', name: 'Fisheye', category: 'Typography', description: 'Three words roll through the focal point of a lens.' },
  { id: 'visual', name: 'Visual', category: 'Typography', description: 'Illustrated words settle into a quiet editorial stack.' },
  { id: 'fisheye-visual', name: 'Fisheye Visual', category: 'Typography', description: 'A curved word stack with an illustrated focal point.' },
  { id: 'codestyle', name: 'Codestyle', category: 'Typography', description: 'Lyrics unfold along a measured monospaced column.' },
  { id: 'codestyle-visual', name: 'Codestyle Visual', category: 'Typography', description: 'Drawn marginalia follow words through the code column.' },
  { id: 'branches', name: 'Branches', category: 'Spatial', description: 'A splayed path grows toward each new word.' },
  { id: 'web', name: 'Web', category: 'Spatial', description: 'Tensioned strands hold the words in a radial field.' },
  { id: 'constellation', name: 'Constellation', category: 'Spatial', description: 'Lyric cues ignite into a slowly forming star chart.' },
  { id: 'message-thread', name: 'Message Thread', category: 'Interface', description: 'Alternating lyric bubbles gather in a measured conversation.' },
  { id: 'payments', name: 'Payments', category: 'Interface', description: 'A fictional cue ledger rolls forward, one entry per line.' },
  { id: 'map-journey', name: 'Map Journey', category: 'Spatial', description: 'Follow the words along a route through an invented neighborhood.' },
  { id: 'notifications', name: 'Notifications', category: 'Interface', description: 'The newest lyric lifts to the top of a floating glass stack.' },
] as const

export type StyleId = typeof styles[number]['id']
