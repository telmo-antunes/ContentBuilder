import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

/**
 * Singleton (key: 'ai') holding operator-tunable AI config: per-mode model and
 * system prompt overrides. Any empty field means "use the in-code default", so
 * the app works the same whether or not a settings doc exists.
 */
const settingSchema = new Schema(
  {
    key: { type: String, default: 'ai', unique: true },
    designerModel: { type: String, default: '' },
    freeModel: { type: String, default: '' },
    // Per-touchpoint overrides for every non-draft AI call (see lib/ai.ts modelFor).
    visionModel: { type: String, default: '' },
    critiqueModel: { type: String, default: '' },
    captionModel: { type: String, default: '' },
    campaignModel: { type: String, default: '' },
    backgroundModel: { type: String, default: '' },
    templatesModel: { type: String, default: '' },
    alternativesModel: { type: String, default: '' },
    photoFitModel: { type: String, default: '' },
    designerSystem: { type: String, default: '' },
    templatesSystem: { type: String, default: '' },
    freeSystem: { type: String, default: '' },
    freeMaxTokens: { type: Number, required: false },
    updatedAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const SettingModel: Model<any> = models.Setting ?? model('Setting', settingSchema);
