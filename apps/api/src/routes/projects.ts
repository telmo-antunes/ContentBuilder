import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import { MAX_DRAFT_PARAGRAPH_CHARS, defaultThemeForCategory } from '@contentbuilder/shared';
import { ProjectModel, BusinessModel, BrandKitModel, MediaAssetModel } from '../models';
import { ApiError, asyncHandler, parseBody, requireObjectId } from '../lib/http';
import { createProjectSchema, updateProjectSchema, type SlideInput } from '../lib/validation';
import { renderSlidesToPng, slugify } from '../lib/exporter';
import { draftSlidesFromParagraph } from '../lib/draft';
import { generateCaption, type GeneratedCaption } from '../lib/caption';
import { aiDraftConfigured, aiFreeConfigured } from '../config';

const draftSchema = z.object({
  paragraph: z.string().trim().min(1, 'Paragraph is required').max(MAX_DRAFT_PARAGRAPH_CHARS),
  mode: z.enum(['designer', 'free']).default('designer'),
});

export const projectsRouter = Router();

/** Normalize incoming slides: ensure each has an id, and reindex `order`. */
function normalizeSlides(slides: SlideInput[]) {
  return slides.map((s, i) => ({
    id: s.id ?? randomUUID(),
    order: i,
    layoutType: s.layoutType,
    blocks: s.blocks ?? [],
    imageNeed: s.imageNeed ?? 'none',
    mediaAssetId:
      s.mediaAssetId && Types.ObjectId.isValid(s.mediaAssetId) ? s.mediaAssetId : undefined,
    overrides: s.overrides,
  }));
}

async function approvedKitFor(businessId: string) {
  return BrandKitModel.findOne({ businessId, status: 'approved' }).sort({ createdAt: -1 }).lean();
}

/** Write a caption for a project's current slides, grounded in the brand voice + profile. */
async function buildCaption(project: {
  get: (k: string) => unknown;
}): Promise<GeneratedCaption> {
  const businessId = String(project.get('businessId'));
  const [business, kit] = await Promise.all([
    BusinessModel.findById(businessId).lean(),
    approvedKitFor(businessId),
  ]);
  const b = business as { profile?: Record<string, unknown> } | null;
  const k = kit as { voice?: string; styleDescriptor?: string } | null;
  return generateCaption({
    title: project.get('title') as string,
    slides: project.get('slides') as never,
    voice: k?.voice,
    styleDescriptor: k?.styleDescriptor,
    profile: b?.profile as never,
  });
}

// Create a project — only on a business that has an APPROVED brand kit.
projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(createProjectSchema, req.body);
    requireObjectId(body.businessId, 'Business');
    const business = await BusinessModel.findById(body.businessId).lean();
    if (!business) throw new ApiError(404, 'Business not found');
    const kit = await approvedKitFor(body.businessId);
    if (!kit) throw new ApiError(400, 'This business has no approved brand kit yet. Approve a kit first.');

    const created = await ProjectModel.create({
      businessId: body.businessId,
      title: body.title,
      type: body.type,
      format: body.format,
      status: 'draft',
      slides: body.slides ? normalizeSlides(body.slides) : [],
      settings: {
        // Default the theme from the business profile (profile → visual default).
        theme: body.settings?.theme ?? defaultThemeForCategory((business as any).profile?.category),
        slideCounter: body.settings?.slideCounter ?? false,
      },
    });
    res.status(201).json(created.toJSON());
  }),
);

// List projects (optionally filtered by business).
projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined;
    const filter = businessId && Types.ObjectId.isValid(businessId) ? { businessId } : {};
    const docs = await ProjectModel.find(filter).sort({ updatedAt: -1 }).lean();
    res.json(docs);
  }),
);

// Get a project plus the brand kit + business media needed to render/edit it.
projectsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const project = (await ProjectModel.findById(id).lean()) as Record<string, any> | null;
    if (!project) throw new ApiError(404, 'Project not found');
    const [brandKit, media] = await Promise.all([
      approvedKitFor(String(project.businessId)),
      MediaAssetModel.find({ businessId: project.businessId }).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ ...project, _id: String(project._id), brandKit, media });
  }),
);

