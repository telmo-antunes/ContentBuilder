import { promises as fs } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import type { StoredMedia } from '@contentbuilder/shared';
import type { SaveOptions, StorageProvider } from './StorageProvider';

/**
 * Stores media on the local filesystem under `baseDir`, served back through the
 * API at `<publicBase>/<key>`. Keys are provider-agnostic relative paths like
 * "seed/apex-logo.png" or "uploads/<id>.png".
 */
export class DiskStorageProvider implements StorageProvider {
  constructor(
    private readonly baseDir: string,
    /** Public URL prefix, e.g. "http://localhost:4000/media". */
    private readonly publicBase: string,
  ) {}

  private resolve(key: string): string {
    // Prevent path traversal out of baseDir.
    const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = join(this.baseDir, safe);
    if (!full.startsWith(this.baseDir + sep) && full !== this.baseDir) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async save(key: string, data: Buffer, _opts?: SaveOptions): Promise<StoredMedia> {
    const full = this.resolve(key);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return { key, url: this.urlFor(key) };
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  urlFor(key: string): string {
    const clean = key.split(sep).join('/').replace(/^\/+/, '');
    return `${this.publicBase.replace(/\/+$/, '')}/${clean}`;
  }
}
