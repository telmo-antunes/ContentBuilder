import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Router } from 'express';
import { Types } from 'mongoose';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import {
  MAX_DRAFT_PARAGRAPH_CHARS,
  authoredSlots,
  defaultThemeForCategory,
  isSlotName,
  migrateRecipe,
  slidePhotoSchema,
  type BrandRecipe,
  type SlidePhoto,
} from '@contentbuilder/shared';
import { composeProject, composeSlide } from '../lib/htmlDirector/compose';
import { partsFromAuthored } from '../lib/htmlDirector/reparse';
import { sanitizeAuthoredHtml } from '../lib/htmlSanitize';
import { ProjectModel, ProjectVersionModel, BusinessModel, BrandKitModel, MediaAssetModel } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { createProjectSchema, slideSchema, updateProjectSchema, type SlideInput } from '../lib/validation';
import { renderSlidesToPng, slugify } from '../lib/exporter';
import { renderSlidesToVideo } from '../lib/videoExporter';
import { generateCaption, type GeneratedCaption } from '../lib/caption';
import { aiDraftConfigured, config } from '../config';

const composeSchema = z.object({
  idea: z.string().trim().min(1, 'An idea is required').max(MAX_DRAFT_PARAGRAPH_CHARS),
  slideCount: z.number().int().min(1).max(12).optional(),
});

export const projectsRouter = Router();

/**
 * The user's photos for one slide, cleaned up: bad asset ids dropped, slot
 * fills without a slot name demoted to free, at most ONE background, and every
 * free overlay given a frame. A legacy slide's single `mediaAssetId` is
 * migrated in as the background, so posts made before this existed keep their
 * picture.
 */
function normalizePhotos(s: SlideInput): SlidePhoto[] {
  const raw = s.photos ?? [];
  const out: SlidePhoto[] = [];
  let hasBackground = false;
  for (const p of raw) {
    if (!p.mediaAssetId || !Types.ObjectId.isValid(p.mediaAssetId)) continue;
    let placement = p.placement;
    if (placement === 'slot' && !(p.slot && isSlotName(p.slot))) placement = 'free';
    if (placement === 'background') {
      if (hasBackground) continue; // a slide has one background, not several
      hasBackground = true;
    }
    out.push({
      id: p.id || randomUUID(),
      mediaAssetId: p.mediaAssetId,
      placement,
      ...(placement === 'slot' ? { slot: p.slot } : {}),
      ...(placement === 'free'
        ? { frame: p.frame ?? { x: 0.28, y: 0.34, w: 0.44, h: 0.32 }, z: p.z ?? 1 }
        : {}),
      fit: p.fit,
      ...(p.focal ? { focal: p.focal } : {}),
      ...(p.alt ? { alt: p.alt } : {}),
    });
    if (out.length >= 24) break;
  }
  // Back-compat: the old single attached photo becomes the background.
  if (!out.length && s.mediaAssetId && Types.ObjectId.isValid(s.mediaAssetId)) {
    out.push({
      id: randomUUID(),
      mediaAssetId: s.mediaAssetId,
      placement: 'background',
      fit: 'cover',
    });
  }
  return out;
}

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
    photos: normalizePhotos(s),
    overrides: s.overrides,
    // Preserve AI-authored markup (recipe-driven slides) through every
    // slide-persisting path, and re-sanitise it defensively — this is the one
    // place client-supplied authored HTML can reach storage → render. Dropping
    // it here previously forced /compose to bypass this normaliser and made a
    // refine on an authored slide wipe its markup.
    authored: s.authored
      ? {
          html: sanitizeAuthoredHtml(s.authored.html),
          ...(s.authored.bg ? { bg: s.authored.bg } : {}),
          ...(s.authored.role ? { role: s.authored.role } : {}),
        }
      : undefined,
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
    for (const p of s.photos ?? []) ids.add(String(p.mediaAssetId));
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
    // A photo pointing at another business's asset is dropped outright — there
    // is no meaningful "partial" version of a picture on the wrong brand.
    s.photos = (s.photos ?? []).filter((p) => owned.has(String(p.mediaAssetId)));
    const o = s.overrides as Record<string, any> | undefined;
    if (o?.backgroundMediaAssetId && !owned.has(String(o.backgroundMediaAssetId))) {
      delete o.backgroundMediaAssetId;
    }
    for (const obj of o?.imageObjects ?? []) {
      if (obj?.mediaAssetId && !owned.has(String(obj.mediaAssetId))) obj.mediaAssetId = undefined;
    }
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
      ...(body.idea ? { idea: body.idea } : {}),
      stage: body.stage ?? (initialSlides.length ? 'drafting' : 'idea'),
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

// ── The Desk ────────────────────────────────────────────────────────────────

