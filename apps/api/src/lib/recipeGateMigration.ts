/**
 * Run the author-time recipe gates over recipes ALREADY in the database.
 *
 * The gates (contrast repair, list-skeleton strip, consistency, type floor) only
 * fire when a recipe is authored. Every kit stored before a gate existed still
 * carries the old CSS, and the renderer compensates for it on every single
 * paint — a permanent crutch rather than a safety net.
 *
 * This applies the same deterministic repairs once, in place, so what is stored
 * is what the current pipeline would have produced. It is NOT a re-author: no
 * model is called, no design decision changes, nothing costs anything. Anything
 * that would need judgement is left alone and reported.
 *
 * Idempotent by construction — every repair it runs is itself idempotent, so a
 * second pass reports zero changes.
 */
import {
  enforceTypeFloor,
  ensureListSkeleton,
  typeFloorReport,
  type BrandRecipe,
} from '@contentbuilder/shared';
import { fillRecipeFragmentGaps } from './htmlDirector/fragments';
import { BrandKitModel } from '../models';

export interface RecipeGateStats {
  kitsScanned: number;
  kitsChanged: number;
  /** Selectors that had the app-owned list skeleton stripped out. */
  listSkeletonStripped: string[];
  /** Undersized type that was raised, as `role 30→44`. */
  typeRaised: string[];
  /** Fragment holes added, as "role: part+part". */
  fragmentsFilled: string[];
}

/** The CSS a recipe actually renders from — the layers, or the single blob. */
function partsOf(recipe: BrandRecipe): Array<'background' | 'type' | 'components' | 'stylesheet'> {
  return recipe.layers ? ['background', 'type', 'components'] : ['stylesheet'];
}

function readPart(recipe: BrandRecipe, part: string): string {
  if (part === 'stylesheet') return recipe.stylesheet ?? '';
  return (recipe.layers as Record<string, string> | undefined)?.[part] ?? '';
}

function writePart(recipe: BrandRecipe, part: string, css: string): BrandRecipe {
  if (part === 'stylesheet') return { ...recipe, stylesheet: css };
  const layers = (recipe.layers ?? { background: '', type: '', components: '' }) as Record<string, string>;
  return { ...recipe, layers: { ...layers, [part]: css } as BrandRecipe['layers'] };
}

/**
 * Repair one recipe. Returns the recipe plus what changed, so a dry run can
 * report without writing.
 */
export function gateStoredRecipe(recipe: BrandRecipe): {
  recipe: BrandRecipe;
  listSkeletonStripped: string[];
  typeRaised: string[];
  fragmentsFilled: string[];
} {
  // 1. The list skeleton belongs to the app; strip the brand's competing one.
  const list = ensureListSkeleton(recipe);
  let next = list.recipe;

  // 2. The legibility floor, baked in rather than applied at every render.
  const typeRaised: string[] = [];
  for (const part of partsOf(next)) {
    const before = readPart(next, part);
    if (!before) continue;
    for (const r of typeFloorReport(before)) typeRaised.push(`${r.role} ${r.from}→${r.to}`);
    const after = enforceTypeFloor(before);
    if (after !== before) next = writePart(next, part, after);
  }

  // 3. Fragment gaps. A hole this brand's fragments were authored without sends
  //    every slide that needs the part to the composer; adding it is free, uses
  //    only classes the brand already advertises, and pays for itself the first
  //    time a deck is composed.
  const filled = fillRecipeFragmentGaps(next);
  next = filled.recipe;

  return {
    recipe: next,
    listSkeletonStripped: list.repairs,
    typeRaised: [...new Set(typeRaised)],
    fragmentsFilled: filled.repairs.map((r) => `${r.role}: ${r.added.join('+')}`),
  };
}

export async function runRecipeGateMigration(opts: { dryRun?: boolean } = {}): Promise<RecipeGateStats> {
  const stats: RecipeGateStats = {
    kitsScanned: 0,
    kitsChanged: 0,
    listSkeletonStripped: [],
    typeRaised: [],
    fragmentsFilled: [],
  };

  const kits = await BrandKitModel.find({ recipe: { $exists: true, $ne: null } });
  for (const kit of kits) {
    const recipe = kit.get('recipe') as BrandRecipe | undefined;
    if (!recipe) continue;
    stats.kitsScanned += 1;

    const out = gateStoredRecipe(recipe);
    const changed =
      out.listSkeletonStripped.length > 0 || out.typeRaised.length > 0 || out.fragmentsFilled.length > 0;
    if (!changed) continue;

    stats.kitsChanged += 1;
    stats.listSkeletonStripped.push(...out.listSkeletonStripped);
    stats.typeRaised.push(...out.typeRaised);
    stats.fragmentsFilled.push(...out.fragmentsFilled);
    if (!opts.dryRun) {
      kit.set('recipe', out.recipe);
      // Mixed paths need marking or Mongoose will not persist the change.
      kit.markModified('recipe');
      await kit.save();
    }
  }

  stats.listSkeletonStripped = [...new Set(stats.listSkeletonStripped)];
  stats.typeRaised = [...new Set(stats.typeRaised)];
  stats.fragmentsFilled = [...new Set(stats.fragmentsFilled)];
  return stats;
}

export function formatRecipeGateSummary(s: RecipeGateStats): string {
  const lines = [
    `[migrate:recipes] scanned ${s.kitsScanned} kit(s), ${s.kitsChanged} needed repair`,
  ];
  if (s.listSkeletonStripped.length) {
    lines.push(`  list skeleton stripped from: ${s.listSkeletonStripped.join(', ')}`);
  }
  if (s.typeRaised.length) lines.push(`  type raised: ${s.typeRaised.join(', ')}`);
  if (s.fragmentsFilled.length) lines.push(`  fragment holes added: ${s.fragmentsFilled.join(', ')}`);
  if (!s.kitsChanged) lines.push('  nothing to do — every stored recipe already matches the gates');
  return lines.join('\n');
}
