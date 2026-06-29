import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const mediaAssetSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    type: { type: String, enum: ['upload'], default: 'upload' },
    key: { type: String, required: true },
    url: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const MediaAssetModel: Model<any> = models.MediaAsset ?? model('MediaAsset', mediaAssetSchema);