/**
 * Where a post sits when it has no explicit stage yet. Derived rather than
 * migrated, so existing projects appear on the Desk immediately and nothing has
 * to be rewritten in the database.
 */
function deriveStage(p: {
  stage?: string;
  renders?: unknown[];
  slides?: Array<{ authored?: { html?: string } }>;
}): string {
  if (p.stage) return p.stage;
  if (p.renders?.length) return 'shipped';
  if (p.slides?.some((s) => s.authored?.html)) return 'ready';
  return p.slides?.length ? 'drafting' : 'idea';
}

/**
 * ONE call for the whole board. Deliberately lean: the dashboard used to do an
 * N+1 (list per brand, then a full getProject per card, each joining the kit and
 * every media asset). Here each card carries only its FIRST slide's markup, and
 * the kits needed to render those thumbnails come back once in a map.
 */
projectsRouter.get(
  '/board',
  asyncHandler(async (_req, res) => {
    const projects = await ProjectModel.find({})
      .sort({ updatedAt: -1 })
      .limit(300)
      .select('businessId title type format status stage idea slides renders exportedAt postedAt updatedAt')
      .lean();

    const businessIds = [...new Set(projects.map((p) => String(p.businessId)))];
    const [businesses, kits] = await Promise.all([
      BusinessModel.find({ _id: { $in: businessIds } }).select('name').lean(),
      BrandKitModel.find({ businessId: { $in: businessIds }, status: 'approved' })
        .sort({ createdAt: -1 })
        .select('businessId colors fonts logo logoTreatment recipe')
        .lean(),
    ]);

    // Newest approved kit wins (regenerations leave older approved kits behind).
    const kitByBusiness: Record<string, unknown> = {};
    for (const k of kits) {
      const key = String((k as Record<string, any>).businessId);
      if (!kitByBusiness[key]) kitByBusiness[key] = { ...k, _id: String((k as Record<string, any>)._id) };
    }

    const cards = projects.map((p) => {
      const slides = (p.slides ?? []) as Array<Record<string, any>>;
      const first = [...slides].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
      return {
        _id: String(p._id),
        businessId: String(p.businessId),
        title: p.title,
        type: p.type,
        format: p.format,
        stage: deriveStage(p as never),
        idea: p.idea ?? '',
        slideCount: slides.length,
        authored: first?.authored ? { html: first.authored.html, bg: first.authored.bg, role: first.authored.role } : null,
        exportedAt: p.exportedAt ?? null,
        postedAt: p.postedAt ?? null,
        updatedAt: p.updatedAt,
      };
    });

    res.json({
      cards,
      businesses: businesses.map((b) => ({ _id: String(b._id), name: (b as Record<string, any>).name })),
      kits: kitByBusiness,
    });
  }),
);

const stageSchema = z.object({
  stage: z.enum(['idea', 'drafting', 'ready', 'shipped']),
  /** The manual "it actually went live" tick — we cannot detect an Instagram post. */
  posted: z.boolean().optional(),
});

projectsRouter.patch(
  '/:id/stage',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const body = parseBody(stageSchema, req.body);
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    project.set('stage', body.stage);
    if (body.posted === true) project.set('postedAt', new Date());
    if (body.posted === false) project.set('postedAt', undefined);
    // Leaving the shipped column un-ships it; the record shouldn't contradict.
    if (body.stage !== 'shipped') project.set('postedAt', undefined);
    await project.save();
    res.json(project.toJSON());
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
    if (body.idea !== undefined) project.set('idea', body.idea);
    // Only while it's still just a prompt — once slides exist they were laid
    // out for this canvas, and swapping the canvas under them would break them.
    if ((body.type !== undefined || body.format !== undefined) && !project.get('slides')?.length) {
      if (body.type !== undefined) project.set('type', body.type);
      if (body.format !== undefined) project.set('format', body.format);
    }
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
    // Stored recipes are migrated on read, so a brand authored against an older
    // shape keeps working instead of failing to parse.
    const stored = kit && (kit as { recipe?: unknown }).recipe;
    let parsedRecipe: { success: true; data: BrandRecipe } | { success: false } | null = null;
    if (stored) {
      try {
        parsedRecipe = { success: true, data: migrateRecipe(stored) };
      } catch {
        parsedRecipe = { success: false };
      }
    }
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

    // No stock photo is attached here any more. A slide the composer decided
    // wants imagery carries an EMPTY `cb-shot` slot instead, and the user fills
    // it with their own upload — a placeholder they replace beats a stock photo
    // they have to notice and undo.
    const slides = composed.map((s, i) => ({
      id: randomUUID(),
      order: i,
      layoutType: 'TextOnly',
      blocks: [],
      imageNeed: 'none',
      photos: [],
      authored: s.authored,
    }));
    project.set('slides', slides);
    project.set('status', 'draft');
    // Keep the prompt: it's what an Ideas card holds, and it lets you see what a
    // finished post was actually asked to be.
    project.set('idea', idea);
    if (!project.get('stage') || project.get('stage') === 'idea') project.set('stage', 'ready');
    await project.save();
    res.json(project.toJSON());
  }),
);

