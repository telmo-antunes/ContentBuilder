import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const frameSchema = new Schema(
  { x: { type: Number }, y: { type: Number }, w: { type: Number }, h: { type: Number } },
  { _id: false },
);

/** One of the user's photos on a slide — see shared/slidePhotos.ts. */
const slidePhotoSchema = new Schema(
  {
    id: { type: String, required: true },
    mediaAssetId: { type: Schema.Types.ObjectId, ref: 'MediaAsset', required: true },
    placement: { type: String, enum: ['slot', 'background', 'free'], required: true },
    /** 'slot': the authored placeholder this fills (its data-cb-slot name). */
    slot: { type: String, required: false },
    /** 'free': where it sits on the canvas, as fractions [0..1]. */
    frame: { type: frameSchema, required: false },
    fit: { type: String, enum: ['cover', 'contain'], required: false },
    /** Which part of the photo survives the crop, as fractions [0..1]. */
    focal: {
      type: new Schema({ x: { type: Number }, y: { type: Number } }, { _id: false }),
      required: false,
    },
    /** How this photo drifts in a video export ('auto' follows the brand). */
    motion: { type: String, required: false },
    /** 'slot': resize the authored hole without rewriting its markup. */
    shape: { type: String, enum: ['standard', 'wide', 'square', 'tall'], required: false },
    size: { type: String, enum: ['sm', 'md', 'lg'], required: false },
    /** 'free': negative sends it behind the composition. */
    z: { type: Number, required: false },
    alt: { type: String, required: false },
  },
  { _id: false },
);

/**
 * Slides are authored-first. Block-era fields (`layoutType`, `blocks`, most of
 * `overrides.*`) are gone from the schema; documents stored before the pivot
 * may still carry them, and Mongoose strict mode simply ignores those stored
 * fields on read — nothing crashes, nothing surfaces them.
 */
const slideSchema = new Schema(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true },
    imageNeed: { type: String, enum: ['none', 'upload'], default: 'none' },
    mediaAssetId: { type: Schema.Types.ObjectId, ref: 'MediaAsset' },
    /** The user's own photos on this slide (slot fills, background, overlays). */
    photos: { type: [slidePhotoSchema], default: [] },
    /** The stock-search phrase the AI art director chose (prefills the editor's stock picker). */
    imageQuery: { type: String, required: false },
    overrides: {
      type: new Schema(
        {
          focalPoint: {
            type: new Schema(
              { x: { type: Number }, y: { type: Number } },
              { _id: false },
            ),
            required: false,
          },
          imageTreatment: { type: String, enum: ['none', 'tint', 'duotone'], required: false },
          theme: { type: String, enum: ['editorial', 'bold', 'minimal', 'soft'], required: false },
        },
        { _id: false },
      ),
      required: false,
    },
    /** AI-authored slide markup (semantic HTML using the brand recipe's classes)
     *  — what the renderer mounts. */
    authored: {
      type: new Schema(
        {
          html: { type: String, required: true },
          bg: { type: String, required: false },
          /** The composer's slide role — drives per-role motion in video export. */
          role: { type: String, required: false },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['carousel', 'story'], required: true },
    format: { type: String, required: true },
    slides: { type: [slideSchema], default: [] },
    /** URLs of the last export's PNGs (drives the send-to-phone share page). */
    renders: { type: [String], default: undefined },
    /** The social caption + hashtags for this post, generated in the brand voice. */
    caption: {
      type: new Schema(
        { text: { type: String, default: '' }, hashtags: { type: [String], default: [] } },
        { _id: false },
      ),
      required: false,
    },
    settings: {
      type: new Schema(
        {
          theme: { type: String, enum: ['editorial', 'bold', 'minimal', 'soft'], required: false },
          slideCounter: { type: Boolean, required: false },
        },
        { _id: false },
      ),
      required: false,
    },
    status: { type: String, enum: ['draft', 'rendered'], default: 'draft' },
    /** Workflow stage — the Desk's columns. Separate from `status` on purpose. */
    stage: { type: String, enum: ['idea', 'drafting', 'ready', 'shipped'], index: true },
    /** The prompt behind the post (an 'idea' card has this and no slides yet). */
    idea: { type: String, required: false },
    /** Set automatically on export; `postedAt` is the manual "it went live" tick. */
    exportedAt: { type: Date, required: false },
    postedAt: { type: Date, required: false },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

projectSchema.pre('save', function updateTimestamp(next) {
  this.set('updatedAt', new Date());
  next();
});

export const ProjectModel: Model<any> = models.Project ?? model('Project', projectSchema);
