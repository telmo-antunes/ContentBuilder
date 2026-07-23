import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Router } from 'express';
import { Types } from 'mongoose';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import {
  MAX_DRAFT_PARAGRAPH_CHARS,
  defaultThemeForCategory,
  brandRecipeSchema,
  type BackgroundRole,
  type Format,
  type Slide,
} from '@contentbuilder/shared';
import { composeProject } from '../lib/htmlDirector/compose';
import { ProjectModel, ProjectVersionModel, BusinessModel, BrandKitModel, MediaAssetModel } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { createProjectSchema, slideSchema, updateProjectSchema, type SlideInput } from '../lib/validation';
import { renderSlidesToPng, slugify } from '../lib/exporter';
import { draftSlidesFromParagraph } from '../lib/draft';
import { brandPackContext } from '../lib/templates';
import { refineSlide, isRefineIntent } from '../lib/refine';
import { generateSlideAlternatives } from '../lib/alternatives';
import { resolveDraftImages } from '../lib/stock';
import { generateCaption, type GeneratedCaption } from '../lib/caption';
import { critiqueProject } from '../lib/critique';
import { aiDraftConfigured, aiFreeConfigured, config } from '../config';

const draftSchema = z.object({
  paragraph: z.string().trim().min(1, 'Paragraph is required').max(MAX_DRAFT_PARAGRAPH_CHARS),
  mode: z.enum(['designer', 'free']).default('designer'),
});

const composeSchema = z.object({
  idea: z.string().trim().min(1, 'An idea is required').max(MAX_DRAFT_PARAGRAPH_CHARS),
  slideCount: z.number().int().min(1).max(12).optional(),
});

export const projectsRouter = Router();

/** Normalize incoming slides: ensure each has an id, and reindex `order`. */
export function normalizeSlides(slides: SlideInput[]) {
  return slides.map((s, i) => ({
    id: s.id ?? randomUUID(),
    order: i,
    layoutType: s.layoutType,
    blocks: s.blocks ?? [],
    imageNeed: s.imageNeed ?? 'none',
    mediaAssetId:
      s.mediaAssetId && Types.ObjectId.isValid(s.mediaAssetId) ? s.mediaAssetId : undefined,
    imageQuery: s.imageQuery,
    overrides: s.overrides,
  }));
}

async function approvedKitFor(businessId: string) {
  return BrandKitModel.findOne({ businessId, status: 'approved' }).sort({ createdAt: -1 }).lean();
}

/**
 * Strip media references that don't belong to this business. A syntactically
 * valid ObjectId isn't enough — without this check a slide can point at another
 * business's asset (ghost reference at best, data-leak-by-render at worst).
 */
async function scrubForeignMedia(
  slides: ReturnType<typeof normalizeSlides>,
  businessId: string,
): Promise<void> {
  const ids = new Set<string>();
  for (const s of slides) {
    if (s.mediaAssetId) ids.add(String(s.mediaAssetId));
    const o = s.overrides as Record<string, any> | undefined;
    if (o?.backgroundMediaAssetId && Types.ObjectId.isValid(o.backgroundMediaAssetId)) {
      ids.add(String(o.backgroundMediaAssetId));
    }
    for (const obj of o?.imageObjects ?? []) {
      if (obj?.mediaAssetId && Types.ObjectId.isValid(obj.mediaAssetId)) ids.add(String(obj.mediaAssetId));
    }
  }
  if (ids.size === 0) return;
  const owned = new Set(
    (await MediaAssetModel.find({ _id: { $in: [...ids] }, businessId }).select('_id').lean()).map((m) =>
      String(m._id),
    ),
  );
  for (const s of slides) {
    if (s.mediaAssetId && !owned.has(String(s.mediaAssetId))) s.mediaAssetId = undefined;
    const o = s.overrides as Record<string, any> | undefined;
    if (o?.backgroundMediaAssetId && !owned.has(String(o.backgroundMediaAssetId))) {
      delete o.backgroundMediaAssetId;
    }
    for (const obj of o?.imageObjects ?? []) {
      if (obj?.mediaAssetId && !owned.has(String(obj.mediaAssetId))) obj.mediaAssetId = undefined;
    }
  }
}