// ── Candidates for ONE slide ────────────────────────────────────────────────
// Compose used to be all-or-nothing: dislike one slide and your options were
// re-composing the whole deck (losing the rest) or editing by hand. These
// endpoints make a single slide re-composable and instantly tweakable.

/** Re-compose ONE slide into N alternatives. Nothing is saved — the user picks. */
projectsRouter.post(
  '/:id/slides/:slideId/variants',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    if (!aiDraftConfigured()) throw new ApiError(400, 'AI is not configured.');
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');

    const slides = (project.get('slides') as Array<{ toObject?: () => SlideInput }>).map((x) =>
      typeof x.toObject === 'function' ? x.toObject() : (x as SlideInput),
    );
    const idx = slides.findIndex((x) => x.id === req.params.slideId);
    if (idx < 0) throw new ApiError(404, 'Slide not found');
    const slide = slides[idx]!;
    if (!slide.authored?.html) throw new ApiError(400, 'This slide is not AI-composed.');

    const stored = (await approvedKitFor(String(project.get('businessId')))) as { recipe?: unknown } | null;
    if (!stored?.recipe) throw new ApiError(400, 'This brand has no design recipe yet.');
    const recipe = migrateRecipe(stored.recipe);

    // The parts are recovered from the markup, so the COPY is preserved exactly
    // and only the arrangement changes (a different composition variant).
    const parts = partsFromAuthored(slide.authored.html);
    const role = (slide.authored.role ?? 'statement') as never;
    const count = Math.min(3, Math.max(2, Number(req.query.count) || 2));

    const variants: Array<{ html: string; bg?: string; role?: string }> = [];
    for (let v = 0; v < count; v++) {
      try {
        const out = await composeSlide(recipe, {
          role,
          parts,
          format: project.get('format'),
          photo: slide.authored.bg === 'photo',
          // Offset the variant index so each candidate follows a different
          // authored arrangement for this role.
          index: idx + v + 1,
        });
        if (out.html) variants.push(out);
      } catch (err) {
        console.warn('[variants] one candidate failed:', err instanceof Error ? err.message : err);
      }
    }
    if (!variants.length) throw new ApiError(502, 'No usable alternatives came back — try again.');
    res.json({ variants });
  }),
);

const tweakSchema = z.object({
  tweak: z.enum(['bigger-headline', 'smaller-headline', 'invert', 'un-invert']),
});

/** Instant, deterministic slide tweaks — no AI, no waiting, fully reversible. */
projectsRouter.post(
  '/:id/slides/:slideId/tweak',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const { tweak } = parseBody(tweakSchema, req.body);
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');

    const slides = (project.get('slides') as Array<{ toObject?: () => SlideInput }>).map((x) =>
      typeof x.toObject === 'function' ? x.toObject() : (x as SlideInput),
    );
    const idx = slides.findIndex((x) => x.id === req.params.slideId);
    if (idx < 0) throw new ApiError(404, 'Slide not found');
    const slide = slides[idx]!;
    if (!slide.authored?.html) throw new ApiError(400, 'This slide is not AI-composed.');

    let { html } = slide.authored;
    let bg = slide.authored.bg;
    switch (tweak) {
      // The recipe's `.sm` headline variant IS the size control — toggle it.
      case 'smaller-headline':
        html = html.replace(/class="headline(?! sm)([^"]*)"/g, 'class="headline sm$1"');
        break;
      case 'bigger-headline':
        html = html.replace(/class="headline sm([^"]*)"/g, 'class="headline$1"');
        break;
      // The recipe's inverse surface, applied per slide.
      case 'invert':
        bg = 'inverse';
        break;
      case 'un-invert':
        bg = undefined;
        break;
    }

    slides[idx] = { ...slide, authored: { ...slide.authored, html, ...(bg ? { bg } : { bg: undefined }) } };
    project.set('slides', normalizeSlides(slides));
    await project.save();
    res.json(project.toJSON());
  }),
);

// ── A slide's photos ────────────────────────────────────────────────────────
// Replace the whole list in one call rather than offering add/move/remove verbs:
// the editor already holds the slide's photos in hand, and one atomic write
// can't leave a slide with two backgrounds or a half-applied drag.
//
// Uploading is NOT here — bytes go to POST /businesses/:id/media (which
// content-sniffs and sanitises them), and the returned asset id is placed here.
const slidePhotosSchema = z.object({ photos: z.array(slidePhotoSchema).max(24) });

