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
    /**
     * SERIES — recurring forms with a fixed shape and variable content, the
     * way the swipe-file accounts build recognition (Blinkist's "Plot twist",
     * Monzo's question sticker). A series is a saved brief template and a
     * per-slide plan; a new post starts from one and only the topic changes.
     */
    series: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            name: { type: String, required: true },
            hint: { type: String, required: false },
            idea: { type: String, required: false },
            plan: { type: [String], default: undefined },
            format: { type: String, required: false },
          },
          { _id: false },
        ),
      ],
      required: false,
    },
    /** System word → the reader's word; fed to the copywriter. See shared/types.ts GlossaryEntry. */
    glossary: {
      type: [new Schema({ system: { type: String, required: true }, customer: { type: String, required: true } }, { _id: false })],
      required: false,
    },
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
