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
    /** How the brand talks — grounds caption generation in the brand's own register. */
    voice: { type: String, default: '' },
    homepageScreenshot: { type: storedMediaSchema, required: false },
    provenance: {
      colors: { type: String, default: 'sampled' },
      fonts: { type: String, default: 'computed+mapped' },
      roles: { type: String, default: 'heuristic' },
      logo: { type: String, default: 'dom' },
    },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft', index: true },
    // Pre-recipe kits may still carry `templatePack`/`artDirection`/`layoutLibrary`
    // in storage; those fields are retired — Mongoose strict mode ignores them on
    // read, so old documents load cleanly without surfacing the legacy data.
    /**
     * The brand's design system (tokens + authored stylesheet + composition +
     * imagery + voice) for the HTML-authoring generation path. Mixed — zod
     * (brandRecipeSchema) validates at author time.
     */
    recipe: { type: Schema.Types.Mixed, default: undefined },
    /**
     * Pending recipe CANDIDATES from a multi-take author run — 2–3 alternative
     * design systems ({ id, recipe, note, createdAt }) the user picks between.
     * Selecting one promotes its recipe to `recipe` and clears this. Mixed for
     * the same reason as `recipe`: zod validates the recipes at author time.
     */
    recipeCandidates: { type: [Schema.Types.Mixed], default: undefined },
    createdAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const BrandKitModel: Model<any> = models.BrandKit ?? model('BrandKit', brandKitSchema);
