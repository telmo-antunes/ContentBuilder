import { config } from '../config';
import { DiskStorageProvider } from './DiskStorageProvider';
import type { StorageProvider } from './StorageProvider';

export type { StorageProvider, SaveOptions } from './StorageProvider';
export { DiskStorageProvider } from './DiskStorageProvider';

/** Public URL prefix under which the API serves stored media. */
export const MEDIA_ROUTE = '/media';
export const mediaPublicBase = `${config.apiUrl.replace(/\/+$/, '')}${MEDIA_ROUTE}`;

let provider: StorageProvider | null = null;

/** Singleton storage provider, selected by STORAGE_PROVIDER (disk for now). */
export function getStorage(): StorageProvider {
  if (provider) return provider;
  switch (config.storage.provider) {
    case 'disk':
    default:
      provider = new DiskStorageProvider(config.storage.dir, mediaPublicBase);
      break;
    // case 'cloudinary': provider = new CloudinaryStorageProvider(...); break;
  }
  return provider;
}