projectsRouter.put(
  '/:id/slides/:slideId/photos',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const { photos } = parseBody(slidePhotosSchema, req.body);
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');

    const slides = (project.get('slides') as Array<{ toObject?: () => SlideInput }>).map((x) =>
      typeof x.toObject === 'function' ? x.toObject() : (x as SlideInput),
    );
    const idx = slides.findIndex((x) => x.id === req.params.slideId);
    if (idx < 0) throw new ApiError(404, 'Slide not found');

    // A slot fill must name a slot this slide's markup actually declares —
    // otherwise the photo would be stored and silently never render.
    const declared = new Set(authoredSlots(slides[idx]!.authored?.html ?? ''));
    for (const p of photos) {
      if (p.placement === 'slot' && !declared.has(String(p.slot))) {
        throw new ApiError(400, `This slide has no image slot named "${p.slot}".`);
      }
    }

    slides[idx] = { ...slides[idx]!, photos };
    const normalized = normalizeSlides(slides);
    await scrubForeignMedia(normalized, String(project.get('businessId')));
    project.set('slides', normalized);
    await project.save();
    res.json(project.toJSON());
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
    // Exporting is the one lifecycle step the app can observe, so it advances the
    // stage by itself. "Posted" stays manual — we can't see Instagram.
    project.set('stage', 'shipped');
    project.set('exportedAt', new Date());
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

// ── Animated (video) export ─────────────────────────────────────────────────
// Rendering a video takes ~1–2 min — far longer than a proxy/browser will hold a
// request open — so it runs as a JOB: POST starts it, the client polls status,
// then downloads the finished MP4.

interface VideoJob {
  state: 'running' | 'done' | 'error';
  projectId: string;
  /** One clip per slide — Instagram advances slides on the viewer's tap/swipe. */
  clips?: Array<{ name: string; buffer: Buffer }>;
  title: string;
  /** Real 0–100 render progress, for a determinate loader in the UI. */
  percent: number;
  error?: string;
  startedAt: number;
}
const videoJobs = new Map<string, VideoJob>();
const VIDEO_JOB_TTL_MS = 30 * 60 * 1000;

/** Drop finished jobs after a while so buffers don't accumulate. */
function sweepVideoJobs(): void {
  const now = Date.now();
  for (const [id, job] of videoJobs) {
    if (job.state !== 'running' && now - job.startedAt > VIDEO_JOB_TTL_MS) videoJobs.delete(id);
  }
}

projectsRouter.post(
  '/:id/export-video',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');
    const slides = project.get('slides') ?? [];
    if (!slides.length) throw new ApiError(400, 'Project has no slides to export');
    if (!slides.every((s: { authored?: { html?: string } }) => s.authored?.html)) {
      throw new ApiError(400, 'Video export needs AI-composed slides.');
    }

    sweepVideoJobs();
    const jobId = randomUUID();
    videoJobs.set(jobId, {
      state: 'running',
      projectId: String(id),
      title: slugify(project.get('title')),
      percent: 0,
      startedAt: Date.now(),
    });

    // Fire and forget — the client polls. Never let a rejection escape.
    void (async () => {
      try {
        const clips = await renderSlidesToVideo(project.toJSON() as never, (percent) => {
          const j = videoJobs.get(jobId);
          if (j) j.percent = percent;
        });
        const job = videoJobs.get(jobId);
        if (job) Object.assign(job, { state: 'done', percent: 100, clips });
      } catch (err) {
        const job = videoJobs.get(jobId);
        if (job) {
          Object.assign(job, {
            state: 'error',
            error: `${publicErrMessage(err, 'render error')}. Is the web server running?`,
          });
        }
        console.error('[video] export failed:', err);
      }
    })();

    res.status(202).json({ jobId, state: 'running' });
  }),
);

// Poll a video job. When done, the SAME url serves the result as a download:
// a lone slide streams as one MP4; several stream as a zip of per-slide clips.
projectsRouter.get(
  '/:id/export-video/:jobId',
  asyncHandler(async (req, res) => {
    const job = videoJobs.get(req.params.jobId ?? '');
    if (!job || job.projectId !== req.params.id) throw new ApiError(404, 'Video job not found');
    if (job.state === 'error') throw new ApiError(502, `Video export failed: ${job.error}`);
    if (job.state === 'running') {
      res.json({ state: 'running', percent: job.percent, elapsedMs: Date.now() - job.startedAt });
      return;
    }

    const clips = job.clips ?? [];
    if (clips.length === 1) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${job.title}.mp4"`);
      res.send(clips[0]!.buffer);
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${job.title}-video.zip"`);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[video] archive error:', err);
      res.destroy(err);
    });
    archive.pipe(res);
    for (const clip of clips) archive.append(clip.buffer, { name: clip.name });
    await archive.finalize();
  }),
);
