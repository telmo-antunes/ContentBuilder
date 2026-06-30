import { Router } from 'express';
import { z } from 'zod';
import {
  BUNDLED_FONT_FAMILIES,
  DEFAULT_RENDER_HEADING,
  DEFAULT_RENDER_BODY,
} from '@contentbuilder/shared';
import { BusinessModel, BrandKitModel } from '../models';
import { ApiError, asyncHandler, parseBody, requireObjectId } from '../lib/http';
import { extractBrand } from '../lib/analyze';
import { generateBusinessBackgrounds } from '../lib/backgrounds';
import { assignRolesAndVibe } from '../lib/vision';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb color');
const bundledFont = z
  .string()
  .refine((f) => BUNDLED_FONT_FAMILIES.includes(f), 'Render font must be a bundled font');

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
  fonts: z.object({ render: z.object({ heading: bundledFont, body: bundledFont }) }).optional(),
  logo: z.object({ sourceUrl: z.string().optional(), key: z.string(), url: z.string() }).optional(),
  logoTreatment: z.enum(['original', 'mono']).optional(),
  styleDescriptor: z.string().max(200).optional(),
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

    let extraction;
    try {
      extraction = await extractBrand(url, id);
    } catch (err) {
      throw new ApiError(
        502,
        `Could not analyze ${url}: ${err instanceof Error ? err.message : 'load failed'}. You can enter the kit manually instead.`,
      );
    }
    const roles = await assignRolesAndVibe(extraction.palette, extraction.downscaledBase64);

    // One pending draft at a time; keep approved kits as history.
    await BrandKitModel.deleteMany({ businessId: id, status: 'draft' });
    const kit = await BrandKitModel.create({
      businessId: id,
      colors: roles.colors,
      fonts: { detected: extraction.detectedFonts, render: extraction.renderFonts },
      logo: extraction.logo,
      styleDescriptor: roles.styleDescriptor,
      homepageScreenshot: extraction.screenshot,
      provenance: {
        colors: 'sampled',
        fonts: 'computed+mapped',
        roles: roles.provenance,
        logo: extraction.logo ? 'dom' : 'none',
      },
      status: 'draft',
    });
    res.status(201).json(kit.toJSON());
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
      kit.set('fonts.render.heading', body.fonts.render.heading);
      kit.set('fonts.render.body', body.fonts.render.body);
    }
    if (body.logo) kit.set('logo', body.logo);
    if (body.logoTreatment !== undefined) kit.set('logoTreatment', body.logoTreatment);
    if (body.styleDescriptor !== undefined) kit.set('styleDescriptor', body.styleDescriptor);
    if (body.status) kit.set('status', body.status);

    await kit.save();

    // On approval, (re)generate the brand backgrounds so the business has 3
    // ready-to-use post/story backgrounds. Best-effort — never block approval.
    if (body.status === 'approved') {
      try {
        await generateBusinessBackgrounds(String(kit.get('businessId')), kit.get('colors'));
      } catch (err) {
        console.error('[backgrounds] generation on approval failed:', err);
      }
    }

    res.json(kit.toJSON());
  }),
);
