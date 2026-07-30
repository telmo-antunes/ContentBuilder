import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  BUNDLED_FONT_FAMILIES,
  DEFAULT_RENDER_HEADING,
  DEFAULT_RENDER_BODY,
  applyKitToRecipe,
  applyRecipeKnobs,
  ensureRecipeContrast,
  migrateRecipe,
  VOICE_MAX,
  type BrandRecipe,
  type RecipeCandidate,
  type TweakSignals,
  type TweakSuggestion,
} from '@contentbuilder/shared';
import { BusinessModel, BrandKitModel } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { extractBrand } from '../lib/analyze';
import { assignRolesAndVibe, brandColorQuality } from '../lib/vision';
import { assertPublicHttpUrl } from '../lib/urlGuard';
import { googleFontAvailable, resolveRenderFonts } from '../lib/fonts';
import { authorRecipe, type RecipeEvidence } from '../lib/htmlDirector/authorRecipe';
import { RECIPE_LAYERS, REFINE_INSTRUCTION_MAX, refineRecipeLayer } from '../lib/htmlDirector/refineLayer';
import { harvestSiteImages } from '../lib/harvest';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb color');
// Any family name is accepted at the schema level; non-bundled ones are verified
// against Google Fonts in the handler (async, so it can't live in a zod refine).
const renderFont = z.string().min(1).max(80);

const patchKitSchema = z.object({
  colors: z
    .object({
      primary: hex,
      secondary: hex,
      accent: hex,
      background: hex,
      text: hex,
      palette: z.array(hex).optional(),
    })
    .optional(),
  fonts: z.object({ render: z.object({ heading: renderFont, body: renderFont }) }).optional(),
  logo: z.object({ sourceUrl: z.string().optional(), key: z.string(), url: z.string() }).optional(),
  logoTreatment: z.enum(['original', 'mono']).optional(),
  styleDescriptor: z.string().max(200).optional(),
  voice: z.string().max(VOICE_MAX).optional(),
  status: z.enum(['draft', 'approved']).optional(),
  /**
   * Direct recipe edits — instant and scoped, so a colour or tempo tweak no
   * longer needs a full (~60s) re-author that would change everything else.
   */
  recipe: z
    .object({
      accent: hex.optional(),
      displayCase: z.enum(['upper', 'title', 'sentence']).optional(),
      density: z.enum(['roomy', 'balanced', 'dense']).optional(),
      motionStyle: z.enum(['rise', 'fade', 'slide', 'punch', 'pop']).optional(),
      motionPace: z.enum(['calm', 'balanced', 'punchy']).optional(),
      /**
       * Swap the recipe's default surface with its `surfaces.inverse` (the
       * apply path for the learned "you keep inverting posts" suggestion).
       * Round-trippable: flipping twice restores the original. No-op when the
       * recipe defines no inverse surface.
       */
      flipSurfaces: z.literal(true).optional(),
    })
    .optional(),
});

// ── Learned tweak signals → one quiet suggestion ─────────────────────────────
// The slide-tweak endpoint counts every bigger/smaller/invert press on the
// approved kit; here those counters are distilled into at most ONE suggestion,
// served alongside the kit. Deriving lives server-side so the thresholds and
// the density direction have a single owner (and a single test surface).

/** Net presses (one direction minus its opposite) before we dare suggest. */
const TWEAK_SUGGEST_NET = 3;
/** "Not now" snoozes suggestions for 14 days without forgetting the counts. */
const TWEAK_DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * One step along the density scale. Density drives `--cb-step`, a rhythm
 * multiplier (roomy 1.15 → balanced 1 → dense 0.86) the recipe's type scales
 * by — so repeated "Smaller headline" means the display type keeps running too
 * BIG for this brand's copy, and the fix is one step TOWARD dense (multiplier
 * down). "Bigger headline" is the mirror image. At the end of the scale there
 * is no honest step left, so no suggestion is made.
 */
