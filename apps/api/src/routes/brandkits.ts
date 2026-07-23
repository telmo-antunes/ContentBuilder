import { Router } from 'express';
import { z } from 'zod';
import {
  BUNDLED_FONT_FAMILIES,
  DEFAULT_RENDER_HEADING,
  DEFAULT_RENDER_BODY,
} from '@contentbuilder/shared';
import { BusinessModel, BrandKitModel } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { extractBrand } from '../lib/analyze';
import { assignRolesAndVibe, brandColorQuality } from '../lib/vision';
import { assertPublicHttpUrl } from '../lib/urlGuard';
import { googleFontAvailable, resolveRenderFonts } from '../lib/fonts';
import { authorRecipe, type RecipeEvidence } from '../lib/htmlDirector/authorRecipe';
import { getStorage } from '../storage';
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
  voice: z.string().max(400).optional(),
  status: z.enum(['draft', 'approved']).optional(),
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
async function authorRecipeForKit(kit: {
  get(key: string): any;
  set(key: string, value: unknown): void;
  save(): Promise<unknown>;
}): Promise<void> {
  const biz = await BusinessModel.findById(kit.get('businessId')).lean<Record<string, any> | null>();
  const profile = biz?.profile ?? {};
  const evidence: RecipeEvidence = {
    name: biz?.name ?? 'Brand',
    category: profile.category,
    colors: kit.get('colors'),
    fonts: kit.get('fonts'),
    logoTreatment: kit.get('logoTreatment'),
    styleDescriptor: kit.get('styleDescriptor'),
    voice: kit.get('voice') || (Array.isArray(profile.tone) ? profile.tone.join(', ') : undefined),
  };
  const recipe = await authorRecipe(evidence);
  kit.set('recipe', recipe);
  await kit.save();
}

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
      await authorRecipeForKit(kit);
    } catch (err) {
      throw new ApiError(502, `Recipe author failed: ${publicErrMessage(err, 'AI error')}.`);
    }
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
