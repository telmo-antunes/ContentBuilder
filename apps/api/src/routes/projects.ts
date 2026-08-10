import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Router } from 'express';
import { Types } from 'mongoose';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import {
  MAX_DRAFT_PARAGRAPH_CHARS,
  MAX_PLAN_SLIDES,
  MAX_SLIDE_DIRECTION_CHARS,
  VIDEO_SECONDS_DEFAULT,
  authoredSlots,
  clampVideoSeconds,
  defaultThemeForCategory,
  ensureBrandMark,
  isSlotName,
  migrateRecipe,
  slidePhotoSchema,
  type BrandRecipe,
  type SlidePhoto,
} from '@contentbuilder/shared';
import { composeProject, composeSlide, parseSlideCopy, parseSlideDirection } from '../lib/htmlDirector/compose';
import { resolveBrief } from '../lib/sourceIngest';
import { authoredShape, partsFromAuthored, rewriteAuthoredCopy } from '../lib/htmlDirector/reparse';
import { addHeadlineVariant, removeHeadlineVariant } from '../lib/htmlDirector/renderCheck';
import { sanitizeAuthoredHtml } from '../lib/htmlSanitize';
import { ProjectModel, ProjectVersionModel, BusinessModel, BrandKitModel, MediaAssetModel, VideoJobModel, VIDEO_JOB_ACTIVE_STATES } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { createProjectSchema, slideSchema, updateProjectSchema, type SlideInput } from '../lib/validation';
import { renderSlidesToPng, slugify } from '../lib/exporter';
import { runVideoJob, sweepExpiredVideoJobs } from '../lib/videoJobs';
import { getStorage } from '../storage';
import { generateCaption, type GeneratedCaption } from '../lib/caption';
import { SITE_PHOTO_LABEL } from '../lib/harvest';
import { postUpdateStatus } from '../lib/promptStatus';
import { aiDraftConfigured, config } from '../config';

const composeSchema = z.object({
  idea: z.string().trim().min(1, 'An idea is required').max(MAX_DRAFT_PARAGRAPH_CHARS),
  /**
   * How many slides. Optional, and normally ABSENT: the deck length is derived
   * from the brief (a plan fixes it; otherwise the volume of material decides).
   * Kept on the wire so a script or the eval can still pin it.
   */
  slideCount: z.number().int().min(1).max(MAX_PLAN_SLIDES).optional(),
  /**
   * The slide-plan editor's rows: one direction per slide, in order. Anything
   * the user "quoted" inside them is copy to reproduce word for word.
   */
  plan: z
    .array(z.string().trim().max(MAX_SLIDE_DIRECTION_CHARS))
    .max(MAX_PLAN_SLIDES)
    .optional(),
});

export const projectsRouter = Router();

/**
 * The user's photos for one slide, cleaned up: bad asset ids dropped, slot
 * fills without a slot name demoted to free, at most ONE background, and every
 * free overlay given a frame. This array is the whole truth about a slide's
 * photos — the pre-photos-layer `slide.mediaAssetId` was folded in here once by
 * `npm run migrate:photos` and no longer exists.
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
      ...(p.motion && p.motion !== 'auto' ? { motion: p.motion } : {}),
      ...(placement === 'slot' && p.shape ? { shape: p.shape } : {}),
      ...(placement === 'slot' && p.size ? { size: p.size } : {}),
      ...(p.alt ? { alt: p.alt } : {}),
    });
    if (out.length >= 24) break;
  }
  return out;
}

/**
 * Normalize incoming slides: ensure each has an id, and reindex `order`.
 *
 * Also the one place that sees a WHOLE deck on every path that stores one, so
 * it is where the brand mark is made to agree across slides — decks composed
 * before that gate existed repair themselves the first time they are saved,
 * with no AI call and nothing for the user to press.
 */