const DENSER: Record<string, 'balanced' | 'dense' | undefined> = { roomy: 'balanced', balanced: 'dense' };
const ROOMIER: Record<string, 'roomy' | 'balanced' | undefined> = { dense: 'balanced', balanced: 'roomy' };

function deriveTweakSuggestion(kit: Record<string, any> | null): TweakSuggestion | null {
  const signals = kit?.tweakSignals as TweakSignals | undefined;
  if (!kit || !signals) return null;
  if (
    signals.dismissedAt &&
    Date.now() - new Date(signals.dismissedAt).getTime() < TWEAK_DISMISS_COOLDOWN_MS
  ) {
    return null;
  }
  // Suggestions are recipe adjustments — without a (valid) recipe there is
  // nothing to adjust, and a broken stored recipe must not break the kit GET.
  if (!kit.recipe) return null;
  let recipe: BrandRecipe;
  try {
    recipe = migrateRecipe(kit.recipe);
  } catch {
    return null;
  }

  const net = (signals.smallerHeadline ?? 0) - (signals.biggerHeadline ?? 0);
  const density = recipe.typography.density;
  if (net >= TWEAK_SUGGEST_NET && DENSER[density]) {
    return { kind: 'density', from: density, to: DENSER[density]!, reason: 'smaller-headline', count: net };
  }
  if (-net >= TWEAK_SUGGEST_NET && ROOMIER[density]) {
    return { kind: 'density', from: density, to: ROOMIER[density]!, reason: 'bigger-headline', count: -net };
  }
  // Only offer the surface flip when the recipe actually HAS an inverse
  // surface to make default — otherwise there is nothing to apply.
  if ((signals.invert ?? 0) >= TWEAK_SUGGEST_NET && recipe.surfaces?.inverse) {
    return { kind: 'invert', count: signals.invert ?? 0 };
  }
  return null;
}

/**
 * Swap the recipe's default surface with `surfaces.inverse`. The old ground
 * becomes the new inverse, so per-slide "Invert" keeps working and a second
 * flip restores the original. Contrast is re-gated, as with any colour change.
 */
function flipRecipeSurfaces(recipe: BrandRecipe): BrandRecipe {
  const inv = recipe.surfaces?.inverse;
  if (!inv) return recipe;
  const t = recipe.tokens;
  const flipped: BrandRecipe = {
    ...recipe,
    tokens: {
      ...t,
      ground: inv.ground,
      ink: inv.ink,
      ...(inv.accent ? { accent: inv.accent } : {}),
      ...(inv.inkMuted ? { inkMuted: inv.inkMuted } : {}),
    },
    surfaces: {
      ...recipe.surfaces,
      inverse: {
        ground: t.ground,
        ink: t.ink,
        ...(inv.accent && t.accent ? { accent: t.accent } : {}),
        ...(inv.inkMuted && t.inkMuted ? { inkMuted: t.inkMuted } : {}),
      },
    },
  };
  return ensureRecipeContrast(flipped).recipe;
}

/** Business-scoped: mounted at /businesses/:id */
export const businessBrandKitRouter = Router({ mergeParams: true });

function businessId(req: { params: Record<string, string | undefined> }): string {
  return requireObjectId(req.params.id, 'Business');
}

