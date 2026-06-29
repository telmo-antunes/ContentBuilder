import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const storedMediaSchema = new Schema(
  {
    key: { type: String, required: true },
    url: { type: String, required: true },
  },
  { _id: false },
);

const brandKitSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    colors: {
      primary: { type: String, required: true },
      secondary: { type: String, required: true },
      accent: { type: String, required: true },
      background: { type: String, required: true },
      text: { type: String, required: true },
      palette: { type: [String], default: [] },
    },
    fonts: {
      detected: {
        heading: { type: String, default: '' },
        body: { type: String, default: '' },
      },
      render: {
        heading: { type: String, required: true },
        body: { type: String, required: true },
      },
    },
    logo: {
      sourceUrl: { type: String },
      key: { type: String },
      url: { type: String },
    },
    logoTreatment: { type: String, enum: ['original', 'mono'], default: 'original' },
    styleDescriptor: { type: String, default: '' },
    homepageScreenshot: { type: storedMediaSchema, required: false },
    provenance: {
      colors: { type: String, default: 'sampled' },
      fonts: { type: String, default: 'computed+mapped' },
      roles: { type: String, default: 'heuristic' },
      logo: { type: String, default: 'dom' },
    },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft', index: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const BrandKitModel: Model<any> = models.BrandKit ?? model('BrandKit', brandKitSchema);
