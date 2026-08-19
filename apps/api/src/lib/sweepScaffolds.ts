/**
 * Delete orphaned render-check scaffolds.
 *
 * `createRenderScaffold` writes a throwaway business + kit + project per deck
 * and `dispose()` removes them in a `finally`. A compose that never settles
 * never reaches that `finally`, so the scaffold survives — and a scaffold COPIES
 * the recipe it was measuring, so a leaked one reads as an extra brand with
 * identical geometry. Two of the six most recent brand kits turned out to be
 * leaked scaffolds, which quietly contaminated a recipe measurement.
 *
 * The sweep script has existed all along; nothing ever ran it. This is the same
 * logic as a function, so the API can clear them on start.
 */
import { BusinessModel, BrandKitModel, ProjectModel } from '../models';

/** Exactly what `createRenderScaffold` names them: `__<label>-<8 hex>`. */
export const SCAFFOLD_NAME = /^__[a-z-]+-[0-9a-f]{8}$/;

export interface SweepResult {
  businesses: number;
  kits: number;
  projects: number;
  /** Near-matches left alone because the name did not match exactly. */
  skipped: number;
}

export async function sweepRenderScaffolds(opts?: { dryRun?: boolean }): Promise<SweepResult> {
  // Matched on the anchored pattern rather than a prefix `$regex`, so a real
  // brand that merely starts with the same characters can never be swept.
  const all = await BusinessModel.find({ name: /^__/ }).select('_id name').lean();
  const scaffolds = all.filter((b) => SCAFFOLD_NAME.test(String(b.name)));
  const skipped = all.length - scaffolds.length;
  if (!scaffolds.length || opts?.dryRun) {
    return { businesses: scaffolds.length, kits: 0, projects: 0, skipped };
  }
  const ids = scaffolds.map((b) => b._id);
  const [projects, kits, businesses] = await Promise.all([
    ProjectModel.deleteMany({ businessId: { $in: ids } }),
    BrandKitModel.deleteMany({ businessId: { $in: ids } }),
    BusinessModel.deleteMany({ _id: { $in: ids } }),
  ]);
  return {
    businesses: businesses.deletedCount ?? 0,
    kits: kits.deletedCount ?? 0,
    projects: projects.deletedCount ?? 0,
    skipped,
  };
}
