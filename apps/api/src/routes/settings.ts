import { Router } from 'express';
import { z } from 'zod';
import { SettingModel } from '../models';
import { asyncHandler, parseBody } from '../lib/http';
import { config } from '../config';

/**
 * Operator-tunable AI config: a per-touchpoint model override for each live AI
 * call. Blank = the environment default (shown as the placeholder). The prompts
 * themselves are no longer operator-editable — the recipe path carries its own
 * exemplars in code.
 */
const settingsSchema = z.object({
  visionModel: z.string().max(120).optional(),
  captionModel: z.string().max(120).optional(),
  photoFitModel: z.string().max(120).optional(),
  recipeModel: z.string().max(120).optional(),
  composeModel: z.string().max(120).optional(),
});

export const settingsRouter = Router();

// Current AI settings + the env-configured models (read-only, for reference).
settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const doc = (await SettingModel.findOne({ key: 'ai' }).lean()) as Record<string, unknown> | null;
    res.json({
      settings: {
        visionModel: (doc?.visionModel as string) ?? '',
        captionModel: (doc?.captionModel as string) ?? '',
        photoFitModel: (doc?.photoFitModel as string) ?? '',
        recipeModel: (doc?.recipeModel as string) ?? '',
        composeModel: (doc?.composeModel as string) ?? '',
      },
      envModels: {
        model: config.ai.model ?? '',
        modelSmall: config.ai.modelSmall ?? '',
        modelLarge: config.ai.modelLarge ?? '',
        modelDesign: config.ai.modelDesign ?? '',
      },
      stock: { configured: Boolean(config.stock.pexelsKey) },
    });
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(settingsSchema, req.body);
    const doc = await SettingModel.findOneAndUpdate(
      { key: 'ai' },
      { ...body, key: 'ai', updatedAt: new Date() },
      { upsert: true, new: true },
    );
    res.json(doc.toJSON());
  }),
);
