/**
 * THE RENDER LOOP, CLOSED — compose checks its own output.
 *
 * The renderer has always MEASURED overflow: `AuthoredSlide`'s guard compares
 * the composition's children against the padding box and `RenderStage` publishes
 * the verdict as `document.body.dataset.overflow`. Until now only
 * `verifyRecipe.ts` ever read it, and only for opt-in recipe verification — so
 * compose shipped slides that spill off the canvas and the Studio merely badged
 * them afterwards, leaving the user to fix by hand what the machine already knew
 * was broken.
 *
 * Here compose LOOKS at what it made:
 *
 *   compose → render the deck through the real /render route → per-slide
 *   overflow → repair the ones that spill (deterministic first, a model call
 *   only as the last resort) → re-render → ship
 *
 * Three rules govern everything below.
 *
 *   BEST-EFFORT. The API can render nothing on its own; it drives the WEB app
 *   through Puppeteer. When the web server is absent (a bare API process, CI,
 *   `npm test`, the eval harness) every slide reports "unknown", one line is
 *   logged, and compose ships exactly what it composed. A closed render loop
 *   must never be able to fail a compose.
 *
 *   DETERMINISTIC FIRST. Steps 1 and 2 of the repair ladder are free string
 *   work. Only a slide that survives both costs a model call, and then exactly
 *   one.
 *
 *   ONE SCAFFOLD, ONE PASS. A whole deck shares ONE throwaway business/kit/
 *   project and one pool of Puppeteer pages, and every slide is measured
 *   concurrently — the added cost of a clean deck is about one render, not one
 *   per slide.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Browser, Page } from 'puppeteer';
import {
  SLOT_ATTR,
  dimensionsFor,
  isFormat,
  recipePatternVariant,
  type BrandRecipe,
  type Format,
  archetypeFor,
} from '@contentbuilder/shared';
import { config } from '../../config';
import { topLevelBlocks, type SlideBlock } from './dedupeBlocks';
import { variantIndexOf, type ComposeSlideInput } from './prompt';

// ── Public shape ────────────────────────────────────────────────────────────

/**
 * What a render told us. `unknown` is NOT a synonym for "fits": it means the
 * question could not be asked (no web server, no browser, a timeout), and every
 * caller treats it as "leave this slide alone".
 */
export type OverflowState = 'fits' | 'overflows' | 'unknown';

/** One slide's verdict. `overflows` is true ONLY for a measured overflow. */
export interface SlideOverflow {
  overflows: boolean;
  state: OverflowState;
  /** The full measurement, when one was taken — collision, slack, headline lines. */
  layout?: LayoutVerdict;
}

/** The minimum of an authored slide the check needs (compose's own output shape). */
export interface CheckSlide {
  html: string;
  /** A per-slide surface class (e.g. the recipe's `inverse`) — measured as it ships. */
  bg?: string;
  role?: string;
  /** How the slide is composed. Carries the headline cap the layout ladder enforces. */
  archetype?: string;
  /**
   * What size a photograph occupies in each slot, when that is already known.
   *
   * A scaffold carries no media, so a slot is reserved at the DEFAULT geometry —
   * correct at compose time, where no photo has been chosen, and wrong when
   * re-measuring a slide whose photo was deliberately shrunk. Supplying the
   * stored shape/size makes the reserve match what actually ships.
   */
  slotSizes?: Record<string, { shape?: string; size?: string }>;
}

/**
 * A live measuring rig: a throwaway project whose slides can be rewritten and
 * re-rendered. Injected in tests so nothing here needs a browser, a database or
 * a web server.
 */
export interface RenderProbe {
  /** Write each fragment into its slide and measure it. Results are input-ordered. */
  measure(items: readonly { index: number; html: string }[]): Promise<LayoutVerdict[]>;
  close(): Promise<void>;
}

/** How a probe is obtained. Defaults to {@link openRenderProbe}. */
export type OpenProbe = (
  recipe: BrandRecipe,
  format: Format,
  slides: readonly CheckSlide[],
) => Promise<RenderProbe>;

// ── Tuning ──────────────────────────────────────────────────────────────────

/**
 * How many pages measure at once — the same shared-browser page pool
 * `exporter.ts` uses, sized a little wider because this pass only reads one DOM
 * attribute where the exporter screenshots and stores a PNG.
 *
 * Measured against the real stack (5-slide deck, warm browser, Next dev server):
 * one slide alone ≈ 0.78s, which is the floor — a render pass. Nine slides cost
 * 2.8s at a pool of 4, 2.3s at 6 and 2.2s at 8, so the web server, not the pool,
 * is the wall past ~6. Six therefore covers a typical 5-slide deck in ONE wave
 * for the price of one render, and a 9-slide deck in two.
 */
const PAGE_POOL = 6;

/** Matches `exporter.ts`/`verifyRecipe.ts` — the render route mounts client-side. */
const GOTO_TIMEOUT_MS = 45000;
const MOUNT_TIMEOUT_MS = 25000;

/**
 * BACKSTOPS, not tuning knobs. Every await inside a measurement already carries
 * its own timeout, so in a healthy run neither of these is ever reached.
 *
 * They exist because the two waits that have NO timeout of their own are the
 * ones that can hang the whole tool: `pagePool.acquire()` returns a promise
 * that only settles when some other slide releases a page, and `page.evaluate`
 * runs until the page answers. Either one stalling leaves `Promise.all` pending
 * forever — which means compose never returns, never saves a slide, and never
 * reaches the `finally` that disposes the scaffold, so it also leaks a
 * `__render-check-*` business/kit/project on the way out.
 *
 * A compose that stalled for 45 minutes and wrote nothing is how this got
 * noticed. Exceeding a ceiling degrades exactly like an unreachable renderer:
 * an `unknown` verdict, which the caller already handles.
 */
const ACQUIRE_TIMEOUT_MS = 60000;
const MEASURE_TIMEOUT_MS = GOTO_TIMEOUT_MS + MOUNT_TIMEOUT_MS + 20000;

