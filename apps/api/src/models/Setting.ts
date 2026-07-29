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
    // Per-touchpoint overrides for every live AI call (see lib/ai.ts modelFor).
    // Retired block-era override fields (designerModel, freeSystem, director*…)
    // may linger in a stored doc; strict mode ignores them on read.
    visionModel: { type: String, default: '' },
    captionModel: { type: String, default: '' },
    /** HTML-authoring path: brand recipe author (design tier) + idea→slide compose (cheap tier). */
    recipeModel: { type: String, default: '' },
    composeModel: { type: String, default: '' },
    updatedAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const SettingModel: Model<any> = models.Setting ?? model('Setting', settingSchema);