// Run the hybrid extraction → create a DRAFT kit (the one AI touchpoint).
businessBrandKitRouter.post(
  '/analyze',
  asyncHandler(async (req, res) => {
    const id = businessId(req);
    const business = await BusinessModel.findById(id);
    if (!business) throw new ApiError(404, 'Business not found');
    if (!business.get('profile')?.category) {
      throw new ApiError(400, 'Complete the business profile before using AI extraction.');
    }
    const url = business.get('websiteUrl') as string | undefined;
    if (!url) {
      throw new ApiError(400, 'This business has no website URL — use “Enter manually” instead.');
    }
    // The server is about to drive a browser at this URL — refuse private targets.
    await assertPublicHttpUrl(url, 'Website URL');

    // Capture + assess up to twice: a degraded first frame (grey/monochrome, or a
    // half-loaded hero) is retried rather than silently shipped as a kit. Keep the
    // best-scoring attempt. Second load is often clean thanks to browser caching.
    type Attempt = { extraction: Awaited<ReturnType<typeof extractBrand>>; roles: Awaited<ReturnType<typeof assignRolesAndVibe>>; score: number };
    let best: Attempt | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let extraction;
      try {
        extraction = await extractBrand(url, id);
      } catch (err) {
        lastErr = err;
        continue;
      }
      const roles = await assignRolesAndVibe(
        extraction.palette,
        extraction.downscaledBase64,
        extraction.domRoles,
        extraction.copy,
      );
      const q = brandColorQuality(roles.colors);
      if (!best || q.score > best.score) best = { extraction, roles, score: q.score };
      if (q.ok) break; // good enough — stop
      console.warn(`[analyze] low-quality capture for ${url} (attempt ${attempt}), retrying`);
    }
    if (!best) {
      throw new ApiError(
        502,
        `Could not analyze ${url}: ${publicErrMessage(lastErr, 'load failed')}. You can enter the kit manually instead.`,
      );
    }
    const { extraction, roles } = best;
    const lowQuality = !brandColorQuality(roles.colors).ok;

    // Prefer the site's REAL fonts when they're on Google Fonts — the brand keeps
    // its actual typography instead of a bundled lookalike. Falls back to the
    // personality/name-mapped bundled faces when not available (or offline).
    const resolvedFonts = await resolveRenderFonts(
      extraction.detectedFonts,
      roles.fonts ?? extraction.renderFonts,
    );

    // One pending draft at a time; keep approved kits as history.
    await BrandKitModel.deleteMany({ businessId: id, status: 'draft' });
    const kit = await BrandKitModel.create({
      businessId: id,
      colors: roles.colors,
      // Site's real font (Google Fonts) > personality-mapped bundled > name-matched.
      fonts: { detected: extraction.detectedFonts, render: resolvedFonts.render },
      logo: extraction.logo,
      styleDescriptor: roles.styleDescriptor,
      voice: roles.voice ?? '',
      homepageScreenshot: extraction.screenshot,
      provenance: {
        colors: extraction.colorProvenance,
        fonts: resolvedFonts.usesSiteFont
          ? 'site:google-fonts'
          : roles.fonts
            ? `personality:${roles.typePersonality}`
            : 'computed+mapped',
        roles: roles.provenance,
        logo: extraction.logo ? 'dom' : 'none',
      },
      status: 'draft',
    });
    // Pull the site's real photos into the media library (best-effort).
    let harvested = 0;
    try {
      harvested = await harvestSiteImages(id, extraction.siteImages);
    } catch (err) {
      console.error('[harvest] site image harvest failed:', err);
    }

    // Flag a still-degraded capture so the editor can nudge "re-analyze or adjust"
    // instead of the user silently approving a weak (e.g. monochrome) kit.
    res.status(201).json({ ...kit.toJSON(), lowQuality, harvested });
  }),
);

// Create a blank/default DRAFT for manual entry (weak/no-website businesses).
businessBrandKitRouter.post(
  '/brandkit',
  asyncHandler(async (req, res) => {
    const id = businessId(req);
    const business = await BusinessModel.findById(id);
    if (!business) throw new ApiError(404, 'Business not found');

    await BrandKitModel.deleteMany({ businessId: id, status: 'draft' });
    const kit = await BrandKitModel.create({
      businessId: id,
      colors: {
        primary: '#2563EB',
        secondary: '#1E293B',
        accent: '#F59E0B',
        background: '#0B0F1A',
        text: '#F8FAFC',
        palette: ['#0B0F1A', '#1E293B', '#2563EB', '#F59E0B', '#F8FAFC'],
      },
      fonts: {
        detected: { heading: '', body: '' },
        render: { heading: DEFAULT_RENDER_HEADING, body: DEFAULT_RENDER_BODY },
      },
      styleDescriptor: '',
      provenance: { colors: 'manual', fonts: 'manual', roles: 'manual', logo: 'manual' },
      status: 'draft',
    });
    res.status(201).json(kit.toJSON());
  }),
);

