/**
 * Route-level integration tests: real Express app + real (in-memory) Mongo,
 * with every AI / Puppeteer boundary mocked. These cover the orchestration the
 * unit tests can't: validation → normalization → persistence → response, the
 * foreign-media scrub, the SSRF guard, and the rate limiter.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// The AI-gated routes check aiDraftConfigured() BEFORE reaching our mocks, and
// config reads the env at import time — so stub the env before any import runs
// (CI has no real key; the boundaries themselves are mocked below).
const { renderVideoMock, authorRecipeMock } = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_MODEL = 'claude-test';
  process.env.ANTHROPIC_MODEL_SMALL = 'claude-test';
  process.env.ANTHROPIC_MODEL_FREE = 'claude-test'; // else a local .env value leaks in
  delete process.env.APP_PASSWORD; // auth must be off for these tests
  // Video-export tests persist artifacts through the StorageProvider — keep
  // those writes out of the repo's real ./storage dir.
  process.env.STORAGE_DIR = `${process.env.TMPDIR ?? '/tmp'}/contentbuilder-test-storage`;
  return { renderVideoMock: vi.fn(), authorRecipeMock: vi.fn() };
});

// ── Mock the AI boundaries the surviving routes touch ─────────────────────────
vi.mock('../lib/caption', () => ({
  generateCaption: vi.fn(async () => ({ text: 'Mock caption', hashtags: ['#mock'] })),
}));
// Puppeteer boundary: keep the real module (VideoExportCancelled identity
// matters to the job runner) but stub the render itself.
vi.mock('../lib/videoExporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/videoExporter')>();
  return { ...actual, renderSlidesToVideo: renderVideoMock };
});
// Recipe authoring boundary (the brandkits candidate/select routes drive it).
vi.mock('../lib/htmlDirector/authorRecipe', () => ({
  authorRecipe: authorRecipeMock,
}));

import { createApp } from '../app';
import { modelFor } from '../lib/ai';
import { VideoExportCancelled, type IsCancelled } from '../lib/videoExporter';
import { failInterruptedVideoJobs } from '../lib/videoJobs';
import { BusinessModel, BrandKitModel, MediaAssetModel, ProjectVersionModel, SettingModel, VideoJobModel } from '../models';

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
          { authored: { html: '<h1 class="headline">A</h1>' } },
          { authored: { html: '<h1 class="headline">B</h1>' } },
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
      .send({ slides: [{ authored: { html: '<h1 class="headline">ORIGINAL</h1>' } }] });

    const saved = await request(app()).post(`/projects/${pid}/versions`).send({ label: 'checkpoint' });
    expect(saved.status).toBe(201);

    await request(app())
      .patch(`/projects/${pid}`)
      .send({ slides: [{ authored: { html: '<h1 class="headline">CHANGED</h1>' } }] });

    const list = await request(app()).get(`/projects/${pid}/versions`);
    const checkpoint = list.body.versions.find((v: any) => v.label === 'checkpoint');
    expect(checkpoint).toBeTruthy();

    const restored = await request(app()).post(`/projects/${pid}/versions/${checkpoint._id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.slides[0].authored.html).toContain('ORIGINAL');

    // The pre-restore state must itself be recoverable.
    const after = await request(app()).get(`/projects/${pid}/versions`);
    expect(after.body.versions[0].label).toBe('Before restore');
  });

  it('restores a BLOCK-ERA snapshot without crashing (legacy fields stripped)', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'L', type: 'carousel', format: '1080x1080' });
    const pid = created.body._id;

    // A snapshot written before the authored pivot: layoutType/blocks and
    // legacy overrides ride along in the Mixed slides array.
    await ProjectVersionModel.create({
      projectId: pid,
      label: 'legacy',
      slides: [
        {
          id: 'old-1',
          order: 0,
          layoutType: 'SplitImageText',
          blocks: [{ type: 'title', text: 'Old copy' }],
          imageNeed: 'none',
          overrides: { theme: 'bold', split: 'image-left', imageZoom: 2 },
          authored: { html: '<h1 class="headline">Survives</h1>' },
        },
      ],
    });
    const list = await request(app()).get(`/projects/${pid}/versions`);
    const legacy = list.body.versions.find((v: any) => v.label === 'legacy');
    const restored = await request(app()).post(`/projects/${pid}/versions/${legacy._id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.slides).toHaveLength(1);
    expect(restored.body.slides[0].authored.html).toContain('Survives');
    expect(restored.body.slides[0].layoutType).toBeUndefined();
    expect(restored.body.slides[0].blocks).toBeUndefined();
    expect(restored.body.slides[0].overrides?.theme).toBe('bold');
    expect(restored.body.slides[0].overrides?.split).toBeUndefined();
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
            imageNeed: 'upload',
            mediaAssetId: String(foreign._id), // not ours — must be stripped
          },
          {
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

// ── Recipe candidates ─────────────────────────────────────────────────────────
describe('recipe candidates', () => {
  beforeEach(() => {
    authorRecipeMock.mockReset();
  });

  /** A minimal recipe that passes brandRecipeSchema (distinct by signature name —
   *  select re-points colours/fonts at the kit, so tokens can't distinguish takes). */
  function fakeRecipe(signatureName: string) {
    return {
      version: 2,
      tokens: {
        ground: '#0B0F1A',
        ink: '#F8FAFC',
        accent: '#F5C044',
        displayFamily: 'Inter',
        bodyFamily: 'Inter',
        radius: 16,
      },
      signature: { name: signatureName, description: 'A recurring move' },
      stylesheet: '.cb-slide .headline { font-size: 100px; }',
      components: [],
    };
  }

  /** Seed a kit and author `count` candidates through the route. */
  async function seedAndAuthor(count?: number) {
    const biz = await seedBusiness();
    const kit = await seedApprovedKit(String(biz._id));
    let n = 0;
    authorRecipeMock.mockImplementation(async () => fakeRecipe(`Take ${++n}`));
    const res = await request(app())
      .post(`/brandkits/${kit._id}/recipe/candidates`)
      .send(count ? { count } : {});
    return { kit, res };
  }

  it('authors candidates concurrently with distinct direction notes and stores them', async () => {
    const { kit, res } = await seedAndAuthor();
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(2);

    const notes = res.body.candidates.map((c: any) => c.note);
    expect(new Set(notes).size).toBe(2);
    for (const c of res.body.candidates) {
      expect(c.id).toBeTruthy();
      expect(c.recipe?.signature?.name).toMatch(/^Take /);
    }

    // Each author call carried a distinct direction nudge, and never the
    // (per-spec too slow) render-verify pass.
    expect(authorRecipeMock).toHaveBeenCalledTimes(2);
    const opts = authorRecipeMock.mock.calls.map((call: any[]) => call[1]);
    expect(new Set(opts.map((o: any) => o?.direction)).size).toBe(2);
    for (const o of opts) expect(o?.verify).toBeFalsy();

    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipeCandidates).toHaveLength(2);
  });

  it('caps the run at three candidates', async () => {
    const { res } = await seedAndAuthor(3);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(3);
    const bad = await request(app())
      .post(`/brandkits/${String(new mongoose.Types.ObjectId())}/recipe/candidates`)
      .send({ count: 4 });
    expect(bad.status).toBe(400); // validation runs before the kit lookup
  });

  it('select promotes the chosen candidate to kit.recipe and clears the list', async () => {
    const { kit, res } = await seedAndAuthor(3);
    const chosen = res.body.candidates[1];

    const sel = await request(app())
      .post(`/brandkits/${kit._id}/recipe/select`)
      .send({ candidateId: chosen.id });
    expect(sel.status).toBe(200);
    expect(sel.body.recipe?.signature?.name).toBe(chosen.recipe.signature.name);

    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipe?.signature?.name).toBe(chosen.recipe.signature.name);
    // Kit colours/fonts stay the single truth: the promoted recipe was re-pointed.
    expect(fresh?.recipe?.tokens?.ground).toBe('#0B0F1A');
    expect(fresh?.recipe?.tokens?.displayFamily).toBe('Inter');
    expect(fresh?.recipeCandidates ?? []).toHaveLength(0);
  });

  it('404s a select with a bogus candidateId', async () => {
    const { kit } = await seedAndAuthor();
    const sel = await request(app())
      .post(`/brandkits/${kit._id}/recipe/select`)
      .send({ candidateId: 'not-a-real-candidate' });
    expect(sel.status).toBe(404);
    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipe).toBeFalsy(); // nothing was promoted
    expect(fresh?.recipeCandidates).toHaveLength(2); // and nothing was cleared
  });

  it('degrades gracefully when one candidate fails, 502s when all fail', async () => {
    const biz = await seedBusiness();
    const kit = await seedApprovedKit(String(biz._id));

    // One of two fails → the survivor is still stored and returned.
    let n = 0;
    authorRecipeMock.mockImplementation(async () => {
      if (++n === 1) throw new Error('model exploded');
      return fakeRecipe('Survivor');
    });
    const partial = await request(app()).post(`/brandkits/${kit._id}/recipe/candidates`).send({});
    expect(partial.status).toBe(200);
    expect(partial.body.candidates).toHaveLength(1);
    expect(partial.body.candidates[0].recipe.signature.name).toBe('Survivor');

    // Every author fails → a 502 with the upstream reason, nothing persisted.
    authorRecipeMock.mockRejectedValue(new Error('model exploded'));
    const res = await request(app()).post(`/brandkits/${kit._id}/recipe/candidates`).send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/model exploded/);
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

// ── Video export jobs (durable, cancellable) ─────────────────────────────────
describe('video export jobs', () => {
  beforeEach(() => {
    renderVideoMock.mockReset();
  });

  /** A project whose every slide is AI-composed (the video-export precondition). */
  async function seedAuthoredProject() {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({
        businessId: String(biz._id),
        title: 'Vid',
        type: 'carousel',
        format: '1080x1080',
        slides: [
          {
            authored: { html: '<h1 class="headline">Hi</h1>' },
          },
        ],
      });
    expect(created.status).toBe(201);
    return created.body;
  }

  async function until(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) throw new Error('condition never became true');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('create job → poll → cancel → state cancelled', async () => {
    // A render that never finishes on its own — only a cancel can end it.
    let renderEnded = false;
    renderVideoMock.mockImplementation(
      async (_project: unknown, _onProgress: unknown, isCancelled: IsCancelled) => {
        try {
          for (let i = 0; i < 400; i++) {
            await new Promise((r) => setTimeout(r, 25));
            if (await isCancelled()) throw new VideoExportCancelled();
          }
          throw new Error('render was never cancelled');
        } finally {
          renderEnded = true;
        }
      },
    );

    const project = await seedAuthoredProject();
    const started = await request(app()).post(`/projects/${project._id}/export-video`);
    expect(started.status).toBe(202);
    const jobId = started.body.jobId as string;
    expect(jobId).toBeTruthy();

    const poll = await request(app()).get(`/projects/${project._id}/export-video/${jobId}`);
    expect(poll.status).toBe(200);
    expect(['queued', 'rendering']).toContain(poll.body.state);
    expect(typeof poll.body.percent).toBe('number');

    // Wait until the runner has claimed the job — cancelling a still-queued job
    // is also correct, but then the mock render never runs and can't be awaited.
    await until(() => renderVideoMock.mock.calls.length > 0);

    const cancel = await request(app()).post(
      `/projects/${project._id}/export-video/${jobId}/cancel`,
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.state).toBe('cancelled');

    // The running render notices the durable flag and aborts; the job STAYS
    // cancelled (the runner must not overwrite it with done/error).
    await until(() => renderEnded);
    const after = await request(app()).get(`/projects/${project._id}/export-video/${jobId}`);
    expect(after.status).toBe(200);
    expect(after.body.state).toBe('cancelled');
    expect((await VideoJobModel.findById(jobId))?.get('state')).toBe('cancelled');

    // Cancelling again is a harmless no-op.
    const again = await request(app()).post(
      `/projects/${project._id}/export-video/${jobId}/cancel`,
    );
    expect(again.status).toBe(200);
    expect(again.body.state).toBe('cancelled');
  }, 20_000);

  it('persists the artifact and serves the download from the same poll URL', async () => {
    renderVideoMock.mockResolvedValue([
      { name: '01.mp4', buffer: Buffer.from('mp4-bytes'), key: 'renders/x/01.mp4', url: 'http://x/01.mp4', frames: 10 },
    ]);

    const project = await seedAuthoredProject();
    const started = await request(app()).post(`/projects/${project._id}/export-video`);
    expect(started.status).toBe(202);
    const jobId = started.body.jobId as string;

    let downloadHeaders: Record<string, string> | null = null;
    for (let i = 0; i < 100; i++) {
      const res = await request(app()).get(`/projects/${project._id}/export-video/${jobId}`);
      expect(res.status).toBe(200);
      if ((res.headers['content-type'] ?? '').startsWith('video/mp4')) {
        downloadHeaders = res.headers as Record<string, string>;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(downloadHeaders).toBeTruthy();
    expect(downloadHeaders!['content-disposition']).toContain('vid.mp4');

    // The finished bytes live in the StorageProvider, not on the job doc.
    const doc = await VideoJobModel.findById(jobId);
    expect(doc?.get('state')).toBe('done');
    expect(doc?.get('artifact')?.key).toBe(`video-exports/${project._id}/${jobId}.mp4`);
  }, 20_000);
});

// ── Video job restart recovery ────────────────────────────────────────────────
describe('failInterruptedVideoJobs', () => {
  it('fails every non-terminal job on boot and leaves finished ones alone', async () => {
    const projectId = new mongoose.Types.ObjectId();
    const mk = (state: string, extra: Record<string, unknown> = {}) =>
      VideoJobModel.create({ projectId, state, percent: 40, title: 'x', ...extra });
    const [queued, rendering, encoding, done, cancelled] = await Promise.all([
      mk('queued'),
      mk('rendering'),
      mk('encoding'),
      mk('done', {
        artifact: { key: 'video-exports/x/y.mp4', contentType: 'video/mp4', filename: 'x.mp4' },
      }),
      mk('cancelled'),
    ]);

    expect(await failInterruptedVideoJobs()).toBe(3);

    for (const job of [queued, rendering, encoding]) {
      const doc = await VideoJobModel.findById(job!._id);
      expect(doc?.get('state')).toBe('error');
      expect(doc?.get('error')).toBe('Interrupted by restart');
    }
    expect((await VideoJobModel.findById(done!._id))?.get('state')).toBe('done');
    expect((await VideoJobModel.findById(cancelled!._id))?.get('state')).toBe('cancelled');
  });
});
