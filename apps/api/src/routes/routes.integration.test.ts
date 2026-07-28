/**
 * Route-level integration tests: real Express app + real (in-memory) Mongo,
 * with every AI / Puppeteer boundary mocked. These cover the orchestration the
 * unit tests can't: validation → normalization → persistence → response, the
 * foreign-media scrub, campaign draft idempotency, the SSRF guard, and the
 * rate limiter.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// The AI-gated routes check aiDraftConfigured() BEFORE reaching our mocks, and
// config reads the env at import time — so stub the env before any import runs
// (CI has no real key; the boundaries themselves are mocked below).
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_MODEL = 'claude-test';
  process.env.ANTHROPIC_MODEL_SMALL = 'claude-test';
  process.env.ANTHROPIC_MODEL_FREE = 'claude-test'; // else a local .env value leaks in
  delete process.env.APP_PASSWORD; // auth must be off for these tests
});

// ── Mock the AI boundaries the surviving routes touch ─────────────────────────
vi.mock('../lib/caption', () => ({
  generateCaption: vi.fn(async () => ({ text: 'Mock caption', hashtags: ['#mock'] })),
}));

import { createApp } from '../app';
import { modelFor } from '../lib/ai';
import { BusinessModel, BrandKitModel, MediaAssetModel, SettingModel } from '../models';

let mongod: MongoMemoryServer;
const app = () => createApp();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
});

// Seed helpers ---------------------------------------------------------------
async function seedBusiness(overrides: Record<string, unknown> = {}) {
  return BusinessModel.create({
    name: 'Test Biz',
    websiteUrl: 'https://example.com',
    profile: { category: 'saas-product', tone: ['Professional'] },
    ...overrides,
  });
}

async function seedApprovedKit(businessId: string) {
  return BrandKitModel.create({
    businessId,
    colors: {
      primary: '#112233',
      secondary: '#223344',
      accent: '#334455',
      background: '#0B0F1A',
      text: '#F8FAFC',
      palette: [],
    },
    fonts: { detected: { heading: '', body: '' }, render: { heading: 'Inter', body: 'Inter' } },
    status: 'approved',
  });
}

// ── Businesses ────────────────────────────────────────────────────────────────
describe('businesses', () => {
  it('creates and lists businesses', async () => {
    const created = await request(app()).post('/businesses').send({ name: 'Acme' });
    expect(created.status).toBe(201);
    const list = await request(app()).get('/businesses');
    expect(list.status).toBe(200);
    expect(list.body.map((b: any) => b.name)).toContain('Acme');
  });

  it('rejects an analyze against a private URL (SSRF guard)', async () => {
    const biz = await seedBusiness({ websiteUrl: 'http://localhost:9999' });
    const res = await request(app()).post(`/businesses/${biz._id}/analyze`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private host/i);
  });
});

// ── Projects ──────────────────────────────────────────────────────────────────
describe('projects', () => {
  it('refuses creation without an approved brand kit', async () => {
    const biz = await seedBusiness();
    const res = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1080' });
    expect(res.status).toBe(400);
  });

  it('creates, normalizes slide ids/order, and persists a PATCH', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1080' });
    expect(created.status).toBe(201);

    const patched = await request(app())
      .patch(`/projects/${created.body._id}`)
      .send({
        slides: [
          { layoutType: 'TextOnly', blocks: [{ type: 'title', text: 'A' }], imageNeed: 'none' },
          { layoutType: 'TextOnly', blocks: [{ type: 'title', text: 'B' }], imageNeed: 'none' },
        ],
      });
    expect(patched.status).toBe(200);
    expect(patched.body.slides).toHaveLength(2);
    expect(patched.body.slides[0].id).toBeTruthy();
    expect(patched.body.slides.map((s: any) => s.order)).toEqual([0, 1]);
  });

  it('version history: snapshot, restore, and the safety re-snapshot', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'V', type: 'carousel', format: '1080x1080' });
    const pid = created.body._id;
    await request(app())
      .patch(`/projects/${pid}`)
      .send({ slides: [{ layoutType: 'TextOnly', blocks: [{ type: 'title', text: 'ORIGINAL' }], imageNeed: 'none' }] });

    const saved = await request(app()).post(`/projects/${pid}/versions`).send({ label: 'checkpoint' });
    expect(saved.status).toBe(201);

    await request(app())
      .patch(`/projects/${pid}`)
      .send({ slides: [{ layoutType: 'TextOnly', blocks: [{ type: 'title', text: 'CHANGED' }], imageNeed: 'none' }] });

    const list = await request(app()).get(`/projects/${pid}/versions`);
    const checkpoint = list.body.versions.find((v: any) => v.label === 'checkpoint');
    expect(checkpoint).toBeTruthy();

    const restored = await request(app()).post(`/projects/${pid}/versions/${checkpoint._id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.slides[0].blocks[0].text).toBe('ORIGINAL');

    // The pre-restore state must itself be recoverable.
    const after = await request(app()).get(`/projects/${pid}/versions`);
    expect(after.body.versions[0].label).toBe('Before restore');
  });

  it("scrubs media references that belong to ANOTHER business", async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const otherBiz = await seedBusiness({ name: 'Other' });
    const foreign = await MediaAssetModel.create({
      businessId: otherBiz._id,
      type: 'upload',
      key: 'x.png',
      url: 'http://x/x.png',
      width: 10,
      height: 10,
    });
    const mine = await MediaAssetModel.create({
      businessId: biz._id,
      type: 'upload',
      key: 'y.png',
      url: 'http://x/y.png',
      width: 10,
      height: 10,
    });

    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1080' });
    const res = await request(app())
      .patch(`/projects/${created.body._id}`)
      .send({
        slides: [
          {
            layoutType: 'BackgroundImage',
            blocks: [{ type: 'title', text: 'A' }],
            imageNeed: 'upload',
            mediaAssetId: String(foreign._id), // not ours — must be stripped
          },
          {
            layoutType: 'BackgroundImage',
            blocks: [{ type: 'title', text: 'B' }],
            imageNeed: 'upload',
            mediaAssetId: String(mine._id), // ours — must survive
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.slides[0].mediaAssetId ?? null).toBeNull();
    expect(String(res.body.slides[1].mediaAssetId)).toBe(String(mine._id));
  });

});

// ── A slide's photos ──────────────────────────────────────────────────────────
describe('PUT /projects/:id/slides/:slideId/photos', () => {
  /** A project with one authored slide declaring a single "hero" image slot. */
  async function seedSlideWithSlot() {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({
        businessId: String(biz._id),
        title: 'P',
        type: 'carousel',
        format: '1080x1080',
        slides: [
          {
            layoutType: 'TextOnly',
            blocks: [],
            imageNeed: 'none',
            authored: { html: '<h1 class="headline">Hi</h1><figure class="cb-shot" data-cb-slot="hero"></figure>' },
          },
        ],
      });
    expect(created.status).toBe(201);
    const asset = await MediaAssetModel.create({
      businessId: biz._id,
      type: 'upload',
      key: 'a.png',
      url: 'http://x/a.png',
      width: 10,
      height: 10,
    });
    return { biz, project: created.body, slideId: created.body.slides[0].id, asset };
  }

  it('fills a slot the slide actually declares', async () => {
    const { project, slideId, asset } = await seedSlideWithSlot();
    const res = await request(app())
      .put(`/projects/${project._id}/slides/${slideId}/photos`)
      .send({
        photos: [
          { id: 'p1', mediaAssetId: String(asset._id), placement: 'slot', slot: 'hero', fit: 'cover' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.slides[0].photos).toHaveLength(1);
    expect(res.body.slides[0].photos[0].slot).toBe('hero');
  });

  it('refuses a slot the markup never declared', async () => {
    const { project, slideId, asset } = await seedSlideWithSlot();
    // Otherwise the photo is stored and silently never renders.
    const res = await request(app())
      .put(`/projects/${project._id}/slides/${slideId}/photos`)
      .send({
        photos: [{ id: 'p1', mediaAssetId: String(asset._id), placement: 'slot', slot: 'nope' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no image slot named/i);
  });

  it('keeps only ONE background when several are sent', async () => {
    const { biz, project, slideId, asset } = await seedSlideWithSlot();
    const second = await MediaAssetModel.create({
      businessId: biz._id,
      type: 'upload',
      key: 'b.png',
      url: 'http://x/b.png',
      width: 10,
      height: 10,
    });
    const res = await request(app())
      .put(`/projects/${project._id}/slides/${slideId}/photos`)
      .send({
        photos: [
          { id: 'p1', mediaAssetId: String(asset._id), placement: 'background' },
          { id: 'p2', mediaAssetId: String(second._id), placement: 'background' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.slides[0].photos.filter((p: { placement: string }) => p.placement === 'background')).toHaveLength(1);
  });

  it('drops a photo belonging to another business', async () => {
    const { project, slideId, asset } = await seedSlideWithSlot();
    const otherBiz = await seedBusiness({ name: 'Other' });
    const foreign = await MediaAssetModel.create({
      businessId: otherBiz._id,
      type: 'upload',
      key: 'f.png',
      url: 'http://x/f.png',
      width: 10,
      height: 10,
    });
    const res = await request(app())
      .put(`/projects/${project._id}/slides/${slideId}/photos`)
      .send({
        photos: [
          { id: 'p1', mediaAssetId: String(foreign._id), placement: 'background' },
          { id: 'p2', mediaAssetId: String(asset._id), placement: 'slot', slot: 'hero' },
        ],
      });
    expect(res.status).toBe(200);
    const kept = res.body.slides[0].photos;
    expect(kept).toHaveLength(1);
    expect(String(kept[0].mediaAssetId)).toBe(String(asset._id));
  });

  it('gives a free overlay a frame when one is missing', async () => {
    const { project, slideId, asset } = await seedSlideWithSlot();
    const res = await request(app())
      .put(`/projects/${project._id}/slides/${slideId}/photos`)
      .send({ photos: [{ id: 'p1', mediaAssetId: String(asset._id), placement: 'free' }] });
    expect(res.status).toBe(200);
    expect(res.body.slides[0].photos[0].frame).toBeTruthy();
  });

  it('404s for a slide that is not on this project', async () => {
    const { project, asset } = await seedSlideWithSlot();
    const res = await request(app())
      .put(`/projects/${project._id}/slides/does-not-exist/photos`)
      .send({ photos: [{ id: 'p1', mediaAssetId: String(asset._id), placement: 'free' }] });
    expect(res.status).toBe(404);
  });
});

// ── Per-touchpoint model overrides ────────────────────────────────────────────
describe('modelFor', () => {
  it('falls back to the env tier when no override is stored', async () => {
    expect(await modelFor('caption')).toBe('claude-test'); // from the stubbed env
  });

  it('prefers the Settings override for its touchpoint only', async () => {
    await SettingModel.create({ key: 'ai', captionModel: 'claude-caption-override' });
    expect(await modelFor('caption')).toBe('claude-caption-override');
    expect(await modelFor('recipe')).toBe('claude-test'); // untouched touchpoint

    // Settings PUT persists the override fields too.
    const res = await request(app()).put('/settings').send({ visionModel: 'claude-vision-override' });
    expect(res.status).toBe(200);
    expect(await modelFor('vision')).toBe('claude-vision-override');
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('rate limiting', () => {
  it('429s expensive POSTs after the window budget', async () => {
    const shared = app(); // limiter state is per-app-instance
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(shared)
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1080' });

    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(shared)
        .post(`/projects/${created.body._id}/caption`)
        .send({});
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});
