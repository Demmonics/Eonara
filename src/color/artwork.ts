export const ARTWORK_DATA_URL_LIMIT = 16 * 1024 * 1024;
const imageHeader = /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp|x-ms-bmp|ico|x-icon|vnd\.microsoft\.icon|tiff);base64,/i;

export function isArtworkDataUrl(url: string): boolean {
  return url.length <= ARTWORK_DATA_URL_LIMIT && imageHeader.test(url);
}