// Current kit state for the approval screen: the pending draft and/or latest approved.
businessBrandKitRouter.get(
  '/brandkit',
  asyncHandler(async (req, res) => {
    const id = businessId(req);
    const [draft, approved] = await Promise.all([
      BrandKitModel.findOne({ businessId: id, status: 'draft' }).sort({ createdAt: -1 }).lean(),
      BrandKitModel.findOne({ businessId: id, status: 'approved' }).sort({ createdAt: -1 }).lean(),
    ]);
    const norm = (k: Record<string, any> | null) => (k ? { ...k, _id: String(k._id) } : null);
    // The learned-preference nudge rides along with the kit: derived, never
    // stored, and always about the APPROVED kit (the one projects compose against).
    res.json({ draft: norm(draft), approved: norm(approved), suggestion: deriveTweakSuggestion(approved) });
  }),
);

/** Item-scoped: mounted at /brandkits */
/**
 * Author the brand's DESIGN RECIPE from its evidence and store it on the kit —
 * the design system every AI-composed slide is built against. This is the heart
 * of onboarding: a kit without a recipe can't compose anything on-brand.
 */
/** A loaded kit document, as far as the recipe flows need it. */
interface KitDoc {
  get(key: string): any;
  set(key: string, value: unknown): void;
  save(): Promise<unknown>;
  toJSON(): Record<string, unknown>;
}

/** Assemble the author's evidence from the kit + its business profile. */
async function kitEvidence(kit: KitDoc): Promise<RecipeEvidence> {
  const biz = await BusinessModel.findById(kit.get('businessId')).lean<Record<string, any> | null>();
  const profile = biz?.profile ?? {};
  return {
    name: biz?.name ?? 'Brand',
    category: profile.category,
    colors: kit.get('colors'),
    fonts: kit.get('fonts'),
    logoTreatment: kit.get('logoTreatment'),
    styleDescriptor: kit.get('styleDescriptor'),
    voice: kit.get('voice') || (Array.isArray(profile.tone) ? profile.tone.join(', ') : undefined),
    // The homepage capture, so the author can SEE the site it is designing for.
    // Optional everywhere downstream — an absent one changes nothing.
    screenshot: kit.get('homepageScreenshot'),
  };
}

async function authorRecipeForKit(kit: KitDoc, opts?: { verify?: boolean }): Promise<void> {
  const evidence = await kitEvidence(kit);
  const recipe = await authorRecipe(evidence, { verify: opts?.verify });
  kit.set('recipe', recipe);
  await kit.save();
}

/**
 * The creative directions that make candidates meaningfully DIFFERENT design
 * systems rather than the same one re-rolled. Order matters: a 2-candidate run
 * gets faithful + bolder; a 3-candidate run adds the quiet editorial take.
 * `note` is the one-line label stored with (and shown against) each candidate.
 */
const CANDIDATE_DIRECTIONS: ReadonlyArray<{ note: string; nudge: string }> = [
  {
    note: 'Faithful — the straightforward expression of the brand',
    nudge:
      'The straightforward, faithful expression of this brand — the design system its own senior designer would reach for first. No stunts: the evidence, executed at reference grade.',
  },
  {
    note: 'Bolder — the signature move pushed louder and more graphic',
    nudge:
      'Push the signature move BOLDER and more graphic: display type at the top of the scale, a more dramatic layered background, the accent spent with more conviction. Confident and head-turning, still disciplined.',
  },
  {
    note: 'Quieter — editorial restraint, space and type do the work',
    nudge:
      'A quieter, more editorial take: generous negative space, restrained ornament, a calmer background, typography carrying the identity. Refined and understated rather than loud.',
  },
];

