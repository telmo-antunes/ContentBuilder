import { Router } from 'express';
import { z } from 'zod';
import {
  ASSET_TYPES,
  BUSINESS_GOALS,
  isFormat,
  isValidTypeFormat,
  type AssetType,
  type Format,
} from '@contentbuilder/shared';
import { CampaignModel, BusinessModel, BrandKitModel, ProjectModel } from '../models';
import { ApiError, asyncHandler, parseBody, publicErrMessage, requireObjectId } from '../lib/http';
import { planCampaign } from '../lib/campaign';
import { draftSlidesFromParagraph } from '../lib/draft';
import { normalizeSlides, finalizeDraftedProject } from './projects';
import { aiDraftConfigured } from '../config';

const asEnum = <T extends readonly string[]>(values: T) =>
  z.enum(values as unknown as [string, ...string[]]);

const createSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    brief: z.string().trim().min(1, 'A brief is required').max(1500),
    count: z.number().int().min(1).max(12).default(5),
    goal: asEnum(BUSINESS_GOALS.map((g) => g.value) as unknown as [string, ...string[]]).optional(),
    type: asEnum(ASSET_TYPES),
    format: z.string(),
  })
  .refine((d) => isFormat(d.format) && isValidTypeFormat(d.type as AssetType, d.format as Format), {
    message: 'Invalid type/format combination',
    path: ['format'],
  });

async function approvedKitFor(businessId: string) {
  return BrandKitModel.findOne({ businessId, status: 'approved' }).sort({ createdAt: -1 }).lean();
}

/** Business-scoped: mounted at /businesses/:id/campaigns */
export const businessCampaignRouter = Router({ mergeParams: true });

function businessId(req: { params: Record<string, string | undefined> }): string {
  return requireObjectId(req.params.id, 'Business');
}

// Create a campaign and plan its concepts (the cheap step — no slides drafted yet).
businessCampaignRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const id = businessId(req);
    if (!aiDraftConfigured()) {
      throw new ApiError(400, 'Campaign planning needs ANTHROPIC_API_KEY + ANTHROPIC_MODEL_SMALL.');
    }
    const body = parseBody(createSchema, req.body);
    const business = await BusinessModel.findById(id).lean();
    if (!business) throw new ApiError(404, 'Business not found');
    if (!(business as any).profile?.category) {
      throw new ApiError(400, 'Complete the business profile before planning a campaign.');
    }
    const kit = await approvedKitFor(id);
    if (!kit) throw new ApiError(400, 'Approve a brand kit before planning a campaign.');

    let concepts;
    try {
      concepts = await planCampaign({
        brief: body.brief,
        count: body.count,
        businessName: (business as any).name,
        voice: (kit as any).voice,
        styleDescriptor: (kit as any).styleDescriptor,
        profile: (business as any).profile,
        goal: body.goal,
      });
    } catch (err) {
      throw new ApiError(502, `Campaign planning failed: ${publicErrMessage(err, 'AI error')}.`);
    }
    if (!concepts.length) throw new ApiError(502, 'The plan came back empty — try rephrasing the brief.');

    const campaign = await CampaignModel.create({
      businessId: id,
      name: body.name?.trim() || body.brief.slice(0, 60),
      brief: body.brief,
      goal: body.goal,
      type: body.type,
      format: body.format,
      concepts,
    });
    res.status(201).json(campaign.toJSON());
  }),
);

// List a business's campaigns (newest first).
businessCampaignRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const id = businessId(req);
    const docs = await CampaignModel.find({ businessId: id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(docs.map((c) => ({ ...c, _id: String(c._id) })));
  }),
);

/** Item-scoped: mounted at /campaigns */
export const campaignRouter = Router();

campaignRouter.get(
  '/:campaignId',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.campaignId, 'Campaign');
    const campaign = await CampaignModel.findById(id).lean();
    if (!campaign) throw new ApiError(404, 'Campaign not found');
    res.json({ ...campaign, _id: String((campaign as any)._id) });
  }),
);

campaignRouter.delete(
  '/:campaignId',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.campaignId, 'Campaign');
    const deleted = await CampaignModel.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'Campaign not found');
    res.json({ ok: true });
  }),
);

// Draft one concept into a real Project on demand (the expensive step).
campaignRouter.post(
  '/:campaignId/concepts/:conceptId/draft',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.campaignId, 'Campaign');
    if (!aiDraftConfigured()) {
      throw new ApiError(400, 'AI draft is not configured (set ANTHROPIC_API_KEY + ANTHROPIC_MODEL_SMALL).');
    }
    const campaign = await CampaignModel.findById(id);
    if (!campaign) throw new ApiError(404, 'Campaign not found');
    const concepts = campaign.get('concepts') as Array<Record<string, any>>;
    const concept = concepts.find((c) => c.id === req.params.conceptId);
    if (!concept) throw new ApiError(404, 'Concept not found');

    // Already drafted → return the existing project (idempotent).
    if (concept.projectId) {
      const existing = await ProjectModel.findById(concept.projectId);
      if (existing) {
        res.json(existing.toJSON());
        return;
      }
    }

    const businessIdStr = String(campaign.get('businessId'));
    const kit = await approvedKitFor(businessIdStr);
    if (!kit) throw new ApiError(400, 'Approve a brand kit before drafting campaign posts.');

    const type = campaign.get('type') as AssetType;
    const format = campaign.get('format') as Format;
    const project = await ProjectModel.create({
      businessId: businessIdStr,
      campaignId: id,
      title: concept.title,
      type,
      format,
      status: 'draft',
      slides: [],
    });

    let slides;
    try {
      slides = await draftSlidesFromParagraph(concept.paragraph, type, format, 'designer');
    } catch (err) {
      await ProjectModel.findByIdAndDelete(project.get('_id')).catch(() => {});
      throw new ApiError(502, `Draft failed: ${publicErrMessage(err, 'AI error')}.`);
    }
    if (!slides.length) {
      await ProjectModel.findByIdAndDelete(project.get('_id')).catch(() => {});
      throw new ApiError(502, 'The draft came back empty — edit the concept and retry.');
    }

    project.set('slides', normalizeSlides(slides));
    await project.save();

    // Link the concept → project BEFORE the best-effort polish/caption pass:
    // if the process dies mid-finalize, the link already exists, so a retry
    // returns this project instead of drafting an orphaned duplicate.
    concept.projectId = project.get('_id');
    campaign.markModified('concepts');
    await campaign.save();

    await finalizeDraftedProject(project);

    res.status(201).json(project.toJSON());
  }),
);
