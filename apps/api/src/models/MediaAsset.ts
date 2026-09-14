import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const mediaAssetSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    type: { type: String, enum: ['upload', 'generated'], default: 'upload' },
    label: { type: String, required: false },
    key: { type: String, required: true },
    url: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    /**
     * WHAT IS IN THE PICTURE, read once by vision (see lib/mediaTags.ts): the
     * kind (photo / screenshot / graphic / logo), the nouns a designer would
     * search for, the tone, whether it carries text, and a caption. Absent on
     * anything uploaded before tagging existed; `npm run media:tag` fills it.
     */
    tags: {
      type: new Schema(
        {
          kind: { type: String, enum: ['photo', 'screenshot', 'graphic', 'logo'], required: true },
          subjects: { type: [String], default: [] },
          tone: { type: String, enum: ['dark', 'mid', 'light'], required: true },
          hasText: { type: Boolean, default: false },
          caption: { type: String, default: '' },
          taggedAt: { type: Date, required: true },
          model: { type: String, default: '' },
        },
        { _id: false },
      ),
      required: false,
    },
    createdAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const MediaAssetModel: Model<any> = models.MediaAsset ?? model('MediaAsset', mediaAssetSchema);