/** Reject if `p` has not settled within `ms`. The timer never holds the loop open. */
export function withCeiling<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
/**
 * The overflow guard measures on mount, again on `fonts.ready`, on every image
 * load, and once more on a 400ms timer. We wait for the attribute to exist and
 * then let that last re-measure land.
 */
const SETTLE_MS = 450;

/** `ComposeOptions.format` is a loose string; the render rig needs a real Format. */
const asFormat = (f: string | Format | undefined): Format => (isFormat(f) ? f : '1080x1350');

/**
 * Is the render check on when nobody says otherwise?
 *
 * ON in a normal server process — the loop is only worth having if it runs by
 * default, and it degrades silently when the renderer is absent.
 *
 * OFF under a test runner. `npm test` and the eval harness must pass with no web
 * server and no network at all, and "it would have degraded to unknown anyway"
 * is not good enough: the degraded path still LAUNCHES Chrome and still talks to
 * Mongo before it discovers there is nothing to talk to. So the default is
 * explicitly off there, and the renderer-absent path is what the tests exercise
 * deliberately rather than by accident.
 *
 * `COMPOSE_RENDER_CHECK=0|false|off|no` forces it off anywhere (a bare API box
 * with no web server, a batch job); any other value forces it on.
 */
export function renderCheckEnabledByDefault(): boolean {
  const flag = process.env.COMPOSE_RENDER_CHECK;
  if (flag !== undefined && flag.trim() !== '') {
    return !/^(0|false|off|no)$/i.test(flag.trim());
  }
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false;
  return true;
}

// ── The throwaway scaffold ──────────────────────────────────────────────────

/** A disposable business + approved kit + project, wired for the /render route. */
export interface RenderScaffold {
  projectId: string;
  /** Slide ids in deck order — index i is slide i. */
  slideIds: string[];
  /** Replace one slide's markup in place (positional `$set`, so no version races). */
  setSlideHtml(index: number, html: string): Promise<void>;
  /** The `/render?projectId=…&slideId=…` URL for a slide. */
  urlFor(index: number): string;
  dispose(): Promise<void>;
}

/**
 * Stand up the isolated scaffold the render route needs.
 *
 * A throwaway business + APPROVED kit + project is the honest way to drive the
 * PRODUCTION render route: it resolves the kit exactly as a real export does, so
 * fonts, tokens, per-format tuning and the overflow guard all behave the same.
 * Nothing live is touched, and `dispose()` removes all three.
 *
 * Extracted here so the two render-driven passes — recipe verification and this
 * overflow check — build their rig the same way instead of each keeping a copy.
 */
export async function createRenderScaffold(
  recipe: BrandRecipe,
  format: Format,
  slides: ReadonlyArray<CheckSlide>,
  label = 'render-check',
): Promise<RenderScaffold> {
  // Loaded lazily: mongoose is only needed when a real render actually happens,
  // and this module is imported by the compose path on every deck.
  const { BusinessModel, BrandKitModel, ProjectModel } = await import('../../models');
  const t = recipe.tokens;
  const tag = randomUUID().slice(0, 8);
  const business = await BusinessModel.create({ name: `__${label}-${tag}` });
  const kit = await BrandKitModel.create({
    businessId: business._id,
    colors: {
      primary: t.accent,
      secondary: t.groundAlt ?? t.ground,
      accent: t.accent,
      background: t.ground,
      text: t.ink,
    },
    fonts: { render: { heading: t.displayFamily, body: t.bodyFamily } },
    status: 'approved',
    recipe,
  });
  const slideIds = slides.map(() => randomUUID());
  const project = await ProjectModel.create({
    businessId: business._id,
    title: `__${label}-${tag}`,
    type: 'carousel',
    format,
    status: 'draft',
    settings: { theme: 'editorial', slideCounter: false },
    slides: slides.map((s, i) => ({
      id: slideIds[i]!,
      order: i,
      imageNeed: 'none',
      authored: { html: s.html, ...(s.bg ? { bg: s.bg } : {}), ...(s.role ? { role: s.role } : {}) },
      /**
       * Photo records pointing at an asset that does not exist.
       *
       * `resolveSlidePhotos` keeps the GEOMETRY of a photo whose asset it cannot
       * resolve and skips the image — which is exactly what a reserve needs: the
       * space a picture will take, without a picture. The dangling id is honest
       * rather than a trick: a scaffold really does have no media, and the
       * schema requires the field, so this is the same state as an asset deleted
       * from the library while a slide still points at it.
       */
      ...(s.slotSizes && Object.keys(s.slotSizes).length
        ? {
            photos: Object.entries(s.slotSizes).map(([slot, g], j) => ({
              id: `reserve-${j}`,
              mediaAssetId: new Types.ObjectId(),
              placement: 'slot',
              slot,
              ...(g.shape ? { shape: g.shape } : {}),
              ...(g.size ? { size: g.size } : {}),
            })),
          }
        : {}),
    })),
  });
  const projectId = String(project._id);
  const base = config.webUrl.replace(/\/+$/, '');

  return {
    projectId,
    slideIds,
    urlFor: (index) =>
      // `reserveSlots=1`: a measurement has no photos attached, so without it
      // every empty slot leaves the flow and the deck is gated as if its
      // pictures did not exist — see `reservedSlotCss`.
      `${base}/render?projectId=${projectId}&slideId=${encodeURIComponent(slideIds[index] ?? '')}` +
      `&reserveSlots=1`,
    async setSlideHtml(index, html) {
      // A positional `$set` rather than `doc.save()`: repairs land one slide at a
      // time while other slides are still being measured, and rewriting the whole
      // array from a stale document would race (and trip the version key).
      await ProjectModel.updateOne({ _id: projectId }, { $set: { [`slides.${index}.authored.html`]: html } });
    },
    async dispose() {
      await Promise.all([
        ProjectModel.deleteOne({ _id: project._id }).catch(() => {}),
        BrandKitModel.deleteOne({ _id: kit._id }).catch(() => {}),
        BusinessModel.deleteOne({ _id: business._id }).catch(() => {}),
      ]);
    },
  };
}

