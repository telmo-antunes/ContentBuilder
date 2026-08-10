/**
 * ORPHANED MEDIA — records that point at bytes which are no longer there.
 *
 * A `MediaAsset` is a database row and a file, and nothing keeps the two
 * together. A re-seed, a swapped `STORAGE_DIR`, a worktree with its own empty
 * `storage/`, a manual clean-up — any of those leaves the row behind. The row
 * then behaves like a real photograph everywhere it is counted: it lists in the
 * media library, it renders as a broken image, and (until the compose step
 * started checking) it talked the copywriter into asking for photo slots that
 * could never be filled.
 *
 * On one real machine 48 of 67 records for a single brand were orphans, and the
 * only symptom anybody saw was "photos never appear".
 *
 * So: a pass that names them. DRY BY DEFAULT — this deletes user records, and
 * the honest default for that is a report you can read before anything happens.
 */
import { MediaAssetModel } from '../models';
import { getStorage } from '../storage';

export interface OrphanReport {
  /** Every media record checked. */
  checked: number;
  /** Records whose bytes are missing from storage. */
  orphans: Array<{ id: string; businessId: string; key: string; label?: string }>;
  /** Orphans that some project or version snapshot still points at. */
  referenced: number;
  /** Records actually removed (0 unless `apply` was set). */
  removed: number;
}

/** How many records to ask storage about at once. */
const BATCH = 32;

/**
 * Find (and optionally remove) media whose file is gone.
 *
 * `businessId` narrows it to one brand; omitted, it sweeps everything.
 * `apply` performs the deletion — without it nothing is written, which is the
 * default because a false positive here destroys a user's record of a photo.
 *
 * A record that is still REFERENCED by a project or a version snapshot is
 * counted and reported but never removed even with `apply`: the reference would
 * simply become a dangling id, which is a worse failure than the one being
 * cleaned up, and a restored version would come back missing a picture it once
 * had. Those are for a human to look at.
 */
export async function sweepOrphanedMedia(opts?: {
  businessId?: string;
  apply?: boolean;
  limit?: number;
}): Promise<OrphanReport> {
  const { ProjectModel, ProjectVersionModel } = await import('../models');
  const filter = opts?.businessId ? { businessId: opts.businessId } : {};
  const docs = await MediaAssetModel.find(filter)
    .select('_id businessId key label')
    .limit(opts?.limit ?? 5000)
    .lean<Array<{ _id: unknown; businessId: unknown; key: string; label?: string }>>();

  const storage = getStorage();
  const orphans: OrphanReport['orphans'] = [];
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const present = await Promise.all(
      batch.map((d) => storage.exists(String(d.key)).catch(() => false)),
    );
    batch.forEach((d, j) => {
      if (!present[j]) {
        orphans.push({
          id: String(d._id),
          businessId: String(d.businessId),
          key: String(d.key),
          ...(d.label ? { label: d.label } : {}),
        });
      }
    });
  }

  // Which orphans are still pointed at by something the user can open.
  const ids = orphans.map((o) => o.id);
  const referencedIds = new Set<string>();
  if (ids.length) {
    for (const Model of [ProjectModel, ProjectVersionModel]) {
      const hits = await Model.find({ 'slides.photos.mediaAssetId': { $in: ids } })
        .select('slides.photos.mediaAssetId')
        .lean<Array<{ slides?: Array<{ photos?: Array<{ mediaAssetId?: unknown }> }> }>>();
      for (const doc of hits) {
        for (const s of doc.slides ?? []) {
          for (const p of s.photos ?? []) referencedIds.add(String(p.mediaAssetId));
        }
      }
    }
  }

  let removed = 0;
  if (opts?.apply) {
    const removable = orphans.filter((o) => !referencedIds.has(o.id));
    if (removable.length) {
      const res = await MediaAssetModel.deleteMany({ _id: { $in: removable.map((o) => o.id) } });
      removed = res.deletedCount ?? removable.length;
    }
  }

  return {
    checked: docs.length,
    orphans,
    referenced: orphans.filter((o) => referencedIds.has(o.id)).length,
    removed,
  };
}

/** One line per finding, for a script or a log. */
export function formatOrphanReport(r: OrphanReport): string {
  if (!r.orphans.length) return `${r.checked} media record(s) checked — every one has its file.`;
  const lines = [
    `${r.orphans.length} of ${r.checked} media record(s) have no file in storage.`,
    ...r.orphans.slice(0, 20).map((o) => `  ${o.id}  ${o.key}${o.label ? `  (${o.label})` : ''}`),
  ];
  if (r.orphans.length > 20) lines.push(`  …and ${r.orphans.length - 20} more`);
  if (r.referenced) {
    lines.push(
      `${r.referenced} of them are still used by a post or a saved version — those are never removed automatically.`,
    );
  }
  lines.push(r.removed ? `Removed ${r.removed}.` : 'Nothing was removed (dry run).');
  return lines.join('\n');
}
