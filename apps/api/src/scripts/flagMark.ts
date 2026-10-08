/**
 * THE DETAILMASTERS MARK, DRAWN IN ITS OWN COLOURS.
 *
 * The recipe was authored against the brand's first logo, a dark tile with a
 * DM monogram, and it drew that logo with `filter:invert(1)` so it would read
 * white on the dark slides. Two things went wrong once the brand moved on:
 *
 *   · the stored logo was an OPAQUE tile, so the invert turned its dark ground
 *     into a white box: the close's lockup showed a black DM on a white square,
 *     and the 5% watermark in every slide's corner was a pale square (Telmo,
 *     2026-10-08: "the colors of the logo in this post are messed up");
 *   · the brand's mark is now the raised flag (CRM PR #381/#382), whose gold
 *     cell an invert would turn blue.
 *
 * The kit's logo is now the light flag on transparent
 * (detailmasters-content/marketing/brand/flag-1000-transparent-light.png),
 * which already reads on a dark ground. So the invert comes off both rules, and
 * goes back on for the light (`.inverse`) surface only, with a half-turn of hue
 * so the gold cell stays gold-ish instead of turning blue.
 *
 * Applied by exact string match: a second run is a no-op, and a recipe that has
 * drifted is reported and left alone.
 *
 * A deck pins the recipe at its first export (`recipeSnapshot`), so the kit
 * edit only reaches decks composed after it. `--project <id>` applies the same
 * edits to one deck's snapshot, for a deck that has not been posted yet; a
 * posted deck should keep looking like what shipped.
 *
 *   npm run recipe:flag-mark --workspace=apps/api                        # report
 *   npm run recipe:flag-mark --workspace=apps/api -- --write              # store on the kit
 *   npm run recipe:flag-mark --workspace=apps/api -- --project <id> --write  # and on one deck
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { connectDb, disconnectDb } from '../db';
import type { BrandRecipe } from '@contentbuilder/shared';

const write = process.argv.includes('--write');
const projectAt = process.argv.indexOf('--project');
const projectId = projectAt >= 0 ? process.argv[projectAt + 1] : undefined;
const BACKUP = '/tmp/detailmasters-recipe-before-flag-mark.json';

/** [from, to, why] against the recipe's single authored stylesheet. */
const EDITS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'background:var(--cb-logo, none) center/contain no-repeat; filter:invert(1); opacity:.05; }',
    'background:var(--cb-logo, none) center/contain no-repeat; opacity:.05; }',
    'watermark: drawn in the mark\'s own colours',
  ],
  [
    '.cb-slide .monogram{ height:56px; width:56px; background:var(--cb-logo, none) center/contain no-repeat; filter:invert(1) brightness(1.25); flex:0 0 auto; }',
    '.cb-slide .monogram{ height:56px; width:56px; background:var(--cb-logo, none) center/contain no-repeat; flex:0 0 auto; }\n' +
      '.cb-slide.inverse .monogram, .cb-slide.inverse::after{ filter:invert(1) hue-rotate(180deg); }',
    'lockup mark: own colours on dark, inverted on the light surface only',
  ],
];

(async () => {
  await connectDb();
  const { BrandKitModel, BusinessModel } = await import('../models');
  const b = await BusinessModel.findOne({ name: /detailmasters/i }).lean<{ _id: unknown; name: string } | null>();
  if (!b) throw new Error('detailmasters business not found');
  const kit = await BrandKitModel.findOne({ businessId: b._id, status: 'approved' }).sort({ createdAt: -1 });
  if (!kit) throw new Error('no approved kit');

  /** The edits, applied to one recipe's stylesheet; reports each one. */
  const edit = (recipe: BrandRecipe, label: string): { css: string; applied: number } => {
    let css = recipe.stylesheet ?? '';
    let applied = 0;
    console.log(label);
    for (const [from, to, why] of EDITS) {
      if (css.includes(to) && !css.includes(from)) {
        console.log(`  ·  ${why} — already applied`);
        applied += 1;
        continue;
      }
      if (!css.includes(from)) {
        console.log(`  ?  ${why} — NOT FOUND, skipped`);
        continue;
      }
      css = css.replace(from, to);
      console.log(`  ✓  ${why}`);
      applied += 1;
    }
    return { css, applied };
  };

  const recipe = kit.get('recipe') as BrandRecipe;
  if (recipe.layers && Object.values(recipe.layers).some(Boolean)) {
    throw new Error('this recipe renders from layers; the edits below target the single stylesheet');
  }
  if (!existsSync(BACKUP)) await writeFile(BACKUP, JSON.stringify(recipe, null, 2));

  const onKit = edit(recipe, `kit ${String(kit._id)}`);
  console.log(`  ${onKit.applied}/${EDITS.length} edit(s) in place`);
  if (write) {
    kit.set('recipe', { ...recipe, stylesheet: onKit.css });
    await kit.save();
    console.log(`  stored (previous recipe: ${BACKUP})`);
  }

  if (projectId) {
    const { ProjectModel } = await import('../models');
    const project = await ProjectModel.findById(projectId);
    if (!project) throw new Error(`project ${projectId} not found`);
    const pinned = project.get('recipeSnapshot') as BrandRecipe | undefined;
    if (!pinned) {
      console.log(`project ${projectId} has no pinned recipe: it already renders from the kit`);
    } else {
      const onDeck = edit(pinned, `project ${projectId} (pinned recipe)`);
      console.log(`  ${onDeck.applied}/${EDITS.length} edit(s) in place`);
      if (write) {
        project.set('recipeSnapshot', { ...pinned, stylesheet: onDeck.css });
        await project.save();
        console.log('  stored');
      }
    }
  }
  if (!write) console.log('\nnothing written — re-run with --write to store it');
  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
