/**
 * How long may a body line actually be before the design breaks — and how empty
 * does a slide read when the body is short?
 *
 * Builds slides from each brand recipe's OWN class vocabulary (the fixture
 * `verifyRecipe` uses) and renders one per body length through the production
 * probe. Only the body text varies, so what this prints is a measurement of
 * that one variable rather than a guess. Two shapes are measured because they
 * bound the real range: `lean` is eyebrow + headline + body, `full` adds the
 * tagline, CTA and handle that a real slide often also carries.
 *
 *   npx tsx src/scripts/measureBodyCeiling.ts
 *
 * Needs the web server up: the probe renders through `${WEB_URL}/render`.
 */
import { connectDb, disconnectDb } from '../db';
import { maxSlackFor, openRenderProbe } from '../lib/htmlDirector/renderCheck';
import type { BrandRecipe } from '@contentbuilder/shared';

const LENGTHS = [60, 90, 120, 150, 180, 210, 240, 280];
const FORMATS = ['1080x1350', '1080x1920'] as const;

/** Filler that wraps like real copy: whole words, real sentences, about N characters. */
function filler(n: number): string {
  const words = (
    'a booking that never reaches the calendar is one you have already lost, and the shop only ' +
    'finds out when the bay sits empty on a friday afternoon. the deposit is what turns a maybe ' +
    'into a slot somebody paid to keep, which is why the quiet weeks are the ones that hurt most ' +
    'when nobody was asked to commit to anything at all before the day arrived'
  ).split(' ');
  let s = '';
  for (const w of words) {
    if (`${s} ${w}`.trim().length > n - 1) break;
    s = `${s} ${w}`.trim();
  }
  return `${s.replace(/[,.]$/, '')}.`;
}

type Shape = 'lean' | 'full';

function slideWithBody(recipe: BrandRecipe, body: string, shape: Shape): string {
  const has = (c: string) => recipe.components.some((k) => k.className.split(/\s+/)[0] === c);
  const el = (cls: string, text: string, tag = 'p') =>
    has(cls) ? `<${tag} class="${cls}">${text}</${tag}>` : '';
  return [
    has('logo') ? '<div class="logo"></div>' : '',
    has('fill') ? '<div class="fill"></div>' : '',
    el('eyebrow', 'The long game'),
    el('headline', 'Small habits, unshakable results', 'h1'),
    has('rule') ? '<div class="rule"></div>' : '',
    shape === 'full' ? el('tagline', 'One year. One decision, repeated.') : '',
    el('body', body),
    shape === 'full' ? el('cta', 'Start today', 'a') : '',
    shape === 'full' ? el('handle', '@yourbrand') : '',
  ]
    .filter(Boolean)
    .join('');
}

(async () => {
  await connectDb();
  const { BrandKitModel } = await import('../models');

  const kits = await BrandKitModel.find({ recipe: { $exists: true } }).sort({ _id: -1 }).limit(6).lean();
  const usable = kits
    .map((k) => k.recipe as BrandRecipe | undefined)
    .filter((r): r is BrandRecipe => Boolean(r?.components?.some((c) => c.className.split(/\s+/)[0] === 'body')));

  if (!usable.length) {
    console.log('no recipe with a `body` component — nothing to measure');
    await disconnectDb();
    return;
  }

  // recipe × format × shape → the length at which it first stops fitting.
  for (const format of FORMATS) {
    for (const shape of ['lean', 'full'] as Shape[]) {
      console.log(`\n══ ${format}  ${shape} (${usable.length} recipes) ═══════════════════`);
      for (const [r, recipe] of usable.entries()) {
        const variants = LENGTHS.map((n) => ({
          html: slideWithBody(recipe, filler(n), shape),
          role: 'statement',
        }));
        const probe = await openRenderProbe(recipe, format, variants);
        try {
          const verdicts = await probe.measure(variants.map((v, i) => ({ index: i, html: v.html })));
          const cells = verdicts.map((v, i) => {
            const len = filler(LENGTHS[i]!).length;
            const mark = v.state === 'fits' ? (v.slack > MAX_SLACK ? 'H' : '·') : v.state === 'overflows' ? 'X' : '?';
            return `${len}${mark}`;
          });
          const collide = verdicts.some((v) => v.collide) ? '  (recipe collides at every length)' : '';
          console.log(`  recipe ${r + 1}: ${cells.join(' ')}${collide}`);
        } finally {
          await probe.close();
        }
      }
    }
  }
  console.log('\n  · fits   H fits but leaves a hole over 15% of the frame   X overflows   ? unmeasured');

  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
