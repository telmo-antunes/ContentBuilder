import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const businessSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    websiteUrl: { type: String, trim: true },
    /**
     * Lesson ids this brand's owner has switched off. A lesson is derived from
     * their own edits, so the only honest response to "no, I did not mean
     * that" is to stop applying it — never to argue, and never to forget the
     * observations it came from.
     */
    lessonMutes: { type: [String], required: false },
    profile: {
      type: new Schema(
        {
          category: { type: String, required: true },
          offer: { type: String },
          audience: { type: String },
          tone: { type: [String], default: undefined },
          goal: { type: String },
          completedAt: { type: Date, default: () => new Date() },
        },
        { _id: false },
      ),
      required: false,
    },
    createdAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const BusinessModel: Model<any> = models.Business ?? model('Business', businessSchema);
