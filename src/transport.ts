/** The displayed player position is never adjusted by a lyric timing nudge. */
export function projectTransport(position: number | undefined, duration: number | undefined, offset = 0) {
  const end = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null;
  const playhead = typeof position === 'number' && Number.isFinite(position) && position >= 0
    ? Math.min(position, end ?? Infinity) : null;
  return {
    playhead,
    duration: end,
    fraction: playhead !== null && end !== null ? playhead / end : 0,
    cueTime: playhead === null ? null : Math.max(0, playhead + (Number.isFinite(offset) ? offset : 0)),
  };
}

export function formatTransportTime(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const suffix = String(seconds % 60).padStart(2, '0');
  return minutes < 60 ? `${minutes}:${suffix}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${suffix}`;
}
