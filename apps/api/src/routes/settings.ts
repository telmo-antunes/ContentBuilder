import { Router } from 'express';
import { z } from 'zod';
import { SettingModel } from '../models';
import { asyncHandler, parseBody } from '../lib/http';
import { PROMPT_DEFAULTS } from '../lib/draft';
import { TEMPLATES_SYSTEM } from '../lib/templates';
import { config } from '../config';

const settingsSchema = z.object({
  designerModel: z.string().max(120).optional(),
  freeModel: z.string().max(120).optional(),
  visionModel: z.string().max(120).optional(),
  critiqueModel: z.string().max(120).optional(),
  captionModel: z.string().max(120).optional(),
  campaignModel: z.string().max(120).optional(),
  backgroundModel: z.string().max(120).optional(),
  templatesModel: z.string().max(120).optional(),
  alternativesModel: z.string().max(120).optional(),
  photoFitModel: z.string().max(120).optional(),
  designerSystem: z.string().max(20000).optional(),
  freeSystem: z.string().max(20000).optional(),
  templatesSystem: z.string().max(20000).optional(),
  freeMaxTokens: z.number().int().min(256).max(16000).nullable().optional(),
});

/** The code default for each overridable prompt (see normalization below). */
const PROMPT_DEFAULT_BY_FIELD: Record<string, string> = {
  designerSystem: PROMPT_DEFAULTS.designerSystem,
  freeSystem: PROMPT_DEFAULTS.freeSystem,
  templatesSystem: TEMPLATES_SYSTEM,
};

export const settingsRouter = Router();

// Current AI settings + the code defaults (so the editor can prefill / reset) +
// the env-configured models (read-only, for reference).
settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const doc = (await SettingModel.findOne({ key: 'ai' }).lean()) as Record<string, unknown> | null;
    res.json({
      settings: {
        designerModel: (doc?.designerModel as string) ?? '',
        freeModel: (doc?.freeModel as string) ?? '',
        visionModel: (doc?.visionModel as string) ?? '',
        critiqueModel: (doc?.critiqueModel as string) ?? '',
        captionModel: (doc?.captionModel as string) ?? '',
        campaignModel: (doc?.campaignModel as string) ?? '',
        backgroundModel: (doc?.backgroundModel as string) ?? '',
        templatesModel: (doc?.templatesModel as string) ?? '',
        alternativesModel: (doc?.alternativesModel as string) ?? '',
        photoFitModel: (doc?.photoFitModel as string) ?? '',
        designerSystem: (doc?.designerSystem as string) ?? '',
        freeSystem: (doc?.freeSystem as string) ?? '',
        templatesSystem: (doc?.templatesSystem as string) ?? '',
        freeMaxTokens: (doc?.freeMaxTokens as number) ?? null,
      },
      defaults: { ...PROMPT_DEFAULTS, templatesSystem: TEMPLATES_SYSTEM },
      envModels: {
        model: config.ai.model ?? '',
        modelSmall: config.ai.modelSmall ?? '',
        modelLarge: config.ai.modelLarge ?? '',
      },
      stock: { configured: Boolean(config.stock.pexelsKey) },
    });
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body: Record<string, unknown> = parseBody(settingsSchema, req.body);
    // FOOTGUN GUARD: "Load default" fills a prompt field so it can be read;
    // saving that unedited copy would freeze the prompt at today's version and
    // silently miss every future improvement. A prompt identical to its code
    // default is stored as blank (= keep following the default).
    for (const [field, def] of Object.entries(PROMPT_DEFAULT_BY_FIELD)) {
      if (typeof body[field] === 'string' && (body[field] as string).trim() === def.trim()) {
        body[field] = '';
      }
    }
    const doc = await SettingModel.findOneAndUpdate(
      { key: 'ai' },
      { ...body, key: 'ai', updatedAt: new Date() },
      { upsert: true, new: true },
    );
    res.json(doc.toJSON());
  }),
);
