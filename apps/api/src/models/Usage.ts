import { Schema, model, type InferSchemaType } from 'mongoose';

/** One AI generation call's token usage + estimated cost (for the usage dashboard). */
const usageSchema = new Schema(
  {
    feature: { type: String, required: true }, // 'draft:free' | 'draft:designer' | …
    model: { type: String, required: true },
    inputTokens: { type: Number, required: true, default: 0 },
    outputTokens: { type: Number, required: true, default: 0 },
    costUsd: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type UsageDoc = InferSchemaType<typeof usageSchema>;
export const Usage = model('Usage', usageSchema);