export function normalizeSlides(slides: SlideInput[]) {
  const marks = ensureBrandMark(slides.map((s) => s.authored?.html ?? ''));
  return slides.map((s, i) => ({
    id: s.id ?? randomUUID(),
    order: i,
    imageNeed: s.imageNeed ?? 'none',
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
          html: sanitizeAuthoredHtml(marks.htmls[i] ?? s.authored.html),
          ...(s.authored.bg ? { bg: s.authored.bg } : {}),
          ...(s.authored.role ? { role: s.authored.role } : {}),
          ...(s.authored.pv ? { pv: s.authored.pv } : {}),
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
    for (const p of s.photos ?? []) ids.add(String(p.mediaAssetId));
  }
  if (ids.size === 0) return;
  const owned = new Set(
    (await MediaAssetModel.find({ _id: { $in: [...ids] }, businessId }).select('_id').lean()).map((m) =>
      String(m._id),
    ),
  );
  for (const s of slides) {
    // A photo pointing at another business's asset is dropped outright — there
    // is no meaningful "partial" version of a picture on the wrong brand.
    s.photos = (s.photos ?? []).filter((p) => owned.has(String(p.mediaAssetId)));
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
      ...(body.plan?.length ? { plan: body.plan } : {}),
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
    // What a newer copywriter or composer would improve about THIS post, with
    // the slides that prove it. Reported, never applied — recomposing rewrites
    // words the user may have edited by hand.
    const promptUpdates = postUpdateStatus(project.slides ?? [], (brandKit as any)?.recipe);
    res.json({ ...project, _id: String(project._id), brandKit, media, promptUpdates });
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
    // An empty plan is a real edit — it means "stop pinning the slides" — so it
    // clears the stored one rather than being read as "leave it alone".
    if (body.plan !== undefined) project.set('plan', body.plan.length ? body.plan : undefined);
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

/** How many of a brand's photos one compose will consider spending. */
const PHOTO_POOL_LIMIT = 24;

/**
 * THE BRAND'S OWN PICTURES, ready to be spent on a fresh deck.
 *
 * Photos harvested from the brand's website come first: they ARE the brand's
 * imagery, which is the whole reason analyze downloads them. Uploads follow,
 * newest first. Nothing from a stock library is ever in here — a composed deck
 * may arrive carrying the brand's own photographs, never a stranger's.
 *
 * EVERY CANDIDATE IS CHECKED AGAINST STORAGE. A media row whose bytes are gone
 * (a re-seed, a swapped storage dir, a manual clean-up) still lists fine and
 * renders as a broken image — which is worse than the empty slot this feature
 * exists to remove. The pool is what can actually be SHOWN, not what is merely
 * recorded, so an orphaned row can neither be attached nor talk the compose
 * step into asking for a slot it cannot fill.
 */
async function brandPhotoPool(businessId: string) {
  const docs = await MediaAssetModel.find({ businessId })
    .sort({ createdAt: -1 })
    .limit(PHOTO_POOL_LIMIT * 3)
    .lean<any[]>();
  const site = docs.filter((d) => d.label === SITE_PHOTO_LABEL);
  const ordered = [...site, ...docs.filter((d) => d.label !== SITE_PHOTO_LABEL)].slice(0, PHOTO_POOL_LIMIT * 2);
  const storage = getStorage();
  const present = await Promise.all(
    ordered.map(async (d) => ((await storage.exists(String(d.key)).catch(() => false)) ? d : null)),
  );
  const usable = present.filter(Boolean).slice(0, PHOTO_POOL_LIMIT) as any[];
  const orphaned = ordered.length - present.filter(Boolean).length;
  if (orphaned) console.warn(`[compose] ${orphaned} media record(s) have no file in storage — not offered to the deck`);
  return usable;
}

/**
 * Fill the holes the composer left, with the brand's own photographs.
 *
 * An empty `cb-shot` renders as a dead grey rectangle taking a third of the
 * poster, and until now every composed slide that asked for a picture shipped
 * exactly that and waited for the user to notice. The compose step now only
 * asks for a slot it can fill (`photoBudget`), and this spends the pool: one
 * photo per slot, no repeats while unused photos remain, in deck order.
 *
 * These are suggestions with a real picture in them, not decisions — every one
 * is swappable from the Studio's photo panel exactly like a manual attachment.
 */
function fillSlotsFromPool(
  slides: Array<{ id: string; authored?: { html: string } }>,
  pool: Array<{ _id: unknown }>,
): { photos: SlidePhoto[][]; used: number } {
  const photos: SlidePhoto[][] = slides.map(() => []);
  let next = 0;
  slides.forEach((slide, i) => {
    for (const slot of authoredSlots(slide.authored?.html ?? '')) {
      if (next >= pool.length) return;
      photos[i]!.push({
        id: randomUUID(),
        mediaAssetId: String((pool[next++] as { _id: unknown })._id),
        placement: 'slot',
        slot,
        fit: 'cover',
      });
    }
  });
  return { photos, used: next };
}

// AI compose: turn an idea into on-brand AUTHORED slides using the brand's
// recipe (its design system). Requires the brand to have a recipe. Replaces the
// project's slides; the previous state is kept recoverable via a version.
projectsRouter.post(
  '/:id/compose',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    const { idea, slideCount, plan } = parseBody(composeSchema, req.body);
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

    // READ WHAT THE BRIEF CITES, and lift its structure out, before writing a
    // word. A brief naming a blog post used to reach the copywriter as a URL
    // string it had never opened; now the page's own headline, structure and
    // lines are the material. Never fatal — a link that will not load is
    // reported back and the deck is written from the user's words alone.
    const businessId = String(project.get('businessId'));
    const [{ brief, sources, failures }, pool] = await Promise.all([
      resolveBrief(idea, plan),
      brandPhotoPool(businessId),
    ]);

    let composed;
    try {
      composed = await composeProject(parsedRecipe.data, brief.idea, {
        format: project.get('format'),
        slideCount,
        plan: brief.plan,
        locks: brief.locks,
        sources,
        // Only ask for a photo slot this brand can actually fill — an empty
        // one is a dead grey box, which is worse than no photograph at all.
        photoBudget: pool.length,
      });
    } catch (err) {
      throw new ApiError(502, `Compose failed: ${publicErrMessage(err, 'AI error')}. You can build manually instead.`);
    }
    if (!composed.length) {
      throw new ApiError(502, 'The compose came back empty — try rephrasing the idea.');
    }

    if (project.get('slides')?.length) await saveVersion(project, 'Before AI compose').catch(() => {});

    // Stock photos are still never attached on the user's behalf. The brand's
    // OWN pictures are a different question — they were harvested from its site
    // precisely so posts could use them — so a slot arrives filled and swappable
    // rather than empty and waiting.
    const base = composed.map((s, i) => ({ id: randomUUID(), order: i, authored: s.authored }));
    const filled = fillSlotsFromPool(base, pool);
    const slides = base.map((s, i) => ({
      ...s,
      imageNeed: 'none' as const,
      photos: filled.photos[i] ?? [],
      // The copywriter's own words for the picture this slide wants — what the
      // Studio's stock picker opens on, instead of an empty search box.
      ...(composed[i]!.imageQuery ? { imageQuery: composed[i]!.imageQuery } : {}),
    }));
    project.set('slides', slides);
    project.set('status', 'draft');
    // Keep the prompt AND the plan: it's what an Ideas card holds, it lets you
    // see what a finished post was actually asked to be, and re-composing later
    // starts from the same brief rather than from a flattened paragraph.
    project.set('idea', idea);
    project.set('plan', brief.plan.length ? brief.plan : undefined);
    // What it was written FROM, so the Studio can link back to it.
    project.set(
      'sources',
      sources.length
        ? sources.map((x) => ({
            url: x.url,
            title: x.title,
            ...(x.byline ? { byline: x.byline } : {}),
            ...(x.published ? { published: x.published } : {}),
            chars: x.text.length,
          }))
        : undefined,
    );
    if (!project.get('stage') || project.get('stage') === 'idea') project.set('stage', 'ready');
    await project.save();
    // The brief's own report rides along with the project: which pages were
    // read, which were skipped and why, and how many slots came back filled.
    res.json({
      ...project.toJSON(),
      brief: {
        sources: sources.map((s) => ({ url: s.url, title: s.title, byline: s.byline, chars: s.text.length })),
        failures,
        plan: brief.plan,
        locks: brief.locks,
        photosAttached: filled.used,
      },
    });
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

    /**
     * WITHOUT A DIRECTION this is what it has always been: the parts are
     * recovered from the markup, so the COPY is preserved exactly and only the
     * arrangement changes.
     *
     * WITH ONE, the same brief language applies to a single slide — "make this
     * one about the wash routine", or a line in quotes to set verbatim. The
     * copywriter rewrites just this slide; the rest of the deck is untouched.
     */
    const direction = String((req.body as { direction?: unknown } | undefined)?.direction ?? '')
      .trim()
      .slice(0, MAX_SLIDE_DIRECTION_CHARS);
    const role = (slide.authored.role ?? 'statement') as never;
    const count = Math.min(3, Math.max(2, Number(req.query.count) || 2));
    const hadPhoto = authoredSlots(slide.authored.html).length > 0;

    let parts = partsFromAuthored(slide.authored.html);
    let photo = hadPhoto;
    let rewrittenRole = role;
    if (direction) {
      if (!aiDraftConfigured()) throw new ApiError(400, 'AI is not configured.');
      try {
        const rewritten = await parseSlideDirection(recipe, direction, {
          format: project.get('format'),
          role,
          index: idx,
          // A rewrite may only keep a picture where the slide already had one —
          // the photos are already attached to this slide's slots.
          photoBudget: hadPhoto ? 1 : 0,
          // What post this slide belongs to, so a direction is read inside the
          // carousel's subject rather than as a brief for a new one.
          post: { title: project.get('title'), idea: project.get('idea'), says: parts },
        });
        parts = rewritten.parts;
        photo = rewritten.photo ?? false;
        rewrittenRole = rewritten.role as never;
      } catch (err) {
        throw new ApiError(502, `Could not rewrite this slide: ${publicErrMessage(err, 'AI error')}`);
      }
    }

    const variants: Array<{ html: string; bg?: string; role?: string }> = [];
    for (let v = 0; v < count; v++) {
      try {
        const out = await composeSlide(recipe, {
          role: rewrittenRole,
          parts,
          format: project.get('format'),
          photo,
          // Offset the variant index so each candidate follows a different
          // authored arrangement for this role.
          index: idx + v + 1,
        });
        // Only the slide's own fields travel: `composeSlide` also reports WHICH
        // path composed it, and that is telemetry, not part of the response.
        //
        // DISTINCT candidates only. Composition by recipe fragment is
        // deterministic, so a role with a fragment produces byte-identical
        // markup however many times it is asked — and the Studio offered two
        // identical "alternatives" side by side, which reads as a broken
        // feature rather than as a brand with one arrangement for that role.
        if (out.html && !variants.some((v) => v.html === out.html)) {
          variants.push({ html: out.html, ...(out.bg ? { bg: out.bg } : {}), ...(out.role ? { role: out.role } : {}) });
        }
      } catch (err) {
        console.warn('[variants] one candidate failed:', err instanceof Error ? err.message : err);
      }
    }
    if (!variants.length) throw new ApiError(502, 'No usable alternatives came back — try again.');
    res.json({ variants });
  }),
);

/**
 * NEW WORDS, SAME LAYOUT — the exact inverse of the endpoint above.
 *
 * "Alternatives" keeps the copy and re-arranges it. This keeps the arrangement
 * and re-writes the copy, which is what you want when a slide is composed well
 * and simply says the wrong thing. No composer runs at all: the new text is
 * spliced into the elements that are already there, so the layout it kept is
 * the layout it had, byte for byte apart from the words.
 */
projectsRouter.post(
  '/:id/slides/:slideId/rewrite',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Project');
    if (!aiDraftConfigured()) throw new ApiError(400, 'AI is not configured.');
    const project = await ProjectModel.findById(id);
    if (!project) throw new ApiError(404, 'Project not found');

    const slides = (project.get('slides') as Array<{ toObject?: () => SlideInput }>).map((x) =>
      typeof x.toObject === 'function' ? x.toObject() : (x as SlideInput),
    );
    const slide = slides.find((x) => x.id === req.params.slideId);
    if (!slide?.authored?.html) throw new ApiError(400, 'This slide is not AI-composed.');

    const stored = (await approvedKitFor(String(project.get('businessId')))) as { recipe?: unknown } | null;
    if (!stored?.recipe) throw new ApiError(400, 'This brand has no design recipe yet.');
    const recipe = migrateRecipe(stored.recipe);

    const direction = String((req.body as { direction?: unknown } | undefined)?.direction ?? '')
      .trim()
      .slice(0, MAX_SLIDE_DIRECTION_CHARS);
    const html = slide.authored.html;
    const shape = authoredShape(html);
    if (!shape.parts.length) throw new ApiError(400, 'This slide has no copy to rewrite.');

    const count = Math.min(3, Math.max(1, Number(req.query.count) || 2));
    const variants: Array<{ html: string; bg?: string; role?: string }> = [];
    for (let v = 0; v < count; v += 1) {
      try {
        const parts = await parseSlideCopy(recipe, shape, {
          format: project.get('format'),
          role: (slide.authored.role ?? 'statement') as never,
          says: partsFromAuthored(html),
          direction,
          post: { title: project.get('title'), idea: project.get('idea') },
        });
        const next = rewriteAuthoredCopy(html, parts);
        // The same guard chain a composed slide gets: sanitise, then re-apply
        // the brand's headline accent to copy that has never seen it.
        const safe = sanitizeAuthoredHtml(next.html);
        if (safe && !variants.some((x) => x.html === safe)) {
          variants.push({
            html: safe,
            ...(slide.authored.bg ? { bg: slide.authored.bg } : {}),
            ...(slide.authored.role ? { role: slide.authored.role } : {}),
          });
        }
      } catch (err) {
        console.warn('[rewrite] one candidate failed:', err instanceof Error ? err.message : err);
      }
    }
    if (!variants.length) throw new ApiError(502, 'No usable rewrite came back — try again.');
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
      // Tokenised rather than pattern-matched: the old regexes only fired when
      // `headline` was the FIRST class in a double-quoted attribute, so on a
      // recipe that writes `class="lead headline"` the button did nothing at all.
      case 'smaller-headline':
        html = addHeadlineVariant(html).html;
        break;
      case 'bigger-headline':
        html = removeHeadlineVariant(html).html;
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

    // Each tweak is a labelled correction of the brand's recipe (type runs too
    // big, too small, wrong default surface). Record it on the APPROVED kit so
    // repeated corrections can surface as ONE suggestion on the brand-kit page
    // instead of evaporating. Un-invert withdraws an invert, so the counter is
    // a net preference. Best-effort: a signal write must never fail the tweak.
    const TWEAK_SIGNALS: Record<typeof tweak, { field: string; by: number }> = {
      'bigger-headline': { field: 'biggerHeadline', by: 1 },
      'smaller-headline': { field: 'smallerHeadline', by: 1 },
      invert: { field: 'invert', by: 1 },
      'un-invert': { field: 'invert', by: -1 },
    };
    const sig = TWEAK_SIGNALS[tweak];
    try {
      await BrandKitModel.findOneAndUpdate(
        { businessId: project.get('businessId'), status: 'approved' },
        {
          $inc: { [`tweakSignals.${sig.field}`]: sig.by },
          $set: { 'tweakSignals.updatedAt': new Date() },
        },
        { sort: { createdAt: -1 } },
      );
    } catch (err) {
      console.warn('[tweak] could not record signal:', err instanceof Error ? err.message : err);
    }

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
    const base = lan ? `http://${lan}:${port}` : config.webUrl;
    res.json({
      // `url` is what the Studio's Share button copies: the interactive preview,
      // which renders live and needs no export. `shareUrl` is the phone hand-off
      // page (/share) that lists exported PNGs for the Web Share API.
      url: `${base}/preview/${id}`,
      previewUrl: `${base}/preview/${id}`,
      shareUrl: `${base}/share/${id}`,
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
// then downloads the finished MP4. Jobs are DURABLE (VideoJobModel + the
// StorageProvider), so finished exports survive a restart and buffers never
// linger in process memory. Runner/recovery/sweep live in lib/videoJobs.ts.

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

    const seconds = clampVideoSeconds(
      (req.body as { secondsPerSlide?: unknown } | undefined)?.secondsPerSlide ?? VIDEO_SECONDS_DEFAULT,
    );

    // Opportunistic cleanup, like the old Map sweep — never blocks the start.
    void sweepExpiredVideoJobs().catch(() => {});

    /**
     * SNAPSHOT the post as it is right now — slides, kit and media, in exactly
     * the shape `GET /projects/:id` returns, because that is what the render
     * route consumes.
     *
     * Without this the renderer fetched the project LIVE for every slide, so
     * editing during an export produced a torn file (early slides old, later
     * ones new). Freezing here means an export is a photograph of one moment
     * and you are free to carry on working — which is the behaviour a
     * background job should have, rather than locking the editor.
     */
    const [snapKit, snapMedia] = await Promise.all([
      approvedKitFor(String(project.get('businessId'))),
      MediaAssetModel.find({ businessId: project.get('businessId') }).sort({ createdAt: -1 }).limit(500).lean(),
    ]);
    const snapshot = {
      ...(project.toJSON() as Record<string, unknown>),
      _id: String(project._id),
      brandKit: snapKit,
      media: snapMedia,
    };

    const job = await VideoJobModel.create({
      projectId: id,
      state: 'queued',
      percent: 0,
      title: slugify(project.get('title')),
      seconds,
      snapshot,
    });

    // Fire and forget — the client polls. The runner writes every outcome to
    // the job doc; this catch is only for the truly unexpected.
    void runVideoJob(String(job._id), project.toJSON() as never, { seconds }).catch((err) =>
      console.error('[video] job runner crashed:', err),
    );

    res.status(202).json({ jobId: String(job._id), state: 'queued', seconds });
  }),
);

/**
 * The frozen render payload for an in-flight export.
 *
 * The render route hits this with `?srcJob=` so every slide of one export is
 * captured from the same moment. Falls back to nothing when the job has no
 * snapshot (a job queued before this existed), and the caller then renders live
 * exactly as before.
 */
projectsRouter.get(
  '/:id/export-source/:jobId',
  asyncHandler(async (req, res) => {
    requireObjectId(req.params.id, 'Project');
    const job = (await VideoJobModel.findById(requireObjectId(req.params.jobId, 'Job')).lean()) as
      | { snapshot?: unknown }
      | null;
    if (!job?.snapshot) throw new ApiError(404, 'No snapshot for this job');
    res.json(job.snapshot);
  }),
);

// Poll a video job. When done, the SAME url serves the result as a download
// (streamed back out of the StorageProvider): a lone slide is one MP4; several
// are a zip of per-slide clips.
projectsRouter.get(
  '/:id/export-video/:jobId',
  asyncHandler(async (req, res) => {
    const projectId = requireObjectId(req.params.id, 'Project');
    if (!Types.ObjectId.isValid(req.params.jobId ?? '')) {
      throw new ApiError(404, 'Video job not found');
    }
    const job = await VideoJobModel.findById(req.params.jobId);
    if (!job || String(job.get('projectId')) !== projectId) {
      throw new ApiError(404, 'Video job not found');
    }

    const state = job.get('state') as string;
    if (state === 'error') {
      throw new ApiError(502, `Video export failed: ${job.get('error') ?? 'render error'}`);
    }
    if (state !== 'done') {
      // Covers queued/rendering/encoding — and 'cancelled', which stays a JSON
      // status so the client can stop polling.
      res.json({
        state,
        percent: job.get('percent') ?? 0,
        elapsedMs: Date.now() - new Date(job.get('createdAt')).getTime(),
      });
      return;
    }

    const artifact = job.get('artifact') as
      | { key: string; contentType: string; filename: string }
      | undefined;
    const storage = getStorage();
    if (!artifact || !(await storage.exists(artifact.key))) {
      throw new ApiError(410, 'Video export has expired — start a new export.');
    }
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    res.send(await storage.read(artifact.key));
  }),
);

// Cancel a running video job. The render loop polls the flag between frames
// (and while ffmpeg runs), so the job settles to 'cancelled' within a second
// or two; cancelling an already-terminal job is a harmless no-op.
projectsRouter.post(
  '/:id/export-video/:jobId/cancel',
  asyncHandler(async (req, res) => {
    const projectId = requireObjectId(req.params.id, 'Project');
    if (!Types.ObjectId.isValid(req.params.jobId ?? '')) {
      throw new ApiError(404, 'Video job not found');
    }
    const job = await VideoJobModel.findOneAndUpdate(
      { _id: req.params.jobId, projectId, state: { $in: [...VIDEO_JOB_ACTIVE_STATES] } },
      { $set: { state: 'cancelled', cancelRequested: true } },
      { new: true },
    );
    if (job) {
      res.json({ state: 'cancelled', percent: job.get('percent') ?? 0 });
      return;
    }
    const existing = await VideoJobModel.findOne({ _id: req.params.jobId, projectId });
    if (!existing) throw new ApiError(404, 'Video job not found');
    res.json({ state: existing.get('state'), percent: existing.get('percent') ?? 0 });
  }),
);
