import mongoose from 'mongoose';
import { normalizeMediaUrl } from '../storage';

/**
 * Rewrites legacy ABSOLUTE media URLs to their root-relative form.
 *
 * Media URLs used to be persisted as `http://localhost:<API_PORT>/media/<key>`.
 * That made every stored document depend on the API keeping the same port
 * forever: move the API and images 404, and because the PNG exporter resolves a
 * failed image to `null`, the visible symptom was a blank slide rather than an
 * error. Storage now emits `/media/<key>`; this migration brings existing
 * records into line.
 *
 * The walk is deliberately SHAPE-AGNOSTIC. Media URLs live in brand kit logos,
 * homepage screenshots, harvested photos, slide photo arrays, project renders
 * and inside frozen `ProjectVersion` snapshots — enumerating those fields would
 * mean revisiting this file every time a schema gains a nested image. Instead
 * every string in every document is tested, and `normalizeMediaUrl` only
 * touches strings whose prefix is a bare HTTP origin followed by `/media/`.
 *
 * Idempotent: run it twice and the second run reports zero changes.
 */

/** Collections that can hold media URLs. Unknown/absent ones are skipped. */
const COLLECTIONS = [
  'businesses',
  'brandkits',
  'projects',
  'projectversions',
  'mediaassets',
  'videojobs',
  'settings',
] as const;

export interface MediaUrlMigrationStats {
  dryRun: boolean;
  /** Per-collection counts of documents scanned and documents changed. */
  collections: Array<{ name: string; scanned: number; changed: number; urls: number }>;
  /** A few before/after pairs, for eyeballing a dry run. */
  samples: Array<{ collection: string; from: string; to: string }>;
  totalChangedDocs: number;
  totalChangedUrls: number;
}

/**
 * Recursively rewrite media URLs in a plain value.
 * Returns the number of strings changed; mutates `value` in place.
 */
function rewriteValue(value: unknown, onChange: (from: string, to: string) => void): number {
  let changed = 0;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === 'string') {
        const next = normalizeMediaUrl(item);
        if (next !== item) {
          value[i] = next;
          onChange(item, next);
          changed++;
        }
      } else {
        changed += rewriteValue(item, onChange);
      }
    }
    return changed;
  }

  if (value && typeof value === 'object') {
    // Leave BSON leaf types (ObjectId, Date, Binary) alone.
    if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return 0;

    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const item = obj[key];
      if (typeof item === 'string') {
        const next = normalizeMediaUrl(item);
        if (next !== item) {
          obj[key] = next;
          onChange(item, next);
          changed++;
        }
      } else {
        changed += rewriteValue(item, onChange);
      }
    }
    return changed;
  }

  return 0;
}

export async function runMediaUrlMigration(
  opts: { dryRun?: boolean; sampleLimit?: number } = {},
): Promise<MediaUrlMigrationStats> {
  const dryRun = opts.dryRun ?? false;
  const sampleLimit = opts.sampleLimit ?? 8;

  const db = mongoose.connection.db;
  if (!db) throw new Error('runMediaUrlMigration: not connected to MongoDB');

  const present = new Set((await db.listCollections().toArray()).map((c) => c.name));

  const stats: MediaUrlMigrationStats = {
    dryRun,
    collections: [],
    samples: [],
    totalChangedDocs: 0,
    totalChangedUrls: 0,
  };

  for (const name of COLLECTIONS) {
    if (!present.has(name)) continue;

    const collection = db.collection(name);
    let scanned = 0;
    let changedDocs = 0;
    let changedUrls = 0;

    const cursor = collection.find({});
    for await (const doc of cursor) {
      scanned++;
      const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown };

      const urlsInDoc = rewriteValue(rest, (from, to) => {
        if (stats.samples.length < sampleLimit) {
          stats.samples.push({ collection: name, from, to });
        }
      });

      if (urlsInDoc === 0) continue;
      changedDocs++;
      changedUrls += urlsInDoc;

      if (!dryRun) {
        await collection.updateOne({ _id }, { $set: rest });
      }
    }

    stats.collections.push({ name, scanned, changed: changedDocs, urls: changedUrls });
    stats.totalChangedDocs += changedDocs;
    stats.totalChangedUrls += changedUrls;
  }

  return stats;
}

export function formatMediaUrlMigrationSummary(stats: MediaUrlMigrationStats): string {
  const lines: string[] = [];
  const verb = stats.dryRun ? 'would change' : 'changed';

  for (const c of stats.collections) {
    lines.push(`  ${c.name.padEnd(16)} scanned ${String(c.scanned).padStart(5)}  ${verb} ${c.changed} doc(s), ${c.urls} url(s)`);
  }

  if (stats.samples.length) {
    lines.push('', '  samples:');
    for (const s of stats.samples) {
      lines.push(`    [${s.collection}] ${s.from}`);
      lines.push(`    ${' '.repeat(s.collection.length + 3)}-> ${s.to}`);
    }
  }

  lines.push(
    '',
    stats.totalChangedUrls === 0
      ? '  nothing to do — all media URLs are already root-relative'
      : `  total: ${verb} ${stats.totalChangedDocs} document(s), ${stats.totalChangedUrls} url(s)`,
  );

  if (stats.dryRun && stats.totalChangedUrls > 0) {
    lines.push('  (dry run — nothing was written; re-run without --dry-run to apply)');
  }

  return lines.join('\n');
}
