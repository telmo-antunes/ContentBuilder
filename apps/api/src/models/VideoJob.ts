import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

/** States a job passes through while the exporter is still working on it. */
export const VIDEO_JOB_ACTIVE_STATES = ['queued', 'rendering', 'encoding'] as const;

/**
 * A durable video-export job (replaces the old in-memory Map). The finished
 * MP4/zip is NOT stored on the document — it lives in the StorageProvider under
 * `artifact.key` (video-exports/<projectId>/<jobId>.<ext>), so jobs survive a
 * restart without Mongo ever holding megabytes of video.
 *
 * Cleanup is a sweep, not a Mongo TTL index: a TTL index would delete the doc
 * but strand the stored artifact, so sweepExpiredVideoJobs (lib/videoJobs.ts)
 * removes both together after ~24h.
 */
const videoJobSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    state: {
      type: String,
      enum: ['queued', 'rendering', 'encoding', 'done', 'error', 'cancelled'],
      required: true,
      default: 'queued',
    },
    /** Real 0–100 render progress, for a determinate loader in the UI. */
    percent: { type: Number, default: 0 },
    error: { type: String, required: false },
    /** Set by the cancel route; the render loop polls it between frames. */
    cancelRequested: { type: Boolean, default: false },
    /** Slugified project title at job creation — drives the download filename. */
    title: { type: String, required: true },
    /** Where the finished export lives (set only once state is 'done'). */
    artifact: {
      type: new Schema(
        {
          key: { type: String, required: true },
          contentType: { type: String, required: true },
          filename: { type: String, required: true },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  { ...baseSchemaOptions, timestamps: true },
);

export const VideoJobModel: Model<any> = models.VideoJob ?? model('VideoJob', videoJobSchema);
