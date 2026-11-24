import { isArtworkDataUrl } from './artwork';
import { paletteFromPixels } from './quantize';
import type { DynamicPalette } from './palette';
import type { ExtractMessage, PaletteMessage } from './workerProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const CACHE_LIMIT = 64;
const LONG_EDGE = 96;
const cache = new Map<string, DynamicPalette>();

async function contentKey(bytes: Uint8Array<ArrayBuffer>): Promise<string | undefined> {
  // No weak-hash fallback: skip caching if this runtime does not expose SubtleCrypto.
  if (!scope.crypto?.subtle) return undefined;
  try {
    const digest = await scope.crypto.subtle.digest('SHA-256', bytes);
    return 'sha256:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

function cached(key: string | undefined): DynamicPalette | undefined {
  if (!key) return undefined;
  const palette = cache.get(key);
  if (palette) {
    cache.delete(key);
    cache.set(key, palette);
  }
  return palette;
}

async function extract({ dataUrl, artworkHash }: ExtractMessage): Promise<DynamicPalette | undefined> {
  if (!isArtworkDataUrl(dataUrl)) return undefined;
  let key = artworkHash ? `native:${artworkHash}` : undefined;
  const nativeHit = cached(key);
  if (nativeHit) return nativeHit;
  const comma = dataUrl.indexOf(',');
  const type = dataUrl.slice(5, comma - 7).toLowerCase();
  const raw = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  key ??= await contentKey(bytes);
  const hashHit = cached(key);
  if (hashHit) return hashHit;
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  let palette: DynamicPalette | undefined;
  try {
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!context) return undefined;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    palette = paletteFromPixels(context.getImageData(0, 0, width, height).data);
  } finally {
    bitmap.close();
  }
  if (key && palette) {
    cache.set(key, palette);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return palette;
}

scope.onmessage = async (event: MessageEvent<ExtractMessage>) => {
  const request = event.data;
  let palette: DynamicPalette | undefined;
  try {
    palette = await extract(request);
  } catch {
    // Malformed, unsupported and undecodable art all use the caller's fallback.
  }
  scope.postMessage({ id: request.id, palette } satisfies PaletteMessage);
};
