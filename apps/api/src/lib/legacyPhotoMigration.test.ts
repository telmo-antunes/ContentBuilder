/**
 * The one-time legacy-photo migration, against a real (in-memory) Mongo.
 * Legacy documents are written straight through the driver — the Mongoose
 * schema no longer knows `mediaAssetId`, which is precisely the shape of data
 * this migration exists to clean up.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProjectModel, ProjectVersionModel } from '../models';
import { runLegacyPhotoMigration } from './legacyPhotoMigration';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

const oid = () => new mongoose.Types.ObjectId();
const silent = { log: () => {} };

/** Insert a project through the raw driver so legacy fields survive. */
async function insertLegacyProject(slides: Record<string, unknown>[]) {
  const { insertedId } = await ProjectModel.collection.insertOne({
    businessId: oid(),
    title: 'Legacy',
    type: 'carousel',
    format: '1080x1080',
    slides,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  return insertedId;
}

async function readSlides(id: unknown): Promise<Record<string, any>[]> {
  const doc = await ProjectModel.collection.findOne({ _id: id as never });
  return (doc?.slides ?? []) as Record<string, any>[];
}

/** Indexed read that fails loudly rather than handing back `undefined`. */
function at(slides: Record<string, any>[], i: number): Record<string, any> {
  const slide = slides[i];
  if (!slide) throw new Error(`expected a slide at index ${i}`);
  return slide;
}

async function readSlide(id: unknown, i = 0): Promise<Record<string, any>> {
  return at(await readSlides(id), i);
}

describe('legacy slide photo migration', () => {
  it('folds a legacy mediaAssetId into photos[] as a background', async () => {
    const asset = oid();
    const id = await insertLegacyProject([{ id: 's1', order: 0, mediaAssetId: asset, photos: [] }]);

    const stats = await runLegacyPhotoMigration(silent);
    expect(stats.projects.slidesMigrated).toBe(1);

    const slide = await readSlide(id);
    expect(slide.mediaAssetId).toBeUndefined();
    expect(slide.photos).toHaveLength(1);
    expect(slide.photos[0]).toMatchObject({ placement: 'background', fit: 'cover' });
    expect(String(slide.photos[0].mediaAssetId)).toBe(String(asset));
    expect(typeof slide.photos[0].id).toBe('string');
  });

  it('handles a slide whose photos array is missing entirely', async () => {
    const asset = oid();
    const id = await insertLegacyProject([{ id: 's1', order: 0, mediaAssetId: asset }]);
    await runLegacyPhotoMigration(silent);
    const slide = await readSlide(id);
    expect(slide.photos).toHaveLength(1);
    expect(slide.photos[0].placement).toBe('background');
  });

  it('preserves existing slot/free photos and their order', async () => {
    const id = await insertLegacyProject([
      {
        id: 's1',
        order: 0,
        mediaAssetId: oid(),
        photos: [
          { id: 'a', mediaAssetId: oid(), placement: 'slot', slot: 'hero' },
          { id: 'b', mediaAssetId: oid(), placement: 'free', frame: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        ],
      },
    ]);
    await runLegacyPhotoMigration(silent);
    const slide = await readSlide(id);
    expect(slide.photos.map((p: any) => p.id).slice(0, 2)).toEqual(['a', 'b']);
    expect(slide.photos).toHaveLength(3);
    expect(slide.photos[2].placement).toBe('background');
  });

  it('drops the legacy id when the slide already has a background photo', async () => {
    const kept = oid();
    const id = await insertLegacyProject([
      {
        id: 's1',
        order: 0,
        mediaAssetId: oid(),
        photos: [{ id: 'bg', mediaAssetId: kept, placement: 'background', fit: 'cover' }],
      },
    ]);

    const stats = await runLegacyPhotoMigration(silent);
    expect(stats.projects.slidesAlreadyBackground).toBe(1);
    expect(stats.projects.slidesMigrated).toBe(0);

    const slide = await readSlide(id);
    expect(slide.mediaAssetId).toBeUndefined();
    expect(slide.photos).toHaveLength(1);
    expect(String(slide.photos[0].mediaAssetId)).toBe(String(kept));
  });

  it('drops a legacy id that is not a usable asset reference', async () => {
    const id = await insertLegacyProject([{ id: 's1', order: 0, mediaAssetId: null, photos: [] }]);
    const stats = await runLegacyPhotoMigration(silent);
    expect(stats.projects.slidesDroppedInvalid).toBe(1);
    const slide = await readSlide(id);
    expect(slide.mediaAssetId).toBeUndefined();
    expect(slide.photos).toHaveLength(0);
  });

  it('is idempotent — a second run reports and changes nothing', async () => {
    const id = await insertLegacyProject([
      { id: 's1', order: 0, mediaAssetId: oid(), photos: [] },
      { id: 's2', order: 1, photos: [] },
    ]);
    await runLegacyPhotoMigration(silent);
    const afterFirst = await readSlides(id);

    const second = await runLegacyPhotoMigration(silent);
    expect(second.projects.changed).toBe(0);
    expect(second.projects.slidesMigrated).toBe(0);
    expect(second.projects.slidesAlreadyBackground).toBe(0);
    expect(second.versions.changed).toBe(0);
    expect(await readSlides(id)).toEqual(afterFirst);
  });

  it('migrates version snapshots so a restore keeps its photo', async () => {
    const asset = oid();
    const { insertedId } = await ProjectVersionModel.collection.insertOne({
      projectId: oid(),
      label: 'legacy',
      slides: [
        { id: 's1', order: 0, mediaAssetId: asset, photos: [] },
        { id: 's2', order: 1, mediaAssetId: oid(), photos: [{ id: 'bg', mediaAssetId: oid(), placement: 'background' }] },
      ],
      createdAt: new Date(),
    } as never);

    const stats = await runLegacyPhotoMigration(silent);
    expect(stats.versions.slidesMigrated).toBe(1);
    expect(stats.versions.slidesAlreadyBackground).toBe(1);

    const doc = await ProjectVersionModel.collection.findOne({ _id: insertedId });
    const slides = (doc?.slides ?? []) as Record<string, any>[];
    expect(at(slides, 0).mediaAssetId).toBeUndefined();
    expect(String(at(slides, 0).photos[0].mediaAssetId)).toBe(String(asset));
    expect(at(slides, 0).photos[0].placement).toBe('background');
    expect(at(slides, 1).mediaAssetId).toBeUndefined();
    expect(at(slides, 1).photos).toHaveLength(1);
  });

  it('--dry-run reports the same work without writing', async () => {
    const id = await insertLegacyProject([{ id: 's1', order: 0, mediaAssetId: oid(), photos: [] }]);
    const dry = await runLegacyPhotoMigration({ ...silent, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.projects.changed).toBe(1);
    expect(dry.projects.slidesMigrated).toBe(1);

    const slide = await readSlide(id);
    expect(slide.mediaAssetId).toBeTruthy();
    expect(slide.photos).toHaveLength(0);

    // …and the real run still finds it.
    const wet = await runLegacyPhotoMigration(silent);
    expect(wet.projects.slidesMigrated).toBe(1);
  });
});
