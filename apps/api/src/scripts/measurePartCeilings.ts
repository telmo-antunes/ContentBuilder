/**
 * Where does each PART stop fitting, per format?
 *
 * `body` was measured for the story canvas and corrected to post parity. The
 * other parts still take the story's blanket 0.8 cut, which was reasoning
 * ("Instagram overlays its UI, so shrink everything ~20%") rather than a
 * measurement — and that reasoning was already shown wrong for the body once the
 * UI reserve moved into the padding where it belongs. So measure the rest.
 *
 * One part is varied at a time, on a slide carrying the full furniture, across
 * every stored recipe. Everything else is held at its current budget, so what
 * this reports is that part's own ceiling and not an interaction.
 *
 *   npx tsx src/scripts/measurePartCeilings.ts
 *
 * Needs the web server up: the probe renders through `${WEB_URL}/render`.
 */
import { connectDb, disconnectDb } from '../db';
import { closeBrowser } from '../lib/browser';
import { openRenderProbe } from '../lib/htmlDirector/renderCheck';
import { composeBudgetsFor } from '../lib/htmlDirector/compose';
import type { BrandRecipe } from '@contentbuilder/shared';

const FORMATS = ['1080x1350', '1080x1920'] as const;
/** Multiples of the current budget: does it fit at 1x, 1.5x, 2x…? */
const FACTORS = [1, 1.25, 1.5, 2, 2.5, 3];

const WORDS = (
  'a booking that never reaches the calendar is one you have already lost and the shop only finds ' +
  'out when the bay sits empty on a friday afternoon with a deposit nobody was ever asked to leave ' +
  'behind before the day arrived and the slot quietly went to nothing at all in the end'
).split(' ');

/** About N characters of real words — no mid-word cuts. */
function words(n: number): string {
  let s = '';
  for (const w of WORDS) {
    if (`${s} ${w}`.trim().length > n) break;
    s = `${s} ${w}`.trim();
  }
  return s || WORDS[0]!;
}

type Part = 'eyebrow' | 'headline' | 'cta' | 'rowText';

function slide(recipe: BrandRecipe, part: Part, len: number, budgets: ReturnType<typeof composeBudgetsFor>): string {
  const has = (c: string) => recipe.components.some((k) => k.className.split(/\s+/)[0] === c);
  const el = (cls: string, text: string, tag = 'p') =>
    has(cls) ? `<${tag} class="${cls}">${text}</${tag}>` : '';
  const at = (p: Part, base: number) => (part === p ? len : base);
  const rows = has('panel') && has('row')
    ? `<div class="panel">${[0, 1, 2]
        .map((i) => `<div class="row">${words(at('rowText', budgets.rowText))}${i === 0 ? '' : ''}</div>`)
        .join('')}</div>`
    : '';
  return [
    el('eyebrow', words(at('eyebrow', budgets.eyebrow))),
    el('headline', words(at('headline', budgets.headline)), 'h1'),
    has('rule') ? '<div class="rule"></div>' : '',
    part === 'rowText' ? rows : el('body', words(budgets.body)),
    has('fill') ? '<div class="fill"></div>' : '',
    el('cta', words(at('cta', budgets.cta)), 'a'),
    el('handle', '@yourbrand'),
  ]
    .filter(Boolean)
    .join('');
}

(async () => {
  await connectDb();
  const { BrandKitModel, BusinessModel } = await import('../models');
  const scaffolds = new Set(
    (await BusinessModel.find({ name: /^__/ }).select('_id').lean()).map((b) => String(b._id)),
  );
  const recipes = (await BrandKitModel.find({ recipe: { $exists: true } }).sort({ _id: -1 }).limit(24).lean())
    .filter((k) => !scaffolds.has(String(k.businessId)))
    .map((k) => k.recipe as BrandRecipe | undefined)
    .filter((r): r is BrandRecipe => Boolean(r?.components?.length))
    .slice(0, 6);

  if (!recipes.length) {
    console.log('no recipes');
    await disconnectDb();
    return;
  }

  for (const format of FORMATS) {
    const budgets = composeBudgetsFor(format);
    console.log(`\n══ ${format} ═══════════════════════════════════════`);
    for (const part of ['eyebrow', 'headline', 'cta', 'rowText'] as Part[]) {
      const base = budgets[part];
      const lengths = FACTORS.map((f) => Math.round(base * f));
      const cells: string[] = [];
      for (const len of lengths) {
        const variants = recipes.map((r) => ({ recipe: r, html: slide(r, part, len, budgets) }));
        let worst = 'fits';
        for (const v of variants) {
          const probe = await openRenderProbe(v.recipe, format, [{ html: v.html, role: 'statement' }]);
          try {
            const verdict = (await probe.measure([{ index: 0, html: v.html }]))[0];
            if (!verdict || verdict.state === 'unknown') continue;
            if (verdict.state === 'overflows') { worst = 'overflows'; break; }
            if (verdict.collide) worst = 'collides';
          } finally {
            await probe.close();
          }
        }
        cells.push(`${len}${worst === 'fits' ? '·' : worst === 'collides' ? 'c' : 'X'}`);
      }
      console.log(`  ${part.padEnd(9)} budget ${String(base).padStart(3)}  →  ${cells.join('  ')}`);
    }
  }
  console.log('\n  · fits   c collides   X overflows   (worst of every recipe at that length)');
  /**
 * The probe's browser is process-wide and memoised, so closing the probe's PAGES
 * is not enough to let node exit: the launch keeps the event loop alive and the
 * script simply never returns. Fifteen of these were still resident across old
 * sessions — the oldest for a day and six hours, each holding a Chrome — which
 * is why `pgrep` for this script matches runs that finished long ago.
 */
  await closeBrowser().catch(() => {});
  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await closeBrowser().catch(() => {});
  await disconnectDb().catch(() => {});
  process.exit(1);
});
