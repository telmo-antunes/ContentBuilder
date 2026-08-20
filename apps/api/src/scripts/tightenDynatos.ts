/**
 * TIGHTEN THE DYNATÓS SCALE UNTIL A LOADED SLIDE FITS.
 *
 * The re-authored recipe overflows a slide carrying every part its role allows
 * — `list` by 63px on 4:5. Measuring where the height goes says the fault is
 * NOT the display type:
 *
 *   the panel is 722px of a 1154px usable frame, and the brand authored its
 *   rows at 32px/24px while they RENDER at 41px/34px, because the legibility
 *   floor raises anything below 15pt. Same for the eyebrow (28→34), the body
 *   (34→44) and the handle (26→34).
 *
 * So the sizes that overflow are the ones held UP by the floor, and lowering
 * the authored value changes nothing — the floor puts it back on the next
 * paint. What can give is spacing calibrated for type that is now bigger than
 * it was written for, and the display sizes the floor does not govern
 * (headline, stat, and the 2px between the tagline and its own floor).
 *
 * Each edit below is a pair: the authored value, and what it becomes. Applied
 * by exact string match, so a second run is a no-op and a recipe that has
 * drifted is left alone rather than half-rewritten.
 *
 *   npm run recipe:tighten --workspace=apps/api            # report
 *   npm run recipe:tighten --workspace=apps/api -- --write # store it
 */
import { writeFile } from 'node:fs/promises';
import { connectDb, disconnectDb } from '../db';
import type { BrandRecipe } from '@contentbuilder/shared';

const write = process.argv.includes('--write');
/** Put back the recipe as it was before the first run, so the edits can be re-tuned. */
const restore = process.argv.includes('--restore');

/** [layer, from, to, why] — the whole change, as data. */
const EDITS: ReadonlyArray<readonly ['type' | 'components', string, string, string]> = [
  // Display type: the floor's headline minimum is 71px and stat's is 110px, so
  // there is real room here and it is the only type that can honestly give.
  //
  // Gentle on purpose. The first pass cut these hard (114→104, 82→74, 204→178)
  // and fixed the overflow — then `feature` and `stat` reported EXCESS SLACK,
  // because shrinking the type on a slide that already fit just opens a hole.
  // Only `list` and `cta` were ever tight, and neither is what these sizes
  // drive, so the display scale gives a little and the spacing gives the rest.
  ['type', 'font-size:114px; line-height:.94;', 'font-size:108px; line-height:.94;', 'headline 114 → 108'],
  ['type', '.cb-slide .headline.sm{ font-size:82px; }', '.cb-slide .headline.sm{ font-size:78px; }', 'headline.sm 82 → 78'],
  ['type', 'font-size:204px; line-height:.86;', 'font-size:196px; line-height:.86;', 'stat 204 → 196'],
  // Spacing written for type the floor has since raised.
  ['type', 'margin-top:calc(26px * var(--cb-step,1))', 'margin-top:calc(21px * var(--cb-step,1))', 'headline gap 26 → 21'],
  ['type', 'font-size:46px; line-height:1.28; margin-top:34px;', 'font-size:44px; line-height:1.24; margin-top:24px;', 'tagline 46 → 44 (its floor), gap 34 → 24'],
  ['type', 'font-size:34px; line-height:1.5; color:var(--cb-ink-muted); margin-top:28px;', 'font-size:34px; line-height:1.45; color:var(--cb-ink-muted); margin-top:22px;', 'body gap 28 → 22'],
  ['type', 'font-size:26px; color:#8f8778; margin-top:32px;', 'font-size:26px; color:#8f8778; margin-top:24px;', 'handle gap 32 → 24'],
  ['type', 'font-size:26px; color:#b3891a; margin-top:36px;', 'font-size:26px; color:#b3891a; margin-top:28px;', 'attribution gap 36 → 28'],
  // The panel, which is 62% of a list slide.
  ['components', 'padding:30px 32px;', 'padding:22px 28px;', 'panel padding 30/32 → 22/28'],
  ['components', '.cb-slide .panel .row{ padding:16px 0;', '.cb-slide .panel .row{ padding:11px 0;', 'row padding 16 → 11'],
  ['components', 'font-size:24px; color:#8f8778; margin-top:4px;', 'font-size:24px; color:#8f8778; margin-top:2px;', 'row note gap 4 → 2'],
  ['components', 'background:var(--cb-accent); margin:36px 0;', 'background:var(--cb-accent); margin:28px 0;', 'rule margin 36 → 28'],
  ['components', 'padding:28px 46px; font-size:32px;', 'padding:22px 42px; font-size:32px;', 'cta padding 28/46 → 22/42'],
];

/**
 * The 1:1 override needs its own pass. It is the SHORTEST canvas (928px usable
 * against 4:5's 1154) and it authors the panel rows smaller still — 26px, which
 * the floor raises to 41px exactly as it does on 4:5. Same rows, same floored
 * height, 226px less frame to put them in, so `list` overflows here after 4:5
 * is already clean.
 */
