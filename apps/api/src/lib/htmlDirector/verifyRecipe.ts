/**
 * RENDER-VERIFIED AUTHORING — the loop the recipe path never had.
 *
 * `authorRecipe` could only critique its own JSON: it never saw a slide. So a
 * stylesheet that reads beautifully as text could still render with a headline
 * running off the canvas, an accent that disappears on its ground, or type that
 * collapses at thumbnail size — and nothing caught it.
 *
 * Here the recipe is actually LOOKED AT. Sample slides are composed
 * deterministically from the recipe's own component vocabulary (no model, no
 * cost), rendered through the real /render route in a throwaway project — the
 * exact pipeline that produces exports, so fonts, tokens, per-format tuning and
 * the overflow guard all behave as in production — screenshotted, and shown to a
 * vision model that revises the stylesheet.
 *
 * Best-effort throughout: any failure returns the recipe untouched. Nothing here
 * may block a brand from getting a kit.
 */
import sharp from 'sharp';
import { dimensionsFor, migrateRecipe, type BrandRecipe, type Format } from '@contentbuilder/shared';
import { getBrowser } from '../browser';
import { aiMessage, modelFor, textOf } from '../ai';
import { recordUsage } from '../usage';
import { sanitizeRecipeCss } from '../cssSanitize';
import { createRenderScaffold } from './renderCheck';

/** Sample copy per component class — plausible, and long enough to stress fit. */
const SAMPLE: Record<string, string> = {
  eyebrow: 'The long game',
  headline: 'Small habits, unshakable results',
  tagline: 'One year. One decision, repeated.',
  body: 'The work compounds quietly, long before anyone notices it.',
  quote: 'You do not rise to your goals — you fall to your systems.',
  attr: '— A lesson learned twice',
  stat: '40%',
  cta: 'Start today',
  handle: '@yourbrand',
  wordmark: 'Brand',
};

/**
 * Build sample slide markup from the recipe's OWN class vocabulary. Deterministic
 * — this is a fixture, not a generation step, so verification costs one vision
 * call rather than a compose pass.
 */
function sampleSlides(recipe: BrandRecipe): string[] {
  const has = (c: string) => recipe.components.some((k) => k.className.split(/\s+/)[0] === c);
  const el = (cls: string, tag = 'p') =>
    has(cls) ? `<${tag} class="${cls}">${SAMPLE[cls] ?? 'Sample'}</${tag}>` : '';

  // A statement slide (the workhorse) and a stat slide (the tightest fit).
  const statement = [
    has('logo') ? '<div class="logo"></div>' : '',
    has('fill') ? '<div class="fill"></div>' : '',
    el('eyebrow'),
    el('headline', 'h1'),
    has('rule') ? '<div class="rule"></div>' : '',
    el('tagline'),
    el('body'),
  ]
    .filter(Boolean)
    .join('');

  const stat = [
    el('eyebrow'),
    el('headline', 'h1'),
    has('stat') ? `<div class="stat">${SAMPLE.stat}</div>` : '',
    el('body'),
    has('fill') ? '<div class="fill"></div>' : '',
    el('cta', 'a'),
    el('handle'),
  ]
    .filter(Boolean)
    .join('');

  return [statement, stat].filter((h) => h.length > 0);
}

const VERIFY_SYSTEM = `You are a design director looking at RENDERED Instagram slides built from a brand recipe's stylesheet. You are judging the pixels, not the code.

Look for what only rendering reveals:
- Text running off the canvas, colliding, or clipped.
- Type too small to read at feed-thumbnail size, or so large it crowds out breathing room.
- An accent or body colour that disappears into the background.
- A background that is flat/muddy, or whose decoration fights the text.
- Composition sitting awkwardly — no clear anchor, cramped edges, dead centre mass.

Reply with STRICT JSON only:
{"verdict":"good"|"revise","notes":"one sentence","stylesheet":"<the full corrected CSS, only when revising>"}

If the slides look reference-grade, reply {"verdict":"good","notes":"…"} and omit the stylesheet. Otherwise return the COMPLETE corrected stylesheet — same classes, same tokens, same brand; fix only what the render exposes. Never introduce new class names, @import, <script>, or external URLs.`;

interface Shot {
  base64: string;
  overflow: boolean;
}

