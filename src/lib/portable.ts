import { z } from 'zod';
import { createHash } from 'node:crypto';
import { assetName, readImage, storeAsset, type ImageExtension } from './assets';
import { workspaceSchema, type Workspace } from './schema';
import { RequestError } from './http';

export const portableSchema = z.object({ format: z.literal('contentbuilder'), version: z.literal(1), workspace: workspaceSchema, assets: z.record(z.string()) });
export function references(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === 'string' && /^\/api\/assets\/[a-f0-9]{64}\.(jpg|png|webp|gif|svg|avif)$/.test(item)) found.add(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value); return [...found];
}
export async function packWorkspace(workspace: Workspace) {
  const assets: Record<string, string> = {}; let size = 0;
  for (const reference of references(workspace)) {
    const bytes = await readImage(reference); size += bytes.length;
    if (size > 40 * 1024 * 1024) throw new RequestError('This draft has more than 40 MB of assets. Remove unused references before saving a portable copy.', 413);
    assets[reference] = bytes.toString('base64');
  }
  return { format: 'contentbuilder' as const, version: 1 as const, workspace, assets };
}
export async function unpackWorkspace(raw: unknown): Promise<Workspace> {
  const bundle = portableSchema.parse(raw);
  const pending: Array<{ bytes: Buffer; extension: ImageExtension }> = []; let size = 0;
  for (const reference of references(bundle.workspace)) {
    const encoded = bundle.assets[reference];
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new RequestError('This backup is missing an image. Open a complete portable draft.');
    const name = assetName(reference); const bytes = Buffer.from(encoded, 'base64'); size += bytes.length;
    if (size > 40 * 1024 * 1024) throw new RequestError('This backup exceeds the 40 MB asset limit.', 413);
    if (createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0]) throw new RequestError('An image in this backup is damaged. Your current draft is unchanged.');
    pending.push({ bytes, extension: name.split('.')[1] as ImageExtension });
  }
  // Validate the complete bundle before materializing any immutable asset.
  for (const item of pending) await storeAsset(item.bytes, item.extension);
  return bundle.workspace;
}
