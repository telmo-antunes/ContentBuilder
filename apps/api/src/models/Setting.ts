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
    designerSystem: { type: String, default: '' },
    freeSystem: { type: String, default: '' },
    freeMaxTokens: { type: Number, required: false },
    updatedAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const SettingModel: Model<any> = models.Setting ?? model('Setting', settingSchema);
