import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

/**
 * A point-in-time snapshot of a project's slides (G9 version history). Written
 * automatically before destructive AI actions (draft, polish, restore), on
 * export, and manually from the editor. Capped per project — see saveVersion.
 */
const projectVersionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    label: { type: String, required: true },
    /** Full slides array as stored on the project at snapshot time. */
    slides: { type: [Schema.Types.Mixed], default: [] },
    createdAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

export const ProjectVersionModel: Model<any> =
  models.ProjectVersion ?? model('ProjectVersion', projectVersionSchema);
