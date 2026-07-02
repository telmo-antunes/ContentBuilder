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

// ── Mock every expensive boundary ─────────────────────────────────────────────
vi.mock('../lib/draft', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    draftSlidesFromParagraph: vi.fn(async () => [
      {
        layoutType: 'TextOnly',
        blocks: [{ type: 'title', text: 'Mock title' }],
        imageNeed: 'none' as const,
      },
    ]),
  };
});
vi.mock('../lib/critique', () => ({
  critiqueProject: vi.fn(async () => []),
}));
vi.mock('../lib/caption', () => ({
  generateCaption: vi.fn(async () => ({ text: 'Mock caption', hashtags: ['#mock'] })),
}));
vi.mock('../lib/campaign', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    planCampaign: vi.fn(async (ctx: { count: number }) =>
      Array.from({ length: ctx.count }, (_, i) => ({
        id: `concept-${i}`,
        title: `Concept ${i}`,
        angle: 'angle',
        paragraph: 'Some real copy to lay out.',
      })),
    ),
  };
});
vi.mock('../lib/backgrounds', () => ({
  generateBusinessBackgrounds: vi.fn(async () => []),
}));

import { createApp } from '../app';
import { BusinessModel, BrandKitModel, MediaAssetModel, ProjectModel } from '../models';

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

  it('drafts via the mocked engine and attaches the mocked caption', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1080' });
    const res = await request(app())
      .post(`/projects/${created.body._id}/draft`)
      .send({ paragraph: 'Hello world', mode: 'designer' });
    expect(res.status).toBe(200);
    expect(res.body.slides).toHaveLength(1);
    expect(res.body.slides[0].blocks[0].text).toBe('Mock title');
    expect(res.body.caption?.text).toBe('Mock caption');
  });
});

// ── Campaigns ─────────────────────────────────────────────────────────────────
describe('campaigns', () => {
  it('plans concepts, drafts one on demand, and is idempotent on redraft', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));

    const campaign = await request(app())
      .post(`/businesses/${biz._id}/campaigns`)
      .send({ brief: 'A series', count: 3, type: 'carousel', format: '1080x1080' });
    expect(campaign.status).toBe(201);
    expect(campaign.body.concepts).toHaveLength(3);

    const conceptId = campaign.body.concepts[0].id;
    const first = await request(app()).post(
      `/campaigns/${campaign.body._id}/concepts/${conceptId}/draft`,
    );
    expect(first.status).toBe(201);
    expect(first.body.campaignId).toBe(String(campaign.body._id));

    // Second call must return the SAME project, not draft a duplicate.
    const second = await request(app()).post(
      `/campaigns/${campaign.body._id}/concepts/${conceptId}/draft`,
    );
    expect(second.status).toBe(200);
    expect(second.body._id).toBe(first.body._id);
    expect(await ProjectModel.countDocuments()).toBe(1);
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
