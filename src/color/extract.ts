import { isArtworkDataUrl } from './artwork';
import { defaultPalette } from './palette';
import type { DynamicPalette } from './palette';
import type { ExtractMessage, PaletteMessage } from './workerProtocol';

interface Job {
  request: ExtractMessage;
  result: Promise<DynamicPalette>;
  resolve: (palette: DynamicPalette) => void;
}

const MAX_QUEUE = 4;
const JOB_TIMEOUT_MS = 5000;
let worker: Worker | undefined;
let active: Job | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let requestId = 0;
const queue: Job[] = [];

function finish(palette = defaultPalette): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  active?.resolve(palette);
  active = undefined;
  startNext();
}

function resetWorker(): void {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
  worker = undefined;
  finish();
}

function startNext(): void {
  if (active || queue.length === 0) return;
  active = queue.shift()!;
  try {
    if (!worker) {
      worker = new Worker(new URL('./palette.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<PaletteMessage>) => {
        if (active?.request.id === data.id) finish(data.palette ? Object.freeze(data.palette) : defaultPalette);
      };
      worker.onerror = resetWorker;
      worker.onmessageerror = resetWorker;
    }
    worker.postMessage(active.request);
    timer = setTimeout(resetWorker, JOB_TIMEOUT_MS);
  } catch {
    resetWorker();
  }
}

/** Resolve from native artwork bytes; malformed or unavailable artwork never rejects. */
export function paletteFromArtwork(dataUrl: string, artworkHash?: string): Promise<DynamicPalette> {
  if (typeof Worker === 'undefined' || !isArtworkDataUrl(dataUrl)) return Promise.resolve(defaultPalette);
  const hash = artworkHash?.trim();
  const validHash = hash && hash.length <= 128 ? hash : undefined;
  const duplicate = (job: Job | undefined) => !!job && (validHash
    ? job.request.artworkHash === validHash
    : !job.request.artworkHash && job.request.dataUrl === dataUrl);
  if (active && duplicate(active)) return active.result;
  const pending = queue.find(duplicate);
  if (pending) return pending.result;
  if (queue.length >= MAX_QUEUE) queue.shift()!.resolve(defaultPalette);
  let resolve!: Job['resolve'];
  const result = new Promise<DynamicPalette>(done => { resolve = done; });
  queue.push({ request: { id: ++requestId, dataUrl, artworkHash: validHash }, result, resolve });
  startNext();
  return result;
}
