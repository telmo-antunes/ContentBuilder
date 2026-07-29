import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  BUNDLED_FONT_FAMILIES,
  DEFAULT_RENDER_HEADING,
  DEFAULT_RENDER_BODY,
  applyKitToRecipe,
  applyRecipeKnobs,
  migrateRecipe,
  VOICE_MAX,
  type RecipeCandidate,
} from '@contentbuilder/shared';
import { BusinessModel, BrandKitModel } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { extractBrand } from '../lib/analyze';
import { assignRolesAndVibe, brandColorQuality } from '../lib/vision';
import { assertPublicHttpUrl } from '../lib/urlGuard';
import { googleFontAvailable, resolveRenderFonts } from '../lib/fonts';
import { authorRecipe, type RecipeEvidence } from '../lib/htmlDirector/authorRecipe';
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
    })
    .optional(),
});

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
    res.json({ draft: norm(draft), approved: norm(approved) });
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
        if (body.recipe) recipe = applyRecipeKnobs(recipe, body.recipe);
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