// Update title / status / slides (slides fully replaced + normalized).
projectsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const body = parseBody(updateProjectSchema, req.body);
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');

    if (body.title !== undefined) project.set('title', body.title);
    if (body.status !== undefined) project.set('status', body.status);
    if (body.slides !== undefined) project.set('slides', normalizeSlides(body.slides));
    if (body.caption !== undefined) project.set('caption', body.caption);
    if (body.settings !== undefined) {
      project.set('settings', { ...(project.get('settings') ?? {}), ...body.settings });
    }
    await project.save();
    res.json(project.toJSON());
  }),
);

projectsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const deleted = await ProjectModel.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'Project not found');
    res.json({ ok: true });
  }),
);

// Optional AI draft: arrange the user's paragraph into slides (paragraph +
// type/format only — never the brand kit). One-time, opt-in, behind the
// AI-configured check; fails soft so the user can always build manually.
projectsRouter.post(
  '/:id/draft',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const { paragraph, mode } = parseBody(draftSchema, req.body);
    if (mode === 'free' ? !aiFreeConfigured() : !aiDraftConfigured()) {
      throw new ApiError(400, 'AI draft is not configured (set ANTHROPIC_API_KEY + ANTHROPIC_MODEL_SMALL).');
    }
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    const business = await BusinessModel.findById(project.get('businessId')).lean();
    if (!(business as { profile?: { category?: string } } | null)?.profile?.category) {
      throw new ApiError(400, 'Complete the business profile before using the AI draft.');
    }

    let slides: SlideInput[];
    try {
      slides = await draftSlidesFromParagraph(
        paragraph,
        project.get('type'),
        project.get('format'),
        mode,
      );
    } catch (err) {
      throw new ApiError(
        502,
        `Draft failed: ${err instanceof Error ? err.message : 'AI error'}. You can build manually instead.`,
      );
    }
    if (slides.length === 0) {
      throw new ApiError(502, 'The draft came back empty — try rephrasing, or build manually.');
    }

    project.set('slides', normalizeSlides(slides));
    // Best-effort: draft a caption in the brand voice so the post arrives ready to
    // publish. Never fail the draft over it (AI-off / vision-down still succeeds).
    try {
      const caption = await buildCaption(project);
      if (caption.text || caption.hashtags.length) project.set('caption', caption);
    } catch (err) {
      console.warn('[caption] auto-generate failed:', err instanceof Error ? err.message : err);
    }
    await project.save();
    res.json(project.toJSON());
  }),
);

// Regenerate the caption for a project's current slides (manual "Regenerate" button).
projectsRouter.post(
  '/:id/caption',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    if (!aiDraftConfigured()) {
      throw new ApiError(400, 'Captions need ANTHROPIC_API_KEY + ANTHROPIC_MODEL_SMALL.');
    }
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    if (!project.get('slides')?.length) throw new ApiError(400, 'Add slides before generating a caption.');
    let caption: GeneratedCaption;
    try {
      caption = await buildCaption(project);
    } catch (err) {
      throw new ApiError(502, `Caption failed: ${err instanceof Error ? err.message : 'AI error'}.`);
    }
    project.set('caption', caption);
    await project.save();
    res.json(project.toJSON());
  }),
);

// Render every slide to PNG (via the hidden /render route + Puppeteer), persist
// them through the StorageProvider, then stream a zip (01.png, 02.png, …).
projectsRouter.post(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    if (!project.get('slides')?.length) throw new ApiError(400, 'Project has no slides to export');

    // Render everything BEFORE we start streaming, so a render error still
    // surfaces as a clean JSON 500 rather than a half-written zip.
    const rendered = await renderSlidesToPng(project.toJSON() as never);

    project.set('status', 'rendered');
    await project.save();

    const filename = `${slugify(project.get('title'))}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[export] archive error:', err);
      res.destroy(err);
    });
    archive.pipe(res);
    for (const slide of rendered) archive.append(slide.buffer, { name: slide.name });
    await archive.finalize();
  }),
);