// ── The real probe ──────────────────────────────────────────────────────────

/** A lazily-filled pool of Puppeteer pages shared by every concurrent measure. */
function pagePool(browser: Browser, limit: number, viewport: { width: number; height: number }) {
  const all: Page[] = [];
  const idle: Page[] = [];
  const waiters: Array<(p: Page) => void> = [];
  let created = 0;

  return {
    async acquire(): Promise<Page> {
      const free = idle.pop();
      if (free) return free;
      if (created < limit) {
        created += 1;
        try {
          const page = await browser.newPage();
          await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
          all.push(page);
          return page;
        } catch (err) {
          created -= 1;
          throw err;
        }
      }
      return new Promise<Page>((resolve) => waiters.push(resolve));
    },
    release(page: Page): void {
      const next = waiters.shift();
      if (next) next(page);
      else idle.push(page);
    },
    async closeAll(): Promise<void> {
      await Promise.all(all.map((p) => p.close().catch(() => {})));
    },
  };
}

/** Drive one slide's render and read the guard's verdict off the page. */
async function readOverflow(page: Page, url: string): Promise<LayoutVerdict> {
  await page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
  await page.waitForSelector('[data-slide-root]', { timeout: MOUNT_TIMEOUT_MS });
  await page.evaluate(async () => {
    const doc = (globalThis as { document?: any }).document;
    if (doc?.fonts?.ready) await doc.fonts.ready;
  });
  // Wait for the guard to publish at all before trusting a reading — an absent
  // attribute means "not measured yet", not "fits".
  await page.waitForFunction(
    () => (globalThis as any).document?.body?.dataset?.overflow !== undefined,
    { timeout: MOUNT_TIMEOUT_MS },
  );
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const read = await page.evaluate(() => {
    const ds = (globalThis as any).document?.body?.dataset ?? {};
    return { overflow: ds.overflow, collide: ds.collide, slack: ds.slack, lines: ds.headlineLines };
  });
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    state: read.overflow === 'true' ? 'overflows' : read.overflow === 'false' ? 'fits' : 'unknown',
    collide: read.collide === 'true',
    slack: num(read.slack),
    headlineLines: num(read.lines),
  };
}

/**
 * Everything one measurement pass learns about a slide.
 *
 * One object rather than three calls: the probe already renders the slide, and
 * a second pass to ask "and how many lines was the headline?" would double the
 * cost of every check for information the first pass had in hand.
 */
export interface LayoutVerdict {
  state: OverflowState;
  /** Two painted boxes closer than the minimum clearance — see AuthoredSlide. */
  collide: boolean;
  /** Largest contiguous empty band, as a fraction of frame height. */
  slack: number;
  /** Rendered line count of the slide's headline; 0 when it has none. */
  headlineLines: number;
}

/**
 * The share of a frame a single empty band may occupy before it reads as a hole
 * — per ROLE, because the roles disagree about what an empty band means.
 *
 * MEASURED across all 79 stored slides that actually shipped
 * (`src/scripts/slackDistribution.ts`). Once the spacer stopped being counted as
 * content, the spread separated cleanly by role:
 *
 *   cover      n=7   min 51.3%  median 52.7%  max 59.6%
 *   cta        n=7   min 13.8%  median 30.2%  max 50.4%
 *   feature    n=12  min  8.7%  median 39.2%  max 65.5%
 *   statement  n=15  min  9.0%  median 23.3%  max 44.9%
 *   list       n=5   min 13.3%  median 20.5%  max 35.5%
 *   stat       n=3   min 13.5%  median 36.9%  max 44.0%
 *
 * A cover is a headline over space — that IS the form, and not one cover in the
 * sample sits below 51%. A slide whose job is to carry content is a different
 * question, and the two worst `feature` slides in the sample, both at 65.5%, are
 * the ones that had to be hand-authored into panels because they said nothing.
 *
 * So DISPLAY roles are allowed to be mostly air and CONTENT roles are not. On
 * this sample the gate fires on exactly those two slides. An unknown role gets
 * the permissive limit: a gate that cries wolf is a gate that gets ignored.
 */
const SLACK_LIMIT = { display: 0.65, content: 0.5 } as const;

/** Roles that exist to carry information rather than to make an impression. */
const CONTENT_ROLES = new Set(['feature', 'statement', 'list', 'stat']);

/** The largest empty band this role may carry before it reads as a hole. */
export function maxSlackFor(role: string | undefined): number {
  return role && CONTENT_ROLES.has(role) ? SLACK_LIMIT.content : SLACK_LIMIT.display;
}

/**
 * The old single threshold, kept only so a caller with no role in hand still has
 * a number. Prefer {@link maxSlackFor}.
 */
export const MAX_SLACK = SLACK_LIMIT.display;

/** Lift a bare overflow state into a full verdict — for callers and doubles
 *  that only care about the one signal. */
export const asVerdict = (state: OverflowState): LayoutVerdict => ({
  ...UNKNOWN_VERDICT,
  state,
});

/** A verdict with nothing measured — used when the renderer is unreachable. */
export const UNKNOWN_VERDICT: LayoutVerdict = {
  state: 'unknown',
  collide: false,
  slack: 0,
  headlineLines: 0,
};

/**
 * The production probe: one scaffold + one page pool for a whole deck. Throws if
 * the rig cannot be built at all (no database, no browser) — callers treat that
 * as "the renderer is unreachable" and degrade.
 */
