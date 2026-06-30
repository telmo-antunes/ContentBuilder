import mongoose, { type Model } from 'mongoose';
import { BLOCK_TYPES, LAYOUT_TYPES } from '@contentbuilder/shared';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const frameSchema = new Schema(
  { x: { type: Number }, y: { type: Number }, w: { type: Number }, h: { type: Number } },
  { _id: false },
);

const blockSchema = new Schema(
  {
    type: { type: String, enum: [...BLOCK_TYPES], required: true },
    text: { type: String, default: '' },
    items: { type: [String], default: undefined },
    frame: { type: frameSchema, required: false },
    z: { type: Number, required: false },
  },
  { _id: false },
);

const slideSchema = new Schema(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true },
    layoutType: { type: String, enum: [...LAYOUT_TYPES], required: true },
    blocks: { type: [blockSchema], default: [] },
    imageNeed: { type: String, enum: ['none', 'upload'], default: 'none' },
    mediaAssetId: { type: Schema.Types.ObjectId, ref: 'MediaAsset' },
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
          split: {
            type: String,
            enum: ['image-left', 'image-right', 'image-top', 'image-bottom'],
            required: false,
          },
          imageAspect: {
            type: String,
            enum: ['square', 'landscape', 'wide', 'portrait'],
            required: false,
          },
          imageSize: { type: String, enum: ['sm', 'md', 'lg'], required: false },
          imageFit: { type: String, enum: ['cover', 'contain'], required: false },
          imageZoom: { type: Number, required: false },
          imageFrame: { type: frameSchema, required: false },
          imageBackground: { type: Boolean, required: false },
          imageObjects: {
            type: [
              new Schema(
                {
                  id: { type: String, required: true },
                  mediaAssetId: { type: String, required: false },
                  frame: { type: frameSchema, required: true },
                  fit: { type: String, enum: ['cover', 'contain'], required: false },
                  crop: {
                    type: new Schema(
                      { x: { type: Number }, y: { type: Number }, zoom: { type: Number } },
                      { _id: false },
                    ),
                    required: false,
                  },
                },
                { _id: false },
              ),
            ],
            default: undefined,
          },
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
