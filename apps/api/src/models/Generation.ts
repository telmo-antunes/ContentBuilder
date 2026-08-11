import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

/**
 * ONE RECORD OF THE APP WRITING SOMETHING — the exact prompts that made a deck,
 * the deck they made, and (later) what the user did to it.
 *
 * This is the substrate for the learning loop. Without it the most valuable
 * information in the product — a person patiently correcting the same mistake
 * every week — is destroyed on save, and the next post is written by a
 * copywriter that has never heard of any of it.
 *
 * WHAT IS AND IS NOT STORED. The USER messages are, because they are the half
 * that varies per post and the half a replay needs. The SYSTEM prompts are not:
 * they are the same bytes for every brand, they live in the prompt registry
 * already, and a hash is enough to know which text was in force. That keeps a
 * record to a few kilobytes plus whatever source material was read.
 *
 * Append-only in spirit: the only field ever written after creation is
 * `outcome`, which is the diff against what shipped.
 */
const generationSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    /** 'deck' — a whole compose; 'slide' — one slide rewritten in the Studio. */
    kind: { type: String, enum: ['deck', 'slide'], default: 'deck' },

    /** WHAT WAS ASKED. */
    brief: {
      type: new Schema(
        {
          idea: { type: String, default: '' },
          plan: { type: [String], default: undefined },
          locks: { type: [String], default: undefined },
          sources: {
            type: [
              new Schema(
                {
                  url: { type: String, required: true },
                  title: { type: String, required: false },
                  chars: { type: Number, required: false },
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

    /** WHAT MADE IT — enough to know why two records differ. */
    models: {
      type: new Schema(
        { parse: { type: String }, compose: { type: String } },
        { _id: false },
      ),
      required: false,
    },
    /**
     * The prompt-registry versions in force. Enough to know exactly which
     * prompt text made this: the hash guard (`promptHashes.test.ts`) is what
     * keeps a version number from ever describing a prompt that has changed.
     */
    promptVersions: { type: Schema.Types.Mixed, required: false },

    /** THE PROMPTS THEMSELVES — the variable half. */
    parseUser: { type: String, required: false },

    /** WHAT CAME OUT, per slide, as generated. */
    slides: {
      type: [
        new Schema(
          {
            /** The slide id in the project, so an outcome can be matched to it. */
            id: { type: String, required: true },
            role: { type: String, required: false },
            /** The copy parts the copywriter wrote. */
            parts: { type: Schema.Types.Mixed, required: false },
            /** The markup that shipped out of compose. */
            html: { type: String, required: false },
            /** 'fragment' (free, deterministic) or 'ai' (a model call). */
            path: { type: String, required: false },
            /** The composer's USER message, when a model actually composed it. */
            composeUser: { type: String, required: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** WHAT THE USER DID TO IT. Written once the deck is saved or exported. */
    outcome: { type: Schema.Types.Mixed, required: false },

    createdAt: { type: Date, default: () => new Date(), index: true },
  },
  baseSchemaOptions,
);

/** Reading a brand's recent generations is the only query this collection serves. */
generationSchema.index({ businessId: 1, createdAt: -1 });

export const GenerationModel: Model<any> = models.Generation ?? model('Generation', generationSchema);
