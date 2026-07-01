import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const conceptSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    angle: { type: String, default: '' },
    paragraph: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: false },
  },
  { _id: false },
);

const campaignSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    name: { type: String, required: true, trim: true },
    brief: { type: String, default: '' },
    goal: { type: String, enum: ['awareness', 'leads', 'sales', 'community'], required: false },
    type: { type: String, enum: ['carousel', 'story'], required: true },
    format: { type: String, required: true },
    concepts: { type: [conceptSchema], default: [] },
    createdAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const CampaignModel: Model<any> = models.Campaign ?? model('Campaign', campaignSchema);