/** Sensible cap: each candidate is a full (draft + critique) author run. */
const MAX_CANDIDATES = CANDIDATE_DIRECTIONS.length;

export const brandKitRouter = Router();

brandKitRouter.get(
  '/:kitId',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const kit = await BrandKitModel.findById(kitId).lean();
    if (!kit) throw new ApiError(404, 'Brand kit not found');
    res.json({ ...kit, _id: String((kit as Record<string, any>)._id) });
  }),
);

// Author (or re-author) the brand's DESIGN RECIPE from its evidence — the
// design system every AI-composed slide is built against. Runs on the design
// tier; stored on the kit as `recipe`.
brandKitRouter.post(
  '/:kitId/recipe',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const kit = await BrandKitModel.findById(kitId);
    if (!kit) throw new ApiError(404, 'Brand kit not found');
    try {
      // ?verify=1 adds the render-verify pass: the recipe's own output is
      // rendered, screenshotted and revised if the pixels disagree with it.
      await authorRecipeForKit(kit, { verify: req.query.verify === '1' });
    } catch (err) {
      throw new ApiError(502, `Recipe author failed: ${publicErrMessage(err, 'AI error')}.`);
    }
    res.json(kit.toJSON());
  }),
);

const candidatesSchema = z.object({
  count: z.coerce.number().int().min(2).max(MAX_CANDIDATES).default(2),
});

/**
 * One candidates run per kit at a time. Authoring 2–3 recipes concurrently is
 * the most expensive request in the app, and a double-click (or an impatient
 * re-fire) would silently double the AI spend. A module-level Set is enough for
 * this single-process API; entries are always released in `finally`.
 */
const candidatesInFlight = new Set<string>();

// Author 2–3 CANDIDATE design systems concurrently — each with its own creative
// direction — so the user picks a recipe visually instead of taking one blind.
// Candidates skip the render-verify pass (too slow to run 2–3×); the critique
// pass runs per candidate as in the normal pipeline. Partial success is fine:
// whatever authored cleanly is stored and returned; only a total wipe-out errors.
brandKitRouter.post(
  '/:kitId/recipe/candidates',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const { count } = parseBody(candidatesSchema, {
      count: (req.body as Record<string, unknown> | undefined)?.count ?? req.query.count ?? undefined,
    });
    const kit = await BrandKitModel.findById(kitId);
    if (!kit) throw new ApiError(404, 'Brand kit not found');
    if (candidatesInFlight.has(kitId)) {
      throw new ApiError(409, 'A candidates run is already in progress for this kit — wait for it to finish.');
    }
    candidatesInFlight.add(kitId);
    try {
      const evidence = await kitEvidence(kit);
      const directions = CANDIDATE_DIRECTIONS.slice(0, count);
      const settled = await Promise.allSettled(
        directions.map((d) => authorRecipe(evidence, { direction: d.nudge })),
      );
      const candidates: RecipeCandidate[] = [];
      const failures: unknown[] = [];
      settled.forEach((result, i) => {
        const direction = directions[i]!;
        if (result.status === 'fulfilled') {
          candidates.push({
            id: randomUUID(),
            recipe: result.value,
            note: direction.note,
            createdAt: new Date().toISOString(),
          });
        } else {
          console.warn(
            `[recipe] candidate "${direction.note}" failed:`,
            result.reason instanceof Error ? result.reason.message : result.reason,
          );
          failures.push(result.reason);
        }
      });
      if (!candidates.length) {
        throw new ApiError(502, `Recipe candidates failed: ${publicErrMessage(failures[0], 'AI error')}.`);
      }
      kit.set('recipeCandidates', candidates);
      await kit.save();
      res.json({ candidates });
    } finally {
      candidatesInFlight.delete(kitId);
    }
  }),
);

const selectCandidateSchema = z.object({ candidateId: z.string().min(1) });

