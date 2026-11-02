import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Brand, Deck } from './schema';
import { RequestError } from './http';

export const imageTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' } as const;
export type ImageExtension = keyof typeof imageTypes;
export const assetTypes = { ...imageTypes, css: 'text/css' } as const;
export type AssetExtension = keyof typeof assetTypes;
const directory = () => resolve(process.cwd(), '.data/assets');
export function assetName(reference: string): string {
  const name = reference.split('/').pop()!;
  if (!/^[a-f0-9]{64}\.(jpg|png|webp|gif|svg|avif|css)$/.test(name)) throw new RequestError('Invalid image reference.');
  return name;
}
export function assetType(reference: string) { return assetTypes[assetName(reference).split('.').pop() as AssetExtension]; }
export async function storeAsset(bytes: Uint8Array, extension: AssetExtension = 'jpg'): Promise<string> {
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  await mkdir(directory(), { recursive: true });
  await writeFile(resolve(directory(), name), bytes, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return `/api/assets/${name}`;
}
export async function storeImage(bytes: Uint8Array): Promise<string> { return storeAsset(bytes); }
export async function readImage(reference: string): Promise<Buffer> {
  if (reference.startsWith('data:image/jpeg;base64,')) return Buffer.from(reference.split(',')[1], 'base64');
  try { return await readFile(resolve(directory(), assetName(reference))); }
  catch (error) { if (error instanceof RequestError) throw error; throw new RequestError('A saved image is missing. Open a portable backup or analyze the website again.', 404); }
}
export async function imageData(reference: string): Promise<string> {
  return `data:${reference.startsWith('data:') ? 'image/jpeg' : assetType(reference)};base64,${(await readImage(reference)).toString('base64')}`;
}
export async function externalizeBrand(brand: Brand | null): Promise<Brand | null> {
  if (!brand) return null;
  const store = async (reference: string) => reference.startsWith('data:') ? storeImage(await readImage(reference)) : reference;
  return { ...brand, screenshot: await store(brand.screenshot), captures: await Promise.all(brand.captures.map(store)),
    previews: await Promise.all(brand.previews.map(async p => ({ ...p, thumbnail: await store(p.thumbnail) }))) };
}
export async function deckAssetData(deck: Deck): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.entries(deck.assets ?? {}).map(async ([url, reference]) => [url, await imageData(reference)])));
}
