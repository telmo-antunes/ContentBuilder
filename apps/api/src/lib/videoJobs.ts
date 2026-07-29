import { ZipArchive } from 'archiver';
import { VideoJobModel, VIDEO_JOB_ACTIVE_STATES } from '../models';
import { getStorage } from '../storage';
import { publicErrMessage } from './http';
import { renderSlidesToVideo, VideoExportCancelled } from './videoExporter';

/**
 * Durable video-export jobs. State lives in Mongo (VideoJobModel) and the
 * finished MP4/zip lives in the StorageProvider — nothing survives in process
 * memory, so jobs outlast a restart and never pin megabytes of video.
 */

/** Finished jobs (and their stored artifacts) are swept after ~24h. */
const VIDEO_JOB_TTL_MS = 24 * 60 * 60 * 1000;
/** How often the running exporter re-reads the cancel flag from the DB. */
const CANCEL_POLL_MS = 500;

/** Where a job's finished artifact lives in the StorageProvider. */
export function videoArtifactKey(projectId: string, jobId: string, ext: 'mp4' | 'zip'): string {
  return `video-exports/${projectId}/${jobId}.${ext}`;
}

/**
 * Run one export job to completion: render → persist the artifact through the
 * StorageProvider → mark the doc done. Never throws — every outcome (done,
 * error, cancelled) is written to the job document for the poll route to read.
 */
export async function runVideoJob(jobId: string, project: { _id: string }): Promise<void> {
  const projectId = String(project._id);
  const storage = getStorage();

  // Claim the job. If a cancel raced in before we started, stop right here.
  const claimed = await VideoJobModel.updateOne(
    { _id: jobId, state: 'queued' },
    { $set: { state: 'rendering' } },
  );
  if (claimed.modifiedCount === 0) return;

  // The cancel flag is durable (set on the doc by the cancel route); the render
  // loop asks often, so cap the DB reads at one per CANCEL_POLL_MS.
  let cancelled = false;
  let lastCheckAt = 0;
  const isCancelled = async (): Promise<boolean> => {
    if (cancelled) return true;
    const now = Date.now();
    if (now - lastCheckAt < CANCEL_POLL_MS) return false;
    lastCheckAt = now;
    const doc = (await VideoJobModel.findById(jobId)
      .select('state cancelRequested')
      .lean()) as { state?: string; cancelRequested?: boolean } | null;
    cancelled = !doc || doc.cancelRequested === true || doc.state === 'cancelled';
    return cancelled;
  };

  // Progress: one write per integer-percent change (renders run minutes, so
  // this stays well under a write per second).
  let lastWritten = -1;
  const onProgress = (percent: number) => {
    const p = Math.round(percent);
    if (p === lastWritten) return;
    lastWritten = p;
    void VideoJobModel.updateOne(
      { _id: jobId, state: 'rendering' },
      { $set: { percent: p } },
    ).catch(() => {});
  };

  try {
    const clips = await renderSlidesToVideo(project as never, onProgress, isCancelled);

    // Packaging + persisting the artifact is the 'encoding' tail of the job.
    await VideoJobModel.updateOne(
      { _id: jobId, state: 'rendering' },
      { $set: { state: 'encoding', percent: 99 } },
    );
    if (await isCancelled()) throw new VideoExportCancelled();

    const title = String(
      ((await VideoJobModel.findById(jobId).select('title').lean()) as { title?: string } | null)
        ?.title ?? 'project',
    );
    // One slide → a lone MP4; several → a zip of per-slide clips. Either way the
    // bytes go straight to storage and the buffers are dropped with this scope.
    const artifact =
      clips.length === 1
        ? {
            key: videoArtifactKey(projectId, jobId, 'mp4'),
            contentType: 'video/mp4',
            filename: `${title}.mp4`,
            buffer: clips[0]!.buffer,
          }
        : {
            key: videoArtifactKey(projectId, jobId, 'zip'),
            contentType: 'application/zip',
            filename: `${title}-video.zip`,
            buffer: await zipBuffer(clips.map((c) => ({ name: c.name, buffer: c.buffer }))),
          };
    await storage.save(artifact.key, artifact.buffer, { contentType: artifact.contentType });

    const finished = await VideoJobModel.updateOne(
      { _id: jobId, state: { $in: [...VIDEO_JOB_ACTIVE_STATES] } },
      {
        $set: {
          state: 'done',
          percent: 100,
          artifact: { key: artifact.key, contentType: artifact.contentType, filename: artifact.filename },
        },
      },
    );
    // Cancelled between persist and this write — the artifact must not outlive the job.
    if (finished.modifiedCount === 0) await storage.remove(artifact.key).catch(() => {});
  } catch (err) {
    if (err instanceof VideoExportCancelled) {
      // Cancelled jobs leave no partial artifact behind.
      await Promise.all([
        storage.remove(videoArtifactKey(projectId, jobId, 'mp4')).catch(() => {}),
        storage.remove(videoArtifactKey(projectId, jobId, 'zip')).catch(() => {}),
      ]);
      await VideoJobModel.updateOne({ _id: jobId }, { $set: { state: 'cancelled' } }).catch(
        () => {},
      );
      return;
    }
    await VideoJobModel.updateOne(
      { _id: jobId, state: { $in: [...VIDEO_JOB_ACTIVE_STATES] } },
      {
        $set: {
          state: 'error',
          error: `${publicErrMessage(err, 'render error')}. Is the web server running?`,
        },
      },
    ).catch(() => {});
    console.error('[video] export failed:', err);
  }
}

/**
 * Boot recovery: a Puppeteer render cannot survive a restart, so any job still
 * marked active is honestly failed. Finished artifacts are untouched and stay
 * downloadable until the sweep. Returns how many jobs were failed.
 */
export async function failInterruptedVideoJobs(): Promise<number> {
  const res = await VideoJobModel.updateMany(
    { state: { $in: [...VIDEO_JOB_ACTIVE_STATES] } },
    { $set: { state: 'error', error: 'Interrupted by restart' } },
  );
  return res.modifiedCount ?? 0;
}

/**
 * Drop jobs untouched for ~24h — artifact first, then the doc — mirroring the
 * old Map sweep (called opportunistically when a new export starts). A Mongo
 * TTL index would delete the doc but strand the stored file, hence the sweep.
 */
export async function sweepExpiredVideoJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - VIDEO_JOB_TTL_MS);
  const stale = (await VideoJobModel.find({ updatedAt: { $lt: cutoff } })
    .select('artifact')
    .lean()) as Array<{ _id: unknown; artifact?: { key?: string } }>;
  if (!stale.length) return;
  const storage = getStorage();
  for (const job of stale) {
    if (job.artifact?.key) await storage.remove(job.artifact.key).catch(() => {});
    await VideoJobModel.deleteOne({ _id: job._id });
  }
}

/** Zip named buffers in memory (transient — persisted then dropped). */
function zipBuffer(entries: Array<{ name: string; buffer: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) archive.append(entry.buffer, { name: entry.name });
    void archive.finalize();
  });
}
