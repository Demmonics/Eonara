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

export type FontRole = 'kinetic' | 'system' | 'mono'
export type WrapPolicy = 'word-wall' | 'column' | 'row' | 'compact'
export type ContrastRole = 'accent-plate' | 'high-contrast' | 'editorial' | 'card'

export interface SceneTypography {
  readonly fontRole: FontRole
  readonly normalWeight: number
  readonly displayWeight: number
  readonly historyWeight: number
  readonly lineHeightRatio: number
  readonly maxInkWidth: number
  readonly wrapPolicy: WrapPolicy
  readonly opticalMarginEm: number
  readonly contrastRole: ContrastRole
}

const kineticDefault: SceneTypography = {
  fontRole: 'kinetic',
  normalWeight: 560,
  displayWeight: 670,
  historyWeight: 480,
  lineHeightRatio: 1.15,
  maxInkWidth: .86,
  wrapPolicy: 'word-wall',
  opticalMarginEm: .04,
  contrastRole: 'accent-plate',
}

export const sceneTypography: Record<StyleId, SceneTypography> = {
  ship: { ...kineticDefault, normalWeight: 560, displayWeight: 680, historyWeight: 500, lineHeightRatio: 1.14, maxInkWidth: .84, wrapPolicy: 'word-wall', opticalMarginEm: .05, contrastRole: 'accent-plate' },
  fisheye: { ...kineticDefault, normalWeight: 560, displayWeight: 660, historyWeight: 480, lineHeightRatio: 1.24, maxInkWidth: .75, wrapPolicy: 'column', opticalMarginEm: .03, contrastRole: 'high-contrast' },
  visual: { ...kineticDefault, normalWeight: 530, displayWeight: 640, historyWeight: 460, lineHeightRatio: 1.18, maxInkWidth: .76, wrapPolicy: 'column', opticalMarginEm: .04, contrastRole: 'editorial' },
  'fisheye-visual': { ...kineticDefault, normalWeight: 560, displayWeight: 660, historyWeight: 480, lineHeightRatio: 1.24, maxInkWidth: .76, wrapPolicy: 'column', opticalMarginEm: .03, contrastRole: 'high-contrast' },
  codestyle: { fontRole: 'mono', normalWeight: 520, displayWeight: 560, historyWeight: 450, lineHeightRatio: 1.36, maxInkWidth: .78, wrapPolicy: 'row', opticalMarginEm: 0, contrastRole: 'high-contrast' },
  'codestyle-visual': { fontRole: 'mono', normalWeight: 520, displayWeight: 560, historyWeight: 450, lineHeightRatio: 1.36, maxInkWidth: .78, wrapPolicy: 'row', opticalMarginEm: 0, contrastRole: 'high-contrast' },
  branches: { ...kineticDefault, normalWeight: 540, displayWeight: 650, historyWeight: 460, lineHeightRatio: 1.15, maxInkWidth: .90, wrapPolicy: 'compact', opticalMarginEm: .02, contrastRole: 'editorial' },
  web: { ...kineticDefault, normalWeight: 540, displayWeight: 660, historyWeight: 460, lineHeightRatio: 1.15, maxInkWidth: .86, wrapPolicy: 'compact', opticalMarginEm: .02, contrastRole: 'card' },
  constellation: { ...kineticDefault, normalWeight: 520, displayWeight: 640, historyWeight: 450, lineHeightRatio: 1.15, maxInkWidth: .88, wrapPolicy: 'compact', opticalMarginEm: .02, contrastRole: 'editorial' },
  'message-thread': { fontRole: 'system', normalWeight: 520, displayWeight: 600, historyWeight: 480, lineHeightRatio: 1.22, maxInkWidth: .70, wrapPolicy: 'row', opticalMarginEm: 0, contrastRole: 'card' },
  payments: { fontRole: 'system', normalWeight: 520, displayWeight: 610, historyWeight: 470, lineHeightRatio: 1.20, maxInkWidth: .88, wrapPolicy: 'row', opticalMarginEm: 0, contrastRole: 'card' },
  'map-journey': { ...kineticDefault, normalWeight: 540, displayWeight: 640, historyWeight: 470, lineHeightRatio: 1.14, maxInkWidth: .84, wrapPolicy: 'row', opticalMarginEm: .02, contrastRole: 'card' },
  notifications: { fontRole: 'system', normalWeight: 520, displayWeight: 620, historyWeight: 460, lineHeightRatio: 1.14, maxInkWidth: .88, wrapPolicy: 'row', opticalMarginEm: 0, contrastRole: 'card' },
}

export function normalizeStyleId(styleId: string): StyleId {
  if (styleId === 'thread') return 'message-thread'
  if (styleId === 'map') return 'map-journey'
  return (styleId in sceneTypography ? styleId : 'ship') as StyleId
}