/**
 * Finish a freshly-drafted project (slides already set + saved): best-effort layout
 * polish then caption, in that order so the caption reflects the polished slides.
 * Never throws — a web-down / AI-off environment still yields a usable draft.
 * Shared by the draft route and the campaign concept-draft.
 */
export async function finalizeDraftedProject(project: {
  get: (k: string) => any;
  set: (k: string, v: unknown) => void;
  save: () => Promise<unknown>;
}): Promise<void> {
  try {
    await critiqueProject(project);
  } catch (err) {
    console.warn('[critique] auto-polish failed:', err instanceof Error ? err.message : err);
  }
  try {
    const caption = await buildCaption(project);
    if (caption.text || caption.hashtags.length) {
      project.set('caption', caption);
      await project.save();
    }
  } catch (err) {
    console.warn('[caption] auto-generate failed:', err instanceof Error ? err.message : err);
  }
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

    const initialSlides = body.slides ? normalizeSlides(body.slides) : [];
    await scrubForeignMedia(initialSlides, body.businessId);
    const created = await ProjectModel.create({
      businessId: body.businessId,
      title: body.title,
      type: body.type,
      format: body.format,
      status: 'draft',
      slides: initialSlides,
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
    const docs = await ProjectModel.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
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
      MediaAssetModel.find({ businessId: project.businessId }).sort({ createdAt: -1 }).limit(500).lean(),
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
    if (body.slides !== undefined) {
      const normalized = normalizeSlides(body.slides);
      await scrubForeignMedia(normalized, String(project.get('businessId')));
      project.set('slides', normalized);
    }
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
        await brandPackContext(String(project.get('businessId')), project.get('format')),
      );
    } catch (err) {
      throw new ApiError(
        502,
        `Draft failed: ${publicErrMessage(err, 'AI error')}. You can build manually instead.`,
      );
    }
    if (slides.length === 0) {
      throw new ApiError(502, 'The draft came back empty — try rephrasing, or build manually.');
    }

    // Art direction pass: place stock photos on the slides the AI marked for
    // imagery (best-effort — no key / no hit just leaves the placeholder).
    try {
      await resolveDraftImages(String(project.get('businessId')), slides, project.get('format'));
    } catch (err) {
      console.error('[draft] stock image resolution failed:', err);
    }

    // A draft replaces everything — keep what was there recoverable.
    if (project.get('slides')?.length) await saveVersion(project, 'Before AI draft').catch(() => {});
    project.set('slides', normalizeSlides(slides));
    await project.save(); // persist so the critique's /render pass can see the slides
    // Best-effort: polish the layout, then caption from the polished slides.
    await finalizeDraftedProject(project);
    res.json(project.toJSON());
  }),
);

// AI compose: turn an idea into on-brand AUTHORED slides using the brand's
// recipe (its design system). Requires the brand to have a recipe. Replaces the
// project's slides; the previous state is kept recoverable via a version.
projectsRouter.post(
  '/:id/compose',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const { idea, slideCount } = parseBody(composeSchema, req.body);
    if (!aiDraftConfigured()) {
      throw new ApiError(400, 'AI is not configured (set ANTHROPIC_API_KEY + ANTHROPIC_MODEL_SMALL).');
    }
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');

    const kit = await approvedKitFor(String(project.get('businessId')));
    const parsedRecipe = kit && (kit as { recipe?: unknown }).recipe
      ? brandRecipeSchema.safeParse((kit as { recipe?: unknown }).recipe)
      : null;
    if (!parsedRecipe?.success) {
      throw new ApiError(400, 'This brand has no design recipe yet — generate the brand recipe first.');
    }

    let composed;
    try {
      composed = await composeProject(parsedRecipe.data, idea, {
        format: project.get('format'),
        slideCount,
      });
    } catch (err) {
      throw new ApiError(502, `Compose failed: ${publicErrMessage(err, 'AI error')}. You can build manually instead.`);
    }
    if (!composed.length) {
      throw new ApiError(502, 'The compose came back empty — try rephrasing the idea.');
    }

    if (project.get('slides')?.length) await saveVersion(project, 'Before AI compose').catch(() => {});
    project.set(
      'slides',
      composed.map((s, i) => ({
        id: randomUUID(),
        order: i,
        layoutType: 'TextOnly',
        blocks: [],
        imageNeed: 'none',
        authored: s.authored,
      })),
    );
    project.set('status', 'draft');
    await project.save();
    res.json(project.toJSON());
  }),
);

