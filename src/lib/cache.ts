import { createHash } from 'node:crypto';

// One bounded process-local cache; content hashes change when HTML, dimensions,
// renderer behavior, or retained asset versions change. Nothing caches failures.
const shared = globalThis as typeof globalThis & { contentBuilderRenders?: Map<string, { value: unknown; bytes: number; expires: number }> };
shared.contentBuilderRenders ??= new Map();
const entries = shared.contentBuilderRenders;
export const cacheKey = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function cached<T>(key: string): T | undefined {
  const item = entries.get(key);
  if (!item) return;
  entries.delete(key);
  if (item.expires < Date.now()) return;
  entries.set(key, item); return item.value as T;
}
export function remember(key: string, value: unknown, bytes: number, ttl = 10 * 60_000) {
  if (bytes > 64 * 1024 * 1024) return;
  entries.delete(key); entries.set(key, { value, bytes, expires: Date.now() + ttl });
  let total = [...entries.values()].reduce((sum, item) => sum + item.bytes, 0);
  for (const [oldKey, item] of entries) {
    if (total <= 64 * 1024 * 1024 && entries.size <= 100) break;
    entries.delete(oldKey); total -= item.bytes;
  }
}