export const openRenderProbe: OpenProbe = async (recipe, format, slides) => {
  const { getBrowser } = await import('../browser');
  const scaffold = await createRenderScaffold(recipe, format, slides);
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    await scaffold.dispose();
    throw err;
  }
  const pool = pagePool(browser, Math.min(PAGE_POOL, Math.max(1, slides.length)), dimensionsFor(format));
  let failures = 0;

  return {
    async measure(items) {
      return Promise.all(
        items.map(async ({ index, html }) => {
          try {
            await scaffold.setSlideHtml(index, html);
          } catch {
            return UNKNOWN_VERDICT;
          }
          let page: Page;
          try {
            // Ceiling: acquire waits on another slide releasing a page, so one
            // stuck measurement would otherwise stall every slide behind it.
            page = await withCeiling(pool.acquire(), ACQUIRE_TIMEOUT_MS, 'page acquire');
          } catch {
            return UNKNOWN_VERDICT;
          }
          try {
            return await withCeiling(
              readOverflow(page, scaffold.urlFor(index)),
              MEASURE_TIMEOUT_MS,
              `slide ${index + 1} measure`,
            );
          } catch (err) {
            // One line for the whole deck, not one per slide: a dead web server
            // fails every slide identically and nine copies help nobody.
            if (failures === 0) {
              console.warn(
                `[render-check] could not measure a slide — is the web server running? ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
            failures += 1;
            return UNKNOWN_VERDICT;
          } finally {
            pool.release(page);
          }
        }),
      );
    },
    async close() {
      await pool.closeAll();
      await scaffold.dispose();
    },
  };
};

// ── 1. Measure ──────────────────────────────────────────────────────────────

export interface CheckOptions {
  /** Swap the measuring rig (tests, or a caller with its own scaffold). */
  openProbe?: OpenProbe;
}

/**
 * Measure a deck. Every slide is rendered through the real /render route inside
 * ONE throwaway project, concurrently across the page pool.
 *
 * Never throws: an unreachable renderer logs one line and reports `unknown` for
 * every slide.
 */
export async function checkSlideOverflow(
  recipe: BrandRecipe,
  slides: readonly CheckSlide[],
  format: Format | string,
  opts?: CheckOptions,
): Promise<SlideOverflow[]> {
  if (!slides.length) return [];
  const fmt = asFormat(format);
  const open = opts?.openProbe ?? openRenderProbe;
  let probe: RenderProbe;
  try {
    probe = await open(recipe, fmt, slides);
  } catch (err) {
    console.warn(
      `[render-check] renderer unavailable — shipping unchecked: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return slides.map(() => ({ overflows: false, state: 'unknown' as const, layout: UNKNOWN_VERDICT }));
  }
  try {
    const verdicts = await probe.measure(slides.map((s, index) => ({ index, html: s.html })));
    return slides.map((_, i) => {
      const v = verdicts[i] ?? UNKNOWN_VERDICT;
      return { overflows: v.state === 'overflows', state: v.state, layout: v };
    });
  } catch (err) {
    console.warn(
      `[render-check] measuring failed — shipping unchecked: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return slides.map(() => ({ overflows: false, state: 'unknown' as const, layout: UNKNOWN_VERDICT }));
  } finally {
    await probe.close().catch(() => {});
  }
}

// ── 2. The repair ladder ────────────────────────────────────────────────────

/**
 * STEP 1 — the recipe's own size control.
 *
 * `POST /projects/:id/slides/:slideId/tweak` with `smaller-headline` already
 * does exactly this: "The recipe's `.sm` headline variant IS the size control —
 * toggle it." Both reference recipes document it ("Add .sm for longer lines")
 * and every AI-authored recipe is required to define it.
 *
 * The endpoint's `class="headline(?! sm)([^"]*)"` regex is fragile — it only
 * fires when `headline` is the FIRST class and the attribute uses double
 * quotes, so `class="lead headline"` silently does nothing. Here the class
 * attribute is tokenised properly instead: any element carrying the `headline`
 * token gains the variant, whatever else it wears and however it is quoted.
 */
export function addHeadlineVariant(html: string, variant = 'sm'): { html: string; changed: boolean } {
  // Attribute values are matched whole so a `>` inside one cannot end the tag.
  const OPEN_TAG = /<([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  const CLASS_ATTR = /(\bclass\s*=\s*)(?:"([^"]*)"|'([^']*)')/i;
  let changed = false;
  const out = html.replace(OPEN_TAG, (whole, tag: string, attrs: string) => {
    const m = attrs.match(CLASS_ATTR);
    if (!m) return whole;
    const quote = m[2] !== undefined ? '"' : "'";
    const tokens = (m[2] ?? m[3] ?? '').split(/\s+/).filter(Boolean);
    if (!tokens.includes('headline') || tokens.includes(variant)) return whole;
    tokens.push(variant);
    changed = true;
    // Replaced through a function so a `$` in a class name can't be a backref.
    const next = attrs.replace(CLASS_ATTR, (_a, lead: string) => `${lead}${quote}${tokens.join(' ')}${quote}`);
    return `<${tag}${next}>`;
  });
  return { html: out, changed };
}

/**
 * The inverse of {@link addHeadlineVariant} — drop the variant class again.
 *
 * The tweak endpoint's `bigger-headline` had the mirror image of the `smaller`
 * bug: `class="headline sm([^"]*)"` requires the two classes to be adjacent, in
 * that order, double-quoted, so it could not undo a variant this function's
 * tokenised writer had appended after other classes.
 */
export function removeHeadlineVariant(html: string, variant = 'sm'): { html: string; changed: boolean } {
  const OPEN_TAG = /<([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  const CLASS_ATTR = /(\bclass\s*=\s*)(?:"([^"]*)"|'([^']*)')/i;
  let changed = false;
  const out = html.replace(OPEN_TAG, (whole, tag: string, attrs: string) => {
    const m = attrs.match(CLASS_ATTR);
    if (!m) return whole;
    const quote = m[2] !== undefined ? '"' : "'";
    const tokens = (m[2] ?? m[3] ?? '').split(/\s+/).filter(Boolean);
    if (!tokens.includes('headline') || !tokens.includes(variant)) return whole;
    const kept = tokens.filter((t) => t !== variant);
    changed = true;
    const next = attrs.replace(CLASS_ATTR, (_a, lead: string) => `${lead}${quote}${kept.join(' ')}${quote}`);
    return `<${tag}${next}>`;
  });
  return { html: out, changed };
}

/**
 * Does this recipe actually style a smaller-headline variant? Adding a class the
 * stylesheet never defines changes nothing on the canvas, and would burn a
 * render for a repair that could not possibly work.
 */
export function hasSmallerHeadlineVariant(recipe: BrandRecipe): boolean {
  if (/\.sm\b/.test(recipe.stylesheet ?? '')) return true;
  return recipe.components.some((c) => /\bsm\b/.test(`${c.className} ${c.use}`));
}

/**
 * STEP 2 — the sacrifice ladder.
 *
 * WHAT MAY NEVER GO: the headline, the eyebrow, the CTA and a photo slot. Those
 * four are the slide's identity — what it says, what labels it, what it asks
 * for, and the hole the user's picture fills. Losing any of them is worse than
 * an overflow. The brand furniture (logo/wordmark/monogram, handle) and the
 * copy-carrying singletons (quote, attr, stat) are protected for the same
 * reason; `.fill` is a zero-height flex spacer, so dropping it would not buy a
 * single pixel.
 *
 * WHAT GOES, LEAST ESSENTIAL FIRST. The ordering is derived from the reference
 * recipes' component vocabulary (`recipes.ts`) and from the composer's own
 * instruction for the analogous squeeze — a photo slot — which reads: "DROP the
 * pattern's optional furniture — panels, rules, secondary blocks — to pay for
 * it" (`prompt.ts`). So:
 *
 *   1. `.rule`    — "a short gold underline", "a thin gold hairline". Pure
 *                   decoration; it carries no copy in either recipe, so
 *                   dropping it costs the slide nothing but a separator.
 *   2. `.body`    — but only while the slide still says something beyond its
 *                   headline (a `.panel`/rows, a `.quote`, a `.stat`, a
 *                   `.tagline`). This is `dedupeBlocks`' Guard A preference
 *                   taken one step further: a panel of rows is the richer
 *                   expression, and a headline + a list + a paragraph is three
 *                   voices on one poster. A `.body` that is the slide's only
 *                   prose is NOT furniture and stays.
 *   3. `.panel`   — the enumeration card: the heaviest block on the canvas, but
 *                   real copy, so it is sacrificed only after the prose.
 *   4. `.tagline` — Dynatós calls it THE SIGNATURE. It is voice rather than
 *                   information, one short line, and cheap to lose, but it is
 *                   also the brand's fingerprint — so it goes last.
 *
 * Above all of that sits the pattern test: a block the slide's own composition
 * pattern does NOT name is furniture the pattern never asked for, and is
 * sacrificed before anything the pattern did ask for. That is the literal
 * reading of "optional furniture the pattern didn't require".
 */
const NEVER_DROP = new Set([
  'headline', 'eyebrow', 'cta', 'cb-shot',
  'logo', 'logo-row', 'wordmark', 'monogram', 'handle',
  'quote', 'attr', 'stat',
  'fill',
]);

/** Least essential first — see the note above for why this order. */
const SACRIFICE_ORDER = ['rule', 'body', 'panel', 'tagline'];

/** Classes that mean "this slide still says something without its paragraph". */
const SUBSTANCE = new Set(['panel', 'row', 'quote', 'stat', 'tagline']);

/**
 * Does this block hold an enumeration — a `.row` per item, wherever the brand's
 * list container puts them? Checked on the block's whole markup, not its own
 * classes, because the rows are children of the `.panel` that carries them.
 */
function carriesRows(block: SlideBlock): boolean {
  return /\bclass\s*=\s*(?:"[^"]*\brow\b[^"]*"|'[^']*\brow\b[^']*')/i.test(block.html);
}

export interface DropResult {
  html: string;
  /** The dropped block's label (e.g. `div.rule`), or undefined when nothing could go. */
  dropped?: string;
}

/** The classes this slide's composition pattern actually names. */
function patternClasses(recipe: BrandRecipe, input: ComposeSlideInput): Set<string> {
  const pattern = recipePatternVariant(recipe, input.format, input.role, variantIndexOf(input));
  const out = new Set<string>();
  if (!pattern) return out;
  for (const token of pattern.slice(pattern.indexOf(':') + 1).split('→')) {
    const name = token.trim().toLowerCase().match(/^[a-z][\w-]*/)?.[0];
    if (name) out.add(name);
  }
  return out;
}

/** Drop the single least essential optional block, or nothing at all. */
export function dropLeastEssential(
  html: string,
  recipe: BrandRecipe,
  input: ComposeSlideInput,
): DropResult {
  const blocks = topLevelBlocks(html);
  const named = patternClasses(recipe, input);
  const hasSubstance = blocks.some((b) => b.classes.some((c) => SUBSTANCE.has(c)));
  const speaking = blocks.filter((b) => b.text.length > 0).length;
  /**
   * THE ENUMERATION IS NEVER FURNITURE.
   *
   * A `.panel` is the heaviest block on the canvas, so the ladder reached for
   * it — and a real deck shipped "Five habits that shorten the life" with the
   * five habits gone, a promise over blank canvas. An eyebrow and a headline
   * are what a slide is LABELLED with; the rows are what it is FOR. When they
   * are the only enumeration on the slide, cutting them does not repair the
   * overflow, it destroys the slide, and the ladder's next rung — re-composing
   * with the copy declared fixed — is the honest answer instead.
   */
  const enumerations = blocks.filter(carriesRows);

  let best: { block: SlideBlock; rank: number } | undefined;
  for (const block of blocks) {
    if (block.html.includes(SLOT_ATTR)) continue; // never the picture's hole
    if (block.classes.some((c) => NEVER_DROP.has(c))) continue;
    const cls = SACRIFICE_ORDER.find((c) => block.classes.includes(c));
    if (!cls) continue;
    if (cls === 'body' && !hasSubstance) continue; // the slide's only prose is not furniture
    if (block.text.length > 0 && speaking <= 1) continue; // never the last words on the slide
    // …and never the slide's only enumeration.
    if (enumerations.length <= 1 && carriesRows(block)) continue;
    // Not named by the pattern → sacrificed first; then by the ladder above.
    const rank = (named.has(cls) ? 10 : 0) + SACRIFICE_ORDER.indexOf(cls);
    if (!best || rank < best.rank) best = { block, rank };
  }
  if (!best) return { html };
  const out = `${html.slice(0, best.block.start)}${html.slice(best.block.end)}`
    .replace(/\n{2,}/g, '\n')
    .trim();
  return { html: out, dropped: best.block.label };
}

/**
 * STEP 3 — the only step that costs anything. The slide is re-composed with the
 * failure named, the copy declared fixed, and the remedy spelled out in the
 * composer's own vocabulary.
 */
export const OVERFLOW_NOTE = [
  'OVERFLOW: the previous composition overflowed the canvas — use fewer elements; the copy is fixed.',
  "Drop the pattern's optional furniture (a rule, a panel, a secondary paragraph) and keep only the elements the copy parts require.",
  'Do not shorten, reword, omit or add any copy — every part must still appear verbatim.',
].join(' ');

export type RepairStep = 'smaller-headline' | 'dropped' | 'recomposed';

export interface RepairResult {
  html: string;
  /** Which rungs of the ladder were actually climbed, in order. */
  steps: RepairStep[];
  /** The block step 2 removed, for the log. */
  dropped?: string;
  /** True when every step ran and the slide STILL overflows — the caller warns. */
  stillOverflows: boolean;
  /** Model calls this repair cost (0 or 1). */
  aiCalls: number;
}

export interface RepairContext {
  /** Render this fragment in the slide's own position and report the verdict. */
  measure: (html: string) => Promise<OverflowState>;
  /**
   * Re-compose the slide with an extra instruction. Defaults to the real
   * `composeSlide` (imported lazily so this module never has to statically
   * depend on the module that calls it).
   */
  recompose?: (input: ComposeSlideInput, note: string) => Promise<string>;
}

async function defaultRecompose(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
  note: string,
): Promise<string> {
  const { composeSlide } = await import('./compose');
  const out = await composeSlide(recipe, input, { note, renderCheck: false });
  return out.html;
}

/** Fewest top-level blocks wins — the closest thing to "least crowded" we can see. */
function leastCrowded(attempts: readonly string[]): string {
  let best = attempts[0]!;
  let bestCount = topLevelBlocks(best).length;
  for (const html of attempts.slice(1)) {
    const count = topLevelBlocks(html).length;
    if (count <= bestCount) {
      best = html; // ties go to the LATER attempt: it climbed further
      bestCount = count;
    }
  }
  return best;
}

/**
 * Climb the ladder for ONE overflowing slide, re-rendering after each rung and
 * stopping the moment it fits.
 *
 * A rung that reports `unknown` also stops the climb: if the renderer has just
 * gone away we must not spend a model call chasing a verdict we can no longer
 * read.
 */
export async function repairOverflow(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
  html: string,
  format: Format | string,
  ctx?: RepairContext,
): Promise<RepairResult> {
  const fmt = asFormat(format ?? input.format);
  const steps: RepairStep[] = [];
  const attempts: string[] = [];
  let dropped: string | undefined;
  let aiCalls = 0;

  // No context? Stand up a private one-slide rig, so the ladder is usable on its
  // own (a script, a route) and not only from inside compose.
  let ownProbe: RenderProbe | undefined;
  let measure = ctx?.measure;
  if (!measure) {
    try {
      ownProbe = await openRenderProbe(recipe, fmt, [{ html, role: input.role }]);
      const probe = ownProbe;
      measure = async (candidate: string) =>
        ((await probe.measure([{ index: 0, html: candidate }]))[0] ?? UNKNOWN_VERDICT).state;
    } catch (err) {
      console.warn(
        `[render-check] repair skipped — renderer unavailable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { html, steps, stillOverflows: false, aiCalls: 0 };
    }
  }

  try {
    let current = html;

    // Step 1 — free: the recipe's smaller-headline variant.
    if (hasSmallerHeadlineVariant(recipe)) {
      const smaller = addHeadlineVariant(current);
      if (smaller.changed) {
        steps.push('smaller-headline');
        current = smaller.html;
        attempts.push(current);
        const state = await measure(current);
        if (state !== 'overflows') return { html: current, steps, stillOverflows: false, aiCalls };
      }
    }

    // Step 2 — free: drop the least essential optional block.
    const trimmed = dropLeastEssential(current, recipe, input);
    if (trimmed.dropped) {
      steps.push('dropped');
      dropped = trimmed.dropped;
      current = trimmed.html;
      attempts.push(current);
      const state = await measure(current);
      if (state !== 'overflows') return { html: current, steps, dropped, stillOverflows: false, aiCalls };
    }

    // Step 3 — the last resort, exactly one call.
    const recompose = ctx?.recompose ?? ((i: ComposeSlideInput, note: string) => defaultRecompose(recipe, i, note));
    let recomposed = '';
    try {
      recomposed = await recompose(input, OVERFLOW_NOTE);
      aiCalls += 1;
    } catch (err) {
      console.warn(
        `[render-check] ${input.role}: re-compose failed — keeping the deterministic repair: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (recomposed) {
      steps.push('recomposed');
      attempts.push(recomposed);
      const state = await measure(recomposed);
      if (state !== 'overflows') return { html: recomposed, steps, dropped, stillOverflows: false, aiCalls };
    }

    // Everything overflowed. Keep the best attempt and flag it for the caller.
    if (!attempts.length) return { html, steps, dropped, stillOverflows: true, aiCalls };
    return { html: leastCrowded(attempts), steps, dropped, stillOverflows: true, aiCalls };
  } finally {
    await ownProbe?.close().catch(() => {});
  }
}

// ── 3. The deck pass compose runs ───────────────────────────────────────────

export interface DeckCheckOptions extends CheckOptions {
  /** Supplied by compose so step 3 reuses its model + options. */
  recompose?: (input: ComposeSlideInput, note: string) => Promise<string>;
}

export interface DeckCheckResult {
  /** The deck, with overflowing slides repaired. Byte-identical when all fit. */
  slides: CheckSlide[];
  measured: number;
  /**
   * Slides the renderer could not measure at all.
   *
   * The number that matters most when it is non-zero: with the web server down,
   * `measure()` returns `unknown` for every slide in ~86ms, compose still
   * succeeds, and the deck it writes is indistinguishable from a gated one —
   * except that the overflow gate, the collision gate, the slack gate and the
   * whole repair ladder all quietly did nothing. Reported so the CALLER learns
   * that, rather than whoever happens to be reading the server's terminal.
   */
  unmeasured: number;
  overflowed: number;
  repaired: number;
  /** Indices that still overflow after the whole ladder — the caller may warn. */
  unresolved: number[];
  aiCalls: number;
  ms: number;
  /**
   * What each ladder did, and what it could not fix.
   *
   * Returned rather than only logged: a gate that fires and repairs nothing is
   * the single most useful thing this pass learns, and until now it existed
   * solely as a line in the server's console — where nobody composing a deck
   * would ever see it.
   */
  notes: string[];
}

/**
 * Measure a composed deck and repair what spills. One scaffold, one page pool,
 * every slide measured concurrently; repairs then run concurrently too, sharing
 * the same pool.
 *
 * Never throws.
 */
export async function renderCheckDeck(
  recipe: BrandRecipe,
  inputs: readonly ComposeSlideInput[],
  slides: readonly CheckSlide[],
  format: Format | string,
  opts?: DeckCheckOptions,
): Promise<DeckCheckResult> {
  const t0 = Date.now();
  const out = slides.map((s) => ({ ...s }));
  const nothing: DeckCheckResult = {
    slides: out,
    measured: 0,
    unmeasured: slides.length,
    overflowed: 0,
    repaired: 0,
    unresolved: [],
    aiCalls: 0,
    notes: [],
    ms: 0,
  };
  if (!slides.length) return nothing;

  const fmt = asFormat(format);
  const open = opts?.openProbe ?? openRenderProbe;
  let probe: RenderProbe;
  try {
    probe = await open(recipe, fmt, slides);
  } catch (err) {
    console.warn(
      `[render-check] renderer unavailable — deck ships unchecked: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ...nothing, ms: Date.now() - t0 };
  }

  try {
    const verdicts = await probe.measure(slides.map((s, index) => ({ index, html: s.html })));
    const measured = verdicts.filter((v) => v.state !== 'unknown').length;
    const unmeasured = slides.length - measured;
    if (unmeasured) {
      console.warn(`[render-check] ${unmeasured}/${slides.length} slide(s) could not be measured — those ship unchecked`);
    }
    const overflowing = verdicts.flatMap((v, i) => (v.state === 'overflows' ? [i] : []));

    /**
     * Which slides have a NON-overflow fault. Computed before the early return,
     * because "nothing overflowed" is not the same as "nothing is wrong" — that
     * conflation is exactly what let a collision and a 430px hole ship.
     */
    const faulty = verdicts.flatMap((v, i) =>
      v.state === 'fits' &&
      layoutFaults(v, archetypeFor(slides[i]?.archetype)?.maxHeadlineLines, slides[i]?.role).length
        ? [i]
        : [],
    );

    if (!overflowing.length && !faulty.length) {
      const ms = Date.now() - t0;
      console.warn(
        `[render-check] ${measured}/${slides.length} slide(s) measured in ${ms}ms — nothing to repair`,
      );
      return { ...nothing, measured, unmeasured, ms };
    }

    // Repairs are independent per slide, so they climb their ladders at the same
    // time; the probe's page pool is what actually caps the browser work.
    const repairs = await Promise.all(
      overflowing.map((i) =>
        repairOverflow(recipe, inputs[i] ?? fallbackInput(slides[i]!, fmt, i), slides[i]!.html, fmt, {
          measure: async (html) =>
            ((await probe.measure([{ index: i, html }]))[0] ?? UNKNOWN_VERDICT).state,
          recompose: opts?.recompose,
        }).catch((err) => {
          console.warn(
            `[render-check] slide ${i + 1}: repair failed — shipping as composed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return { html: slides[i]!.html, steps: [], stillOverflows: true, aiCalls: 0 } as RepairResult;
        }),
      ),
    );

    /**
     * The other gates, on the slides the overflow ladder did not take.
     *
     * Kept as a separate pass rather than folded in, because the two ladders
     * are not interchangeable: `repairOverflow` can spend a re-compose as its
     * last rung, and a slide that merely has a hole in it does not warrant a
     * model call. Disjoint by construction — a slide is in one set or the
     * other, never both.
     */
    const layoutRepairs = await Promise.all(
      faulty.map((i) => {
        const v = verdicts[i]!;
        const cap = archetypeFor(slides[i]?.archetype)?.maxHeadlineLines;
        return (
          repairLayout(recipe, inputs[i] ?? fallbackInput(slides[i]!, fmt, i), slides[i]!.html, v, cap, {
            measure: async (html) => (await probe.measure([{ index: i, html }]))[0] ?? UNKNOWN_VERDICT,
          })
            .then((r) => ({ index: i, ...r }))
            .catch((err) => {
              console.warn(
                `[render-check] slide ${i + 1}: layout repair failed — shipping as composed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              return { index: i, html: slides[i]!.html, steps: [], remaining: [], aiCalls: 0 };
            })
        );
      }),
    );

    const unresolved: number[] = [];
    const notes: string[] = [];
    let aiCalls = 0;
    let repaired = 0;

    for (const r of layoutRepairs) {
      out[r.index] = { ...out[r.index]!, html: r.html };
      if (r.steps.length) {
        notes.push(`slide ${r.index + 1}: ${r.steps.join(' → ')}`);
        repaired += 1;
      }
      // A fault nothing could fix is reported rather than silently shipped —
      // the gates exist to be seen, not to be quietly satisfied.
      if (r.remaining.length) notes.push(`slide ${r.index + 1}: ${r.remaining.join(', ')} (UNFIXED)`);
    }

    overflowing.forEach((slideIndex, n) => {
      const r = repairs[n]!;
      out[slideIndex] = { ...out[slideIndex]!, html: r.html };
      aiCalls += r.aiCalls;
      if (r.stillOverflows) unresolved.push(slideIndex);
      else repaired += 1;
      const how = r.steps
        .map((s) => (s === 'dropped' ? `dropped ${r.dropped ?? 'a block'}` : s))
        .join(' → ');
      notes.push(`slide ${slideIndex + 1}: ${how || 'nothing to try'}${r.stillOverflows ? ' (STILL OVERFLOWS)' : ''}`);
    });

    const ms = Date.now() - t0;
    console.warn(
      `[render-check] ${measured}/${slides.length} slide(s) measured in ${ms}ms · ` +
        `${overflowing.length} overflowed · ${repaired} repaired · ${unresolved.length} unresolved · ` +
        `${aiCalls} extra AI call(s) — ${notes.join('; ')}`,
    );
    return { slides: out, measured, unmeasured, overflowed: overflowing.length, repaired, unresolved, aiCalls, ms, notes };
  } catch (err) {
    console.warn(
      `[render-check] check failed — deck ships unchecked: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ...nothing, ms: Date.now() - t0 };
  } finally {
    await probe.close().catch(() => {});
  }
}

/** A stand-in input when a caller measured slides it has no compose inputs for. */
function fallbackInput(slide: CheckSlide, format: Format, index: number): ComposeSlideInput {
  return {
    role: (slide.role ?? 'statement') as ComposeSlideInput['role'],
    parts: {},
    format,
    index,
  };
}

// ── 3. The layout ladder ────────────────────────────────────────────────────

/**
 * Repair what the layout gates found, in the direction the fault points.
 *
 * The overflow ladder above only ever SHRINKS, because overflow only ever means
 * too much content. The gates added two faults that do not fit that shape:
 *
 *   · a COLLISION is too much content that happens not to have left the frame —
 *     a headline whose descenders rest on the CTA chip passes the overflow
 *     check, because nothing overflowed. Same direction, so it climbs the same
 *     rungs.
 *   · a HEADLINE OVER ITS CAP is emphasis that has become unedited copy. Also
 *     shrink, and the cheapest rung usually settles it.
 *   · EXCESS SLACK is the opposite: content that underfills its frame. Shrinking
 *     makes it worse, so this direction GROWS — the inverse of rung one.
 *
 * Growing is the risky direction, so it is the conservative one: exactly one
 * step, kept only if the result neither overflows nor collides. A slide that
 * cannot be grown safely keeps its slack and is reported. The alternative —
 * climbing until something breaks — trades a visible hole for an invisible
 * collision, which is a worse deck and a harder bug.
 */
export interface LayoutRepair {
  html: string;
  steps: string[];
  /** What is still wrong after the climb, for the caller to surface. */
  remaining: string[];
  aiCalls: number;
}

export interface LayoutRepairContext {
  measure: (html: string) => Promise<LayoutVerdict>;
  recompose?: (input: ComposeSlideInput, note: string) => Promise<string>;
}

/** Everything a verdict says is wrong, in the words a human would use. */
export function layoutFaults(
  v: LayoutVerdict,
  maxHeadlineLines: number | undefined,
  role?: string,
): string[] {
  const out: string[] = [];
  if (v.state === 'overflows') out.push('overflows');
  if (v.collide) out.push('collision');
  if (v.slack > maxSlackFor(role)) out.push(`slack ${Math.round(v.slack * 100)}%`);
  if (maxHeadlineLines && v.headlineLines > maxHeadlineLines) {
    out.push(`headline ${v.headlineLines} lines`);
  }
  return out;
}

const tooMuch = (f: string[]) => f.some((x) => x === 'overflows' || x === 'collision' || x.startsWith('headline'));
const tooLittle = (f: string[]) => f.some((x) => x.startsWith('slack'));

export async function repairLayout(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
  html: string,
  verdict: LayoutVerdict,
  maxHeadlineLines: number | undefined,
  ctx: LayoutRepairContext,
): Promise<LayoutRepair> {
  const steps: string[] = [];
  let current = html;
  let faults = layoutFaults(verdict, maxHeadlineLines, input.role);
  if (!faults.length || verdict.state === 'unknown') {
    return { html, steps, remaining: faults, aiCalls: 0 };
  }

  // ── Shrink ────────────────────────────────────────────────────────────────
  if (tooMuch(faults) && hasSmallerHeadlineVariant(recipe)) {
    const smaller = addHeadlineVariant(current);
    if (smaller.changed) {
      const after = await ctx.measure(smaller.html);
      const next = layoutFaults(after, maxHeadlineLines, input.role);
      // Kept only if it actually helped. A smaller headline that fixes a
      // collision but opens a hole has traded one gate failure for another.
      if (after.state !== 'unknown' && next.length < faults.length) {
        steps.push('smaller-headline');
        current = smaller.html;
        faults = next;
      }
    }
  }

  // ── Grow ──────────────────────────────────────────────────────────────────
  if (tooLittle(faults) && !tooMuch(faults)) {
    const bigger = removeHeadlineVariant(current);
    if (bigger.changed) {
      const after = await ctx.measure(bigger.html);
      const next = layoutFaults(after, maxHeadlineLines, input.role);
      if (after.state !== 'unknown' && !tooMuch(next) && after.slack < verdict.slack) {
        steps.push('larger-headline');
        current = bigger.html;
        faults = next;
      }
    }
  }

  return { html: current, steps, remaining: faults, aiCalls: 0 };
}
