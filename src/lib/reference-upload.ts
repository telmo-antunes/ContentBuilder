import { withPage } from './browser';
import { storeAsset } from './assets';
import { RequestError, checkOrigin } from './http';
import { MAX_REFERENCE_BYTES, type RevisionReference } from './schema';

const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export async function receiveReference(request: Request): Promise<RevisionReference> {
  checkOrigin(request);
  const type = request.headers.get('content-type')?.split(';')[0] as keyof typeof types;
  if (!Object.hasOwn(types, type)) throw new RequestError('Choose a PNG, JPEG or WebP image.', 415);
  if (Number(request.headers.get('content-length')) > MAX_REFERENCE_BYTES) throw new RequestError('Choose an image smaller than 10 MB.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('The image is empty. Choose another file.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_REFERENCE_BYTES) { await reader.cancel(); throw new RequestError('Choose an image smaller than 10 MB.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  const valid = type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new RequestError('This file is not a valid PNG, JPEG or WebP image. Choose another file.');
  let name: string;
  try { name = decodeURIComponent(request.headers.get('x-file-name') ?? 'Reference image').split(/[\\/]/).pop()!.trim().slice(0, 200) || 'Reference image'; }
  catch { throw new RequestError('The image filename could not be read. Rename the file and try again.'); }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  const normalized = await withPage(async page => {
    return page.evaluate(async data => {
      const image = new Image(); image.src = data;
      try { await image.decode(); } catch { return { error: 'This image could not be opened. Export it as PNG, JPEG or WebP and try again.' } as const; }
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width * height > 40_000_000) return { error: 'Choose an image with no more than 40 megapixels.' } as const;
      const resize = (edge: number, quality: number) => {
        const scale = Math.min(1, edge / Math.max(width, height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality).split(',')[1];
      };
      return { width, height, preview: resize(1568, .88), thumbnail: resize(320, .8) };
    }, `data:${type};base64,${bytes.toString('base64')}`);
  }, false, signal);
  if ('error' in normalized) throw new RequestError(normalized.error!);
  const [original, preview, thumbnail] = await Promise.all([
    storeAsset(bytes, types[type]), storeAsset(Buffer.from(normalized.preview, 'base64')), storeAsset(Buffer.from(normalized.thumbnail, 'base64')),
  ]);
  return { name, original, preview, thumbnail, width: normalized.width, height: normalized.height };
}