/** Render the sample slides through the real pipeline and screenshot each. */
async function shootSamples(recipe: BrandRecipe, format: Format): Promise<Shot[]> {
  const slides = sampleSlides(recipe);
  if (!slides.length) return [];
  const { width, height } = dimensionsFor(format);

  // A throwaway business + approved kit + project is the honest way to drive the
  // PRODUCTION render route: it resolves the kit exactly as a real export does,
  // so fonts, tokens, per-format tuning and the overflow guard all behave the
  // same. Fully isolated (nothing live is touched) and torn down in `finally`.
  // The rig itself lives in renderCheck.ts — the compose-time overflow check
  // stands up exactly the same one, so there is one implementation, not two.
  const scaffold = await createRenderScaffold(
    recipe,
    format,
    slides.map((html, i) => ({ html, role: i === 0 ? 'statement' : 'stat' })),
    'recipe-verify',
  );

  const browser = await getBrowser();
  const page = await browser.newPage();
  const shots: Shot[] = [];
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    for (let i = 0; i < scaffold.slideIds.length; i += 1) {
      await page.goto(scaffold.urlFor(i), { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('[data-slide-root]', { timeout: 25000 });
      await page.evaluate(async () => {
        const doc = (globalThis as { document?: any }).document;
        if (doc?.fonts?.ready) await doc.fonts.ready;
      });
      await new Promise((r) => setTimeout(r, 450));
      const overflow = await page
        .evaluate(() => (globalThis as any).document?.body?.dataset?.overflow === 'true')
        .catch(() => false);
      const el = await page.$('[data-slide-root]');
      if (!el) continue;
      const png = Buffer.from(await el.screenshot({ type: 'png' }));
      // Downscale for the vision call — full 1080px frames are wasteful.
      const small = await sharp(png).resize(640, 640, { fit: 'inside' }).png().toBuffer();
      shots.push({ base64: small.toString('base64'), overflow });
    }
  } finally {
    await page.close().catch(() => {});
    await scaffold.dispose();
  }
  return shots;
}

/**
 * Look at the recipe's own output and revise its stylesheet if the render says
 * so. Returns the (possibly improved) recipe plus what happened, and never
 * throws — a verification failure must not cost a brand its kit.
 */
export async function verifyRecipeByRender(
  recipe: BrandRecipe,
  opts?: { format?: Format; model?: string },
): Promise<{ recipe: BrandRecipe; verdict: 'good' | 'revised' | 'skipped'; notes: string }> {
  const format = opts?.format ?? '1080x1350';
  try {
    const t0 = Date.now();
    const shots = await shootSamples(recipe, format);
    console.warn(`[recipe] verify: rendered ${shots.length} sample(s) in ${Date.now() - t0}ms`);
    if (!shots.length) return { recipe, verdict: 'skipped', notes: 'no sample slides could be rendered' };

    const overflowed = shots.some((s) => s.overflow);
    const model = opts?.model ?? (await modelFor('vision'));
    const resp = await aiMessage({
      model,
      max_tokens: 7000,
      system: VERIFY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...shots.map(
              (s) =>
                ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: 'image/png' as const, data: s.base64 },
                }),
            ),
            {
              type: 'text' as const,
              text: [
                `These are rendered ${format} slides from this recipe.`,
                overflowed
                  ? `MEASURED: at least one slide OVERFLOWS its canvas — the type scale or spacing must come down.`
                  : `MEASURED: no slide overflows its canvas.`,
                ``,
                `CURRENT STYLESHEET:`,
                recipe.stylesheet,
              ].join('\n'),
            },
          ],
        },
      ],
    });
    await recordUsage({
      feature: 'recipe:verify',
      model,
      inputTokens: resp.usage?.input_tokens,
      outputTokens: resp.usage?.output_tokens,
    }).catch(() => {});

    console.warn(`[recipe] verify: vision verdict in ${Date.now() - t0}ms total`);
    const text = textOf(resp);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return { recipe, verdict: 'skipped', notes: 'no JSON verdict' };
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      verdict?: string;
      notes?: string;
      stylesheet?: string;
    };
    const notes = String(parsed.notes ?? '').slice(0, 200);

    if (parsed.verdict !== 'revise' || typeof parsed.stylesheet !== 'string' || !parsed.stylesheet.trim()) {
      return { recipe, verdict: 'good', notes: notes || 'render looks good' };
    }
    // Re-validate the revision exactly like an authored recipe: sanitise the CSS
    // and run it back through the schema/migrator.
    //
    // `layers` is dropped deliberately. This step returns ONE corrected sheet, so
    // the recipe's three-layer split no longer describes its CSS — and the
    // renderer prefers layers over `stylesheet`, so keeping a stale split would
    // make the fix invisible on the very slides it was measured from. Guessing a
    // new split would be worse: it silently moves rules on the next refine.
    const revised = migrateRecipe({
      ...recipe,
      layers: undefined,
      stylesheet: sanitizeRecipeCss(parsed.stylesheet),
    });
    return { recipe: revised, verdict: 'revised', notes: notes || 'stylesheet revised from the render' };
  } catch (err) {
    return {
      recipe,
      verdict: 'skipped',
      notes: `verification unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
