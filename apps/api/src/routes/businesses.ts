import { Router } from 'express';
import { z } from 'zod';
import { BUSINESS_CATEGORIES, BUSINESS_GOALS } from '@contentbuilder/shared';
import { BusinessModel, BrandKitModel, ProjectModel, MediaAssetModel } from '../models';
import { getStorage } from '../storage';
import { ApiError, asyncHandler, parseBody, requireObjectId } from '../lib/http';

export const businessesRouter = Router();

const profileSchema = z.object({
  category: z.enum(BUSINESS_CATEGORIES.map((c) => c.value) as unknown as [string, ...string[]]),
  offer: z.string().trim().max(300).optional(),
  audience: z.string().trim().max(300).optional(),
  tone: z.array(z.string().max(40)).max(8).optional(),
  goal: z.enum(BUSINESS_GOALS.map((g) => g.value) as unknown as [string, ...string[]]).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  websiteUrl: z.string().trim().max(500).optional().or(z.literal('')),
  profile: profileSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  websiteUrl: z.string().trim().max(500).optional().or(z.literal('')),
  profile: profileSchema.nullable().optional(),
});

/** Attach kit-status + project-count summaries used by the list/detail UI. */
async function enrich(businesses: Array<Record<string, any>>) {
  const ids = businesses.map((b) => b._id);
  const [approvedKits, draftIds, counts] = await Promise.all([
    BrandKitModel.find({ businessId: { $in: ids }, status: 'approved' })
      .select('businessId colors logo createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    BrandKitModel.distinct('businessId', { businessId: { $in: ids }, status: 'draft' }),
    ProjectModel.aggregate([
      { $match: { businessId: { $in: ids } } },
      { $group: { _id: '$businessId', n: { $sum: 1 } } },
    ]),
  ]);
  // Latest approved kit per business (sorted desc, first wins) — the list UI
  // shows each brand's identity (palette strip + logo), not just a status chip.
  const kitByBiz = new Map<string, Record<string, any>>();
  for (const k of approvedKits) {
    const key = String(k.businessId);
    if (!kitByBiz.has(key)) kitByBiz.set(key, k);
  }
  const draft = new Set(draftIds.map(String));
  const countByBiz = new Map(counts.map((c: { _id: unknown; n: number }) => [String(c._id), c.n]));
  return businesses.map((b) => {
    const id = String(b._id);
    const kit = kitByBiz.get(id);
    return {
      ...(b as Record<string, unknown>),
      hasApprovedKit: Boolean(kit),
      hasDraftKit: draft.has(id),
      hasProfile: Boolean(b.profile?.category),
      projectCount: countByBiz.get(id) ?? 0,
      kit: kit ? { colors: kit.colors, logoUrl: kit.logo?.url } : undefined,
    };
  });
}

// List businesses (newest first), enriched with brand-kit + project summaries.
businessesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const docs = await BusinessModel.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json(await enrich(docs));
  }),
);

// Create a business.
businessesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req.body);
    const created = await BusinessModel.create({
      name: body.name,
      websiteUrl: body.websiteUrl || undefined,
      profile: body.profile ? { ...body.profile, completedAt: new Date() } : undefined,
    });
    res.status(201).json(created.toJSON());
  }),
);

// Get one business with its current kit summary + project list.
businessesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Business');
    const doc = await BusinessModel.findById(id).lean();
    if (!doc) throw new ApiError(404, 'Business not found');
    const [enriched] = await enrich([doc]);
    const projects = await ProjectModel.find({ businessId: id })
      .select('title type format status slides settings updatedAt campaignId')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ ...enriched, projects });
  }),
);

// Update name / website.
businessesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Business');
    const body = parseBody(updateSchema, req.body);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.websiteUrl !== undefined) update.websiteUrl = body.websiteUrl || undefined;
    if (body.profile !== undefined) {
      update.profile = body.profile ? { ...body.profile, completedAt: new Date() } : undefined;
    }
    const doc = await BusinessModel.findByIdAndUpdate(id, update, { new: true });
    if (!doc) throw new ApiError(404, 'Business not found');
    res.json(doc.toJSON());
  }),
);

// Delete a business and everything that belongs to it (cascade + storage cleanup).
businessesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'Business');
    const doc = await BusinessModel.findById(id);
    if (!doc) throw new ApiError(404, 'Business not found');

    const storage = getStorage();
    const keys: string[] = [];

    const kits = await BrandKitModel.find({ businessId: id }).lean();
    for (const k of kits) {
      if (k.logo?.key) keys.push(k.logo.key);
      if (k.homepageScreenshot?.key) keys.push(k.homepageScreenshot.key);
    }
    const media = await MediaAssetModel.find({ businessId: id }).lean();
    for (const m of media) if (m.key) keys.push(m.key);

    await Promise.all([
      BrandKitModel.deleteMany({ businessId: id }),
      ProjectModel.deleteMany({ businessId: id }),
      MediaAssetModel.deleteMany({ businessId: id }),
    ]);
    await BusinessModel.deleteOne({ _id: id });

    // Best-effort storage cleanup — never block the delete on a missing file.
    await Promise.all(keys.map((k) => storage.remove(k).catch(() => {})));

    res.json({ ok: true, deleted: { kits: kits.length, media: media.length } });
  }),
);