const SQUARE_EDITS: ReadonlyArray<readonly [string, string, string]> = [
  // Each pair goes from the value the author wrote STRAIGHT to the final one.
  // Tuning these in steps left the intermediate values in the `from` strings,
  // and a second run then reported half of them "NOT FOUND" — the stored CSS
  // was correct either way, but a script whose own report is wrong on a re-run
  // is not one anybody should trust.
  [
    '.cb-slide .panel{ padding:24px 26px; }',
    '.cb-slide .panel{ padding:12px 20px; margin-top:4px; }\n.cb-slide .handle{ margin-top:14px; }',
    'square panel padding 24/26 → 12/20, its gap 8 → 4, and a sign-off gap of 14 the block never had',
  ],
  [
    '.cb-slide .panel .row{ font-size:26px; padding:12px 0; }',
    '.cb-slide .panel .row{ font-size:26px; padding:4px 0; }',
    'square row padding 12 → 4',
  ],
  [
    '.cb-slide .headline{ font-size:94px; line-height:.96; margin-top:20px; }',
    '.cb-slide .headline{ font-size:90px; line-height:.96; margin-top:16px; }',
    'square headline 94 → 90, gap 20 → 16',
  ],
  /**
   * The tagline's 23ch measure is a base-layer design decision and a good one on
   * a tall canvas. Here it costs a whole second line — 55px of a frame that is
   * 226px shorter — so it is widened for THIS format only, which leaves the look
   * on 4:5 and 9:16 exactly as the brand authored it.
   */
  [
    '.cb-slide .tagline{ font-size:38px; margin-top:24px; }',
    '.cb-slide .tagline{ font-size:38px; margin-top:12px; max-width:34ch; }',
    'square tagline one line, gap 24 → 12',
  ],
  [
    '.cb-slide .body{ font-size:30px; margin-top:22px; }',
    '.cb-slide .body{ font-size:30px; margin-top:12px; }',
    'square body gap 22 → 12',
  ],
  ['.cb-slide .rule{ margin:26px 0; }', '.cb-slide .rule{ margin:19px 0; }', 'square rule margin 26 → 19'],
];

(async () => {
  await connectDb();
  const { BrandKitModel, BusinessModel } = await import('../models');
  const b = await BusinessModel.findOne({ name: /Dynat/i }).lean<{ _id: unknown; name: string } | null>();
  if (!b) throw new Error('Dynatós Program not found');
  const kit = await BrandKitModel.findOne({ businessId: b._id, status: 'approved' }).sort({ createdAt: -1 });
  if (!kit) throw new Error('no approved kit');

  if (restore) {
    const { readFile } = await import('node:fs/promises');
    const was = JSON.parse(await readFile('/tmp/dynatos-recipe-before-tighten.json', 'utf8')) as BrandRecipe;
    kit.set('recipe', was);
    await kit.save();
    console.log('restored the recipe as it was before the first tighten');
    await disconnectDb();
    return;
  }

  const recipe = kit.get('recipe') as BrandRecipe;
  const layers = { ...(recipe.layers ?? {}) } as Record<string, string>;
  const { existsSync } = await import('node:fs');
  if (!existsSync('/tmp/dynatos-recipe-before-tighten.json'))
    await writeFile('/tmp/dynatos-recipe-before-tighten.json', JSON.stringify(recipe, null, 2));

  let applied = 0;
  for (const [layer, from, to, why] of EDITS) {
    const css = layers[layer] ?? '';
    if (css.includes(to) && !css.includes(from)) {
      console.log(`  ·  ${why} — already applied`);
      applied += 1;
      continue;
    }
    if (!css.includes(from)) {
      console.log(`  ?  ${why} — NOT FOUND, skipped`);
      continue;
    }
    layers[layer] = css.replace(from, to);
    console.log(`  ✓  ${why}`);
    applied += 1;
  }

  const formats = { ...(recipe.formats ?? {}) } as Record<string, { stylesheet?: string }>;
  const square = formats['1080x1080'];
  let squareApplied = 0;
  if (square?.stylesheet) {
    let css = square.stylesheet;
    for (const [from, to, why] of SQUARE_EDITS) {
      if (css.includes(to) && !css.includes(from)) { console.log(`  ·  ${why} — already applied`); squareApplied += 1; continue; }
      if (!css.includes(from)) { console.log(`  ?  ${why} — NOT FOUND, skipped`); continue; }
      css = css.replace(from, to);
      console.log(`  ✓  ${why}`);
      squareApplied += 1;
    }
    formats['1080x1080'] = { ...square, stylesheet: css };
  }

  console.log(`\n${applied}/${EDITS.length} base edit(s) + ${squareApplied}/${SQUARE_EDITS.length} square edit(s) in place`);
  if (write) {
    kit.set('recipe', { ...recipe, layers, formats });
    await kit.save();
    console.log(`stored on kit ${String(kit._id)} (previous recipe: /tmp/dynatos-recipe-before-tighten.json)`);
  } else {
    console.log('nothing written — re-run with --write to store it');
  }
  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