// Promote ONE candidate to the kit's live recipe. Mirrors the PATCH path: the
// kit's colours/fonts stay the single truth, so the promoted recipe is
// re-pointed at them (applyKitToRecipe) before it goes live. Clears the
// candidate list — the choice is made.
brandKitRouter.post(
  '/:kitId/recipe/select',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const { candidateId } = parseBody(selectCandidateSchema, req.body);
    const kit = await BrandKitModel.findById(kitId);
    if (!kit) throw new ApiError(404, 'Brand kit not found');
    const candidates = (kit.get('recipeCandidates') ?? []) as RecipeCandidate[];
    const chosen = candidates.find((c) => c.id === candidateId);
    if (!chosen) {
      throw new ApiError(404, 'Recipe candidate not found — it may have been replaced by a newer run.');
    }
    const synced = applyKitToRecipe(migrateRecipe(chosen.recipe), {
      colors: kit.get('colors'),
      fonts: kit.get('fonts'),
    });
    if (synced.changed.length) {
      console.warn(`[recipe] candidate re-pointed at kit on select: ${synced.changed.join(', ')}`);
    }
    kit.set('recipe', synced.recipe);
    kit.set('recipeCandidates', undefined);
    await kit.save();
    res.json(kit.toJSON());
  }),
);

const refineSchema = z.object({
  layer: z.enum(RECIPE_LAYERS),
  instruction: z.string().trim().min(1).max(REFINE_INSTRUCTION_MAX),
});

/**
 * Refine ONE LAYER of the kit's recipe from a one-line instruction — the
 * surgical alternative to re-authoring. "The background is too busy" used to
 * cost a full ~60s re-author that also rewrote the type, the components and the
 * signature, so nobody dared touch a recipe they liked. Here the other layers
 * come back byte-identical (see refineLayer.ts for the layered vs flat paths).
 * Design tier, so it is metered like the other expensive recipe routes.
 */
brandKitRouter.post(
  '/:kitId/recipe/refine',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const { layer, instruction } = parseBody(refineSchema, req.body);
    const kit = await BrandKitModel.findById(kitId);
    if (!kit) throw new ApiError(404, 'Brand kit not found');
    const stored = kit.get('recipe');
    if (!stored) {
      throw new ApiError(400, 'This kit has no recipe yet — design one before refining it.');
    }
    let current: BrandRecipe;
    try {
      current = migrateRecipe(stored);
    } catch (err) {
      throw new ApiError(
        400,
        `This kit's stored recipe can't be read (${publicErrMessage(err, 'invalid recipe')}) — redesign it.`,
      );
    }
    let refined: Awaited<ReturnType<typeof refineRecipeLayer>>;
    try {
      refined = await refineRecipeLayer(current, layer, instruction);
    } catch (err) {
      throw new ApiError(502, `Recipe refine failed: ${publicErrMessage(err, 'AI error')}.`);
    }
    console.warn(
      `[recipe] refined ${refined.diff.layer} (${refined.diff.mode}) — ${refined.diff.charsBefore} → ${refined.diff.charsAfter} chars`,
    );
    kit.set('recipe', refined.recipe);
    await kit.save();
    // The diff rides alongside the kit so the UI can say what actually changed
    // — and, on a flat recipe, be honest that the whole sheet was rewritten.
    res.json({ ...kit.toJSON(), refine: refined.diff });
  }),
);

