import type { SlideEvent, UsageInfo } from './operation';

export class ClientError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
export async function jsonRequest<T>(path: string, value?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, value === undefined ? { cache: 'no-store', signal } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new ClientError(result.error || 'The request failed. Please try again.', response.status);
  return result as T;
}
export async function streamRequest<T>(path: string, value: unknown, signal: AbortSignal,
  onProgress: (message: string) => void, onUsage: (usage: UsageInfo) => void, onSlide?: (event: SlideEvent) => void): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal });
  if (!response.ok) throw new ClientError((await response.json()).error || 'The request failed.', response.status);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'progress') onProgress(event.message);
        if (event.type === 'usage') onUsage(event.usage);
        if (event.type === 'slide') onSlide?.(event);
        if (event.type === 'error') throw new ClientError(event.message);
        if (event.type === 'result') { signal.throwIfAborted(); return event.value as T; }
      }
    }
    throw new ClientError('The connection ended before the result arrived. Your current draft is unchanged.');
  } finally { await reader.cancel().catch(() => {}); }
}
export function downloadJson(value: unknown, filename = 'contentbuilder-draft.json') {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = href; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

const assetPromises = new Map<string, Promise<string>>();
export function previewAsset(reference: string): Promise<string> {
  if (!/^\/api\/assets\/[a-f0-9]{64}\.(jpg|png|webp|gif|svg|avif|css)$/.test(reference)) return Promise.reject(new Error('Invalid saved image'));
  let promise = assetPromises.get(reference);
  if (!promise) {
    promise = fetch(reference).then(async response => {
      if (!response.ok) throw new Error('A saved image is missing. Open a portable backup or analyze the website again.');
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
    }).catch(error => { assetPromises.delete(reference); throw error; });
    assetPromises.set(reference, promise);
    if (assetPromises.size > 64) assetPromises.delete(assetPromises.keys().next().value!);
  }
  return promise;
}