// Propose 3 layout alternatives for ONE slide (same copy, new structure).
// Returns candidates only — nothing is saved until the user applies one.
projectsRouter.post(
  '/:id/slides/:slideId/alternatives',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const project = await ProjectModel.findById(id).lean();
    if (!project) throw new ApiError(404, 'Project not found');
    const slides = (project as Record<string, any>).slides as Array<Record<string, any>>;
    const slide = slides.find((s) => s.id === req.params.slideId);
    if (!slide) throw new ApiError(404, 'Slide not found');
    const parsed = slideSchema.safeParse(slide);
    if (!parsed.success) throw new ApiError(422, 'Slide is not in a valid state.');
    let alternatives: SlideInput[];
    try {
      alternatives = await generateSlideAlternatives(
        parsed.data,
        (project as Record<string, any>).type,
        (project as Record<string, any>).format,
        (await brandPackContext(String((project as Record<string, any>).businessId), (project as Record<string, any>).format))?.pack,
      );
    } catch (err) {
      throw new ApiError(502, `Alternatives failed: ${publicErrMessage(err, 'AI error')}.`);
    }
    if (!alternatives.length) throw new ApiError(502, 'No usable alternatives came back — try again.');
    res.json({ alternatives });
  }),
);

// Design-first refinement: apply a high-level INTENT to one slide as a bounded,
// deterministic transform (no AI). Powers the review flow's intent chips.
const refineSchema = z.object({ intent: z.string() });
projectsRouter.post(
  '/:id/slides/:slideId/refine',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const { intent } = parseBody(refineSchema, req.body);
    if (!isRefineIntent(intent)) throw new ApiError(400, 'Unknown refine intent.');
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    // Mongoose subdocuments must be converted to plain objects — spreading a
    // subdocument (as refineSlide does) would drop its data fields.
    const slides = (project.get('slides') as Array<{ toObject?: () => SlideInput }>).map((s) =>
      typeof s.toObject === 'function' ? s.toObject() : (s as SlideInput),
    );
    const idx = slides.findIndex((s) => s.id === req.params.slideId);
    if (idx < 0) throw new ApiError(404, 'Slide not found');
    const format = project.get('format') as Format;

    // Build the role -> background-asset map from the brand's own layout library
    // so "bolder/calmer background" can step through the authored backgrounds.
    const ctx = await brandPackContext(String(project.get('businessId')), format);
    const backgroundsByRole: Partial<Record<BackgroundRole, string>> = {};
    for (const l of ctx?.layouts ?? []) {
      if (l.backgroundRole && l.backgroundMediaAssetId) backgroundsByRole[l.backgroundRole] = l.backgroundMediaAssetId;
    }

    const result = refineSlide(slides[idx] as Slide, intent, format, { backgroundsByRole });
    if (result.changed) {
      slides[idx] = result.slide as SlideInput;
      project.set('slides', normalizeSlides(slides));
      await project.save();
    }
    res.json({ project: project.toJSON(), changed: result.changed, note: result.note });
  }),
);

// ── Version history (G9) ────────────────────────────────────────────────────

const MAX_VERSIONS = 20;

