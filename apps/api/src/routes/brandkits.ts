import { Router } from 'express';
import { z } from 'zod';
import {
  BUNDLED_FONT_FAMILIES,
  DEFAULT_RENDER_HEADING,
  DEFAULT_RENDER_BODY,
} from '@contentbuilder/shared';
import sharp from 'sharp';
import { BusinessModel, BrandKitModel } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { extractBrand } from '../lib/analyze';
import { assignRolesAndVibe, brandColorQuality } from '../lib/vision';
import { assertPublicHttpUrl } from '../lib/urlGuard';
import { googleFontAvailable, resolveRenderFonts } from '../lib/fonts';
import { type TemplateBrandFacts } from '../lib/templates';
import { generateBrandPackage, type DirectorInputs } from '../lib/director';
import { authorRecipe, type RecipeEvidence } from '../lib/htmlDirector/authorRecipe';
import { getStorage } from '../storage';
import { harvestSiteImages } from '../lib/harvest';

/** Brand facts the composition designer needs, from a kit doc + business profile. */
function templateFacts(kit: { get(k: string): any }, profile: Record<string, any>): TemplateBrandFacts {
  return {
    styleDescriptor: kit.get('styleDescriptor') || undefined,
    voice: kit.get('voice') || undefined,
    category: profile.category,
    tone: profile.tone,
    hasLogo: Boolean(kit.get('logo')?.url),
    headingFont: kit.get('fonts')?.render?.heading,
  };
}

/**
 * Assemble the Brand Design Director's inputs from a kit doc — including the
 * homepage screenshot (downscaled for vision), the strongest brand-fit signal,
 * which the old composition pass never received.
 */
async function buildDirectorInputs(
  kit: { get(k: string): any },
  profile: Record<string, any>,
  businessName?: string,
): Promise<DirectorInputs> {
  let screenshotBase64: string | undefined;
  const shot = kit.get('homepageScreenshot');
  if (shot?.key) {
    try {
      const buf = await getStorage().read(shot.key);
      const small = await sharp(buf).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      screenshotBase64 = small.toString('base64');
    } catch (err) {
      console.warn('[director] homepage screenshot read failed (text-only brief):', err instanceof Error ? err.message : err);
    }
  }
  return {
    ...templateFacts(kit, profile),
    businessId: String(kit.get('businessId')),
    businessName,
    colors: kit.get('colors'),
    screenshotBase64,
    renderKit: {
      colors: kit.get('colors'),
      fonts: kit.get('fonts'),
      logo: kit.get('logo'),
      logoTreatment: kit.get('logoTreatment'),
    },
  };
}

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

// (Re)design the brand's complete package — layouts + matched backgrounds.
brandKitRouter.post(
  '/:kitId/package',
  asyncHandler(async (req, res) => {
    const kitId = requireObjectId(req.params.kitId, 'Brand kit');
    const kit = await BrandKitModel.findById(kitId);
    if (!kit) throw new ApiError(404, 'Brand kit not found');
    const biz = await BusinessModel.findById(kit.get('businessId')).lean();
    const profile = (biz as Record<string, any> | null)?.profile ?? {};
    const inputs = await buildDirectorInputs(kit, profile, (biz as Record<string, any> | null)?.name);
    const { artDirection, library } = await generateBrandPackage(inputs);
    kit.set('artDirection', artDirection);
    kit.set('layoutLibrary', library);
    await kit.save();
    res.json(kit.toJSON());
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
    let recipe;
    try {
      recipe = await authorRecipe(evidence);
    } catch (err) {
      throw new ApiError(502, `Recipe author failed: ${publicErrMessage(err, 'AI error')}.`);
    }
    kit.set('recipe', recipe);
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

    await kit.save();

    // On approval, (re)generate the brand backgrounds so the business has 3
    // ready-to-use post/story backgrounds, and design the brand's signature
    // composition pack. Both best-effort — never block approval.
    if (body.status === 'approved') {
      const biz = await BusinessModel.findById(kit.get('businessId')).lean();
      const profile = (biz as Record<string, any> | null)?.profile ?? {};
      // ONE package: layouts (posts + stories) and their backgrounds are
      // designed together so they read as a single system. Best-effort — never
      // block approval. (The standalone backgrounds regenerate endpoint still
      // exists for topping up extras.)
      if (!kit.get('layoutLibrary')?.post?.length) {
        try {
          const inputs = await buildDirectorInputs(kit, profile, (biz as Record<string, any> | null)?.name);
          const { artDirection, library } = await generateBrandPackage(inputs);
          kit.set('artDirection', artDirection);
          kit.set('layoutLibrary', library);
          await kit.save();
        } catch (err) {
          console.error('[package] generation on approval failed:', err);
        }
      }
    }

    res.json(kit.toJSON());
  }),
);
