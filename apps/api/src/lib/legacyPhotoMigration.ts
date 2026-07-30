/**
 * One-time migration of the legacy slide-level `mediaAssetId`.
 *
 * Slides once carried a single attached photo as `slide.mediaAssetId`. The
 * photos layer replaced it with `slide.photos[]` (slot fills / background /
 * free overlays), and a back-compat rule in the projects route used to fold the
 * legacy id in as a background *on save*. That rule made stored data lie: a
 * slide holding a legacy id with an empty `photos[]` showed no photo until some
 * unrelated edit saved the slide, at which point the picture appeared out of
 * nowhere. This migration does the fold ONCE, in the database, so the rule can
 * be deleted and `photos[]` is the only truth.
 *
 * It runs against the raw collections on purpose: once `mediaAssetId` is off the
 * Mongoose schema, hydrated documents no longer expose it, so a schema-driven
 * read could not see the very field it is meant to retire.
 *
 * Idempotent — a second run finds nothing and reports zero changes.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { ProjectModel, ProjectVersionModel } from '../models';

/** What the migration decided about one slide. */
export type SlideMigrationOutcome =
  /** Had a legacy id and no background — gains a background photo. */
  | 'migrated'
  /** Had a legacy id but `photos[]` already declares a background — id dropped. */
  | 'already-background'
  /** Carried a legacy id that is not a usable ObjectId — id dropped. */
  | 'dropped-invalid';

export interface SlideMigrationPlan {
  outcome: SlideMigrationOutcome;
  /** The rewritten photos array — only for 'migrated'. */
  photos?: unknown[];
}

/** Per-collection tallies, so the summary can name where each change landed. */
export interface CollectionStats {
  scanned: number;
  changed: number;
  slidesMigrated: number;
  slidesAlreadyBackground: number;
  slidesDroppedInvalid: number;
}

export interface LegacyPhotoMigrationStats {
  dryRun: boolean;
  projects: CollectionStats;
  versions: CollectionStats;
}

const emptyStats = (): CollectionStats => ({
  scanned: 0,
  changed: 0,
  slidesMigrated: 0,
  slidesAlreadyBackground: 0,
  slidesDroppedInvalid: 0,
});

/**
 * Is this stored value a usable media-asset reference? Accepts an ObjectId (how
 * projects store it) or an ObjectId-shaped string (how a Mixed version snapshot
 * may store it). Deliberately narrower than `Types.ObjectId.isValid`, which says
 * yes to bare numbers and any 12-character string.
 */
function isAssetRef(v: unknown): boolean {
  if (v instanceof Types.ObjectId) return true;
  if (typeof v === 'string') return Types.ObjectId.isValid(v);
  // Guard against a second copy of the bson ObjectId class in the tree.
  if (v && typeof v === 'object' && typeof (v as { toHexString?: unknown }).toHexString === 'function') {
    return true;
  }
  return false;
}

function hasBackground(photos: unknown[]): boolean {
  return photos.some((p) => Boolean(p) && typeof p === 'object' && (p as { placement?: unknown }).placement === 'background');
}

/**
 * Decide what happens to ONE raw slide. Returns null when the slide carries no
 * legacy field at all — i.e. nothing to do, which is what makes re-runs no-ops.
 */
export function planSlideMigration(slide: unknown): SlideMigrationPlan | null {
  if (!slide || typeof slide !== 'object') return null;
  const raw = slide as { mediaAssetId?: unknown; photos?: unknown };
  if (!('mediaAssetId' in raw)) return null;
  const legacy = raw.mediaAssetId;
  if (!isAssetRef(legacy)) return { outcome: 'dropped-invalid' };

  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  // The photos array is authoritative: if it already declares a background, the
  // legacy id is stale duplication and simply goes away.
  if (hasBackground(photos)) return { outcome: 'already-background' };

  return {
    outcome: 'migrated',
    // Existing slot/free photos keep their order; the background is appended.
    photos: [...photos, { id: randomUUID(), mediaAssetId: legacy, placement: 'background', fit: 'cover' }],
  };
}

interface RawDoc {
  _id: unknown;
  slides?: unknown;
}

/** Migrate one collection of slide-carrying documents. */
async function migrateCollection(
  collection: { find: (q: object, o: object) => { toArray: () => Promise<RawDoc[]> }; updateOne: (f: object, u: object) => Promise<unknown> },
  label: string,
  dryRun: boolean,
  log: (line: string) => void,
): Promise<CollectionStats> {
  const stats = emptyStats();
  // Project only the two fields that matter — slides carry authored HTML, and
  // the migration has no business dragging all of it into memory.
  const docs = await collection
    .find({}, { projection: { 'slides.mediaAssetId': 1, 'slides.photos': 1 } })
    .toArray();

  for (const doc of docs) {
    stats.scanned += 1;
    if (!Array.isArray(doc.slides)) continue;

    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    const notes: string[] = [];

    doc.slides.forEach((slide, i) => {
      const plan = planSlideMigration(slide);
      if (!plan) return;
      unset[`slides.${i}.mediaAssetId`] = '';
      if (plan.outcome === 'migrated') {
        set[`slides.${i}.photos`] = plan.photos;
        stats.slidesMigrated += 1;
      } else if (plan.outcome === 'already-background') {
        stats.slidesAlreadyBackground += 1;
      } else {
        stats.slidesDroppedInvalid += 1;
      }
      notes.push(`slide ${i}: ${plan.outcome}`);
    });

    if (!notes.length) continue;
    stats.changed += 1;
    log(`  ${dryRun ? 'would update' : 'updated'} ${label} ${String(doc._id)} — ${notes.join(', ')}`);
    if (dryRun) continue;
    await collection.updateOne(
      { _id: doc._id },
      { ...(Object.keys(set).length ? { $set: set } : {}), $unset: unset },
    );
  }
  return stats;
}

/**
 * Fold every legacy slide `mediaAssetId` into `photos[]` and drop the field,
 * across projects AND their version snapshots (an unmigrated snapshot would
 * silently lose its photo when restored).
 *
 * Uses the CURRENT mongoose connection — the caller connects (see
 * `scripts/migrateSlidePhotos.ts`), which also lets tests drive it directly.
 */
export async function runLegacyPhotoMigration(
  opts: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<LegacyPhotoMigrationStats> {
  const dryRun = Boolean(opts.dryRun);
  const log = opts.log ?? ((line: string) => console.log(line));

  const projects = await migrateCollection(ProjectModel.collection as never, 'project', dryRun, log);
  const versions = await migrateCollection(ProjectVersionModel.collection as never, 'version', dryRun, log);
  return { dryRun, projects, versions };
}

/** One block of human-readable summary lines (shared by the script and tests). */
export function formatMigrationSummary(stats: LegacyPhotoMigrationStats): string {
  const { projects, versions } = stats;
  return [
    stats.dryRun ? '[migrate:photos] DRY RUN — nothing was written' : '[migrate:photos] done',
    `  projects scanned:            ${projects.scanned}`,
    `  projects changed:            ${projects.changed}`,
    `  slides migrated:             ${projects.slidesMigrated}`,
    `  slides already had a bg:     ${projects.slidesAlreadyBackground}`,
    `  slides with an unusable id:  ${projects.slidesDroppedInvalid}`,
    `  versions scanned:            ${versions.scanned}`,
    `  versions changed:            ${versions.changed}`,
    `  version slides migrated:     ${versions.slidesMigrated}`,
    `  version slides w/ a bg:      ${versions.slidesAlreadyBackground}`,
    `  version slides unusable id:  ${versions.slidesDroppedInvalid}`,
  ].join('\n');
}