// Edit fields and/or approve (status: 'approved' flips it live for projects).
brandKitRouter.patch(
  '/:kitId',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const body = parseBody(patchKitSchema, req.body);
    const kit = await BrandKitModel.findById(kitId);
    if (!kit) throw new ApiError(404, 'Brand kit not found');

    if (body.colors) {
      kit.set('colors', {
        ...body.colors,
        palette: body.colors.palette ?? [
          body.colors.background,
          body.colors.secondary,
          body.colors.primary,
          body.colors.accent,
          body.colors.text,
        ],
      });
    }
    if (body.fonts?.render) {
      // Non-bundled families must exist on Google Fonts, or the renderer could
      // never load them and every slide would silently fall back to sans-serif.
      for (const family of [body.fonts.render.heading, body.fonts.render.body]) {
        if (!BUNDLED_FONT_FAMILIES.includes(family) && !(await googleFontAvailable(family))) {
          throw new ApiError(
            400,
            `"${family}" is not a bundled font and couldn't be found on Google Fonts.`,
          );
        }
      }
      kit.set('fonts.render.heading', body.fonts.render.heading);
      kit.set('fonts.render.body', body.fonts.render.body);
    }
    if (body.logo) kit.set('logo', body.logo);
    if (body.logoTreatment !== undefined) kit.set('logoTreatment', body.logoTreatment);
    if (body.styleDescriptor !== undefined) kit.set('styleDescriptor', body.styleDescriptor);
    if (body.voice !== undefined) kit.set('voice', body.voice);
    if (body.status) kit.set('status', body.status);

    // ONE BRAND, ONE TRUTH. Authored slides render from `recipe.tokens`, so a
    // kit edit that didn't reach them was invisible on every post — the palette
    // editor looked broken because it effectively was. Re-point the recipe here,
    // then apply any direct knobs, then re-save.
    const storedRecipe = kit.get('recipe');
    if (storedRecipe) {
      try {
        let recipe = migrateRecipe(storedRecipe);
        if (body.colors || body.fonts) {
          const synced = applyKitToRecipe(recipe, {
            colors: body.colors,
            fonts: body.fonts,
          });
          recipe = synced.recipe;
          if (synced.changed.length) {
            console.warn(`[recipe] re-pointed from kit edit: ${synced.changed.join(', ')}`);
          }
        }
        if (body.recipe) {
          const { flipSurfaces, ...knobs } = body.recipe;
          if (Object.keys(knobs).length) recipe = applyRecipeKnobs(recipe, knobs);
          if (flipSurfaces) recipe = flipRecipeSurfaces(recipe);
          // A density edit (tuned by hand or applied from the suggestion)
          // answers the headline-size signals; a surface flip answers the
          // invert signal. Either way those presses are spent — reset them so
          // the next suggestion is earned by NEW corrections.
          const signals = kit.get('tweakSignals');
          if (signals && (knobs.density || flipSurfaces)) {
            const next = { ...(typeof signals.toObject === 'function' ? signals.toObject() : signals) };
            if (knobs.density) {
              next.smallerHeadline = 0;
              next.biggerHeadline = 0;
            }
            if (flipSurfaces) next.invert = 0;
            next.updatedAt = new Date();
            kit.set('tweakSignals', next);
          }
        }
        kit.set('recipe', recipe);
      } catch (err) {
        console.warn('[recipe] could not sync from kit edit:', err instanceof Error ? err.message : err);
      }
    }

    await kit.save();

    // On approval, author the brand's DESIGN RECIPE if it doesn't have one yet —
    // this is what makes the kit able to compose on-brand posts. Best-effort:
    // a failed author never blocks approval (the recipe can be (re)authored from
    // the brand-kit screen). This is the onboarding hand-off into generation.
    if (body.status === 'approved' && !kit.get('recipe')) {
      try {
        await authorRecipeForKit(kit);
      } catch (err) {
        console.error('[recipe] author on approval failed:', err);
      }
    }

    res.json(kit.toJSON());
  }),
);

// "Not now" on the learned-preference suggestion. A snooze, not amnesia: the
// counters stay, and the suggestion may return after 14 days if the same
// corrections keep coming. Dismissal is real state (it must survive a reload),
// which no existing endpoint could record — hence this one small POST.
brandKitRouter.post(
  '/:kitId/suggestion/dismiss',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const kit = await BrandKitModel.findById(kitId);
    if (!kit) throw new ApiError(404, 'Brand kit not found');
    const signals = kit.get('tweakSignals');
    kit.set('tweakSignals', {
      ...(signals && typeof signals.toObject === 'function' ? signals.toObject() : (signals ?? {})),
      dismissedAt: new Date(),
    });
    await kit.save();
    res.json(kit.toJSON());
  }),
);