/** Snapshot the project's current slides; keep at most MAX_VERSIONS per project. */
async function saveVersion(project: { get(k: string): any }, label: string): Promise<void> {
  const projectId = project.get('_id');
  await ProjectVersionModel.create({ projectId, label, slides: project.get('slides') ?? [] });
  const excess = await ProjectVersionModel.find({ projectId })
    .sort({ createdAt: -1 })
    .skip(MAX_VERSIONS)
    .select('_id')
    .lean();
  if (excess.length) {
    await ProjectVersionModel.deleteMany({ _id: { $in: excess.map((v) => v._id) } });
  }
}

projectsRouter.get(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const versions = await ProjectVersionModel.find({ projectId: id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      versions: versions.map((v) => ({
        _id: String(v._id),
        label: v.label,
        createdAt: v.createdAt,
        slideCount: (v.slides ?? []).length,
      })),
    });
  }),
);

// Manual snapshot ("Save version").
projectsRouter.post(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const body = parseBody(z.object({ label: z.string().trim().max(80).optional() }), req.body ?? {});
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    await saveVersion(project, body.label || 'Manual save');
    res.status(201).json({ ok: true });
  }),
);

// Restore a snapshot. The current state is snapshotted first, so a restore is
// itself always reversible.
projectsRouter.post(
  '/:id/versions/:versionId/restore',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const versionId = requireObjectId(req.params.versionId, 'Version');
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    const version = await ProjectVersionModel.findOne({ _id: versionId, projectId: id }).lean();
    if (!version) throw new ApiError(404, 'Version not found');
    await saveVersion(project, 'Before restore');
    const restored = ((version as Record<string, any>).slides ?? [])
      .map((s: unknown) => slideSchema.safeParse(s))
      .filter((r: { success: boolean }) => r.success)
      .map((r: { data: SlideInput }) => r.data);
    project.set('slides', normalizeSlides(restored));
    await project.save();
    res.json(project.toJSON());
  }),
);

// Share hand-off: the LAN address a phone on the same network can open.
projectsRouter.get(
  '/:id/share-info',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const project = await ProjectModel.findById(id).lean();
    if (!project) throw new ApiError(404, 'Project not found');
    const nets = networkInterfaces();
    let lan = '';
    for (const list of Object.values(nets)) {
      for (const n of list ?? []) {
        if (n.family === 'IPv4' && !n.internal) {
          lan = n.address;
          break;
        }
      }
      if (lan) break;
    }
    const port = new URL(config.webUrl).port || '3000';
    res.json({
      url: lan ? `http://${lan}:${port}/share/${id}` : `${config.webUrl}/share/${id}`,
      onLan: Boolean(lan),
      hasRenders: ((project as Record<string, unknown>).renders as string[] | undefined)?.length ?? 0,
    });
  }),
);

// Self-critique the rendered slides and auto-apply bounded fixes ("Polish layout").
projectsRouter.post(
  '/:id/critique',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    if (!project.get('slides')?.length) throw new ApiError(400, 'Project has no slides to polish.');
    await saveVersion(project, 'Before polish').catch(() => {});
    let report;
    try {
      report = await critiqueProject(project);
    } catch (err) {
      throw new ApiError(
        502,
        `Polish failed: ${publicErrMessage(err, 'render error')}. Is the web server running?`,
      );
    }
    res.json({ project: project.toJSON(), report });
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
      throw new ApiError(502, `Caption failed: ${publicErrMessage(err, 'AI error')}.`);
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
    // surfaces as a clean JSON error rather than a half-written zip.
    let rendered;
    try {
      rendered = await renderSlidesToPng(project.toJSON() as never);
    } catch (err) {
      throw new ApiError(
        502,
        `Export render failed: ${publicErrMessage(err, 'render error')}. Is the web server running?`,
      );
    }

    project.set('status', 'rendered');
    project.set('renders', rendered.map((r) => r.url));
    await project.save();
    // What was shipped should always be recoverable.
    await saveVersion(project, 'Exported').catch(() => {});

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
