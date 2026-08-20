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
import { solidPng } from '../lib/png';

// The AI-gated routes check aiDraftConfigured() BEFORE reaching our mocks, and
// config reads the env at import time — so stub the env before any import runs
// (CI has no real key; the boundaries themselves are mocked below).
const { renderVideoMock, authorRecipeMock, aiReplyMock } = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_MODEL = 'claude-test';
  process.env.ANTHROPIC_MODEL_SMALL = 'claude-test';
  process.env.ANTHROPIC_MODEL_FREE = 'claude-test'; // else a local .env value leaks in
  delete process.env.APP_PASSWORD; // auth must be off for these tests
  // Video-export tests persist artifacts through the StorageProvider — keep
  // those writes out of the repo's real ./storage dir.
  process.env.STORAGE_DIR = `${process.env.TMPDIR ?? '/tmp'}/contentbuilder-test-storage`;
  return {
    renderVideoMock: vi.fn(),
    authorRecipeMock: vi.fn(),
    aiReplyMock: vi.fn((_params: unknown): string => ''),
  };
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
// Recipe REFINE is mocked one level lower — at the SDK seam rather than at its
// own module — so the route, the layered/flat branch, the reply parsing and the
// deterministic gates all run for real against a scripted model reply. (Mocking
// lib/ai instead would have taken `modelFor`, which this file tests, with it.)
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: async (params: unknown) => ({ content: [{ type: 'text', text: aiReplyMock(params) }] }),
      stream: (params: unknown) => ({
        finalMessage: async () => ({ content: [{ type: 'text', text: aiReplyMock(params) }] }),
      }),
    };
  },
}));

import type { Server } from 'node:http';
import { createApp } from '../app';
import { modelFor } from '../lib/ai';
import { VideoExportCancelled, type IsCancelled } from '../lib/videoExporter';
import { failInterruptedVideoJobs } from '../lib/videoJobs';
import { BusinessModel, BrandKitModel, MediaAssetModel, ProjectModel, ProjectVersionModel, SettingModel, VideoJobModel } from '../models';

let mongod: MongoMemoryServer;
/**
 * ONE app for the file, not one per request.
 *
 * This used to be `() => createApp()`, which built a whole Express app for
 * every one of the file's sixty-odd requests and had supertest bind a fresh
 * ephemeral port to each. Seven different tests in this file have failed a
 * full-suite run with a 404 whose content-type was `text/html` — Express's own
 * finalhandler, which runs only when NO route matched — on routes that
 * demonstrably exist. "The request reached an app without the route on it" is
 * the shape of that failure, and sixty short-lived apps is the only structure
 * here that could produce it.
 *
 * The app holds no per-test state: `beforeEach` clears every collection, and
 * nothing else in `createApp` accumulates — EXCEPT the rate limiter, whose
 * `hits` map lives inside it. The rate-limiting test therefore builds its own
 * app, so its 31 deliberate requests cannot spend a budget the rest of the file
 * shares. Everything else here makes 9 rate-limited POSTs in total, well inside
 * the window of 30.
 */
const sharedApp = createApp();

/**
 * ONE LISTENING SERVER for the file, too.
 *
 * `request(app)` makes supertest call `app.listen(0)` and close it again for
 * EVERY request — sixty ephemeral ports opened and torn down per file, times
 * however many files vitest runs at once. Sharing the app removed the cost of
 * building sixty Express apps; it did not remove that churn, because supertest
 * binds per `request()` call whatever it is given.
 *
 * Handing it a server it does not own removes the churn as well: supertest uses
 * an already-listening server as-is. Whether the churn is what corrupts a
 * response is exactly what this measures.
 */
let server: Server;
const app = () => server;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = sharedApp.listen(0);
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
});

/**
 * Assert a response status, and say WHAT the server actually replied when it
 * does not match.
 *
 * This suite flakes: three different tests in this file have failed a full-suite
 * run and then passed on their own, and the only evidence a bare
 * `expect(res.status).toBe(200)` leaves behind is "expected 400 to be 200" —
 * which is exactly the information needed to diagnose it, minus the part that
 * would help. Twelve clean runs (serial, parallel, and under heavy concurrent
 * load) failed to reproduce it, so the next occurrence has to carry its own
 * evidence.
 */
function expectStatus(
  res: {
    status: number;
    body?: unknown;
    text?: string;
    headers?: Record<string, string>;
    request?: { method?: string; url?: string };
  },
  want: number,
): void {
  if (res.status === want) return;
  const detail = res.body && Object.keys(res.body as object).length
    ? JSON.stringify(res.body)
    : (res.text ?? '').slice(0, 400);
  /**
   * The first time this fired it returned a 404 with a COMPLETELY empty body —
   * which the app's own 404 never does (it sends `{error:'not found'}`) and
   * Express's default never does either (it sends "Cannot POST /path"). So the
   * request and the content-type are recorded too: they are what separates
   * "no route matched" from "a route matched and answered 404".
   */
  const where = `${res.request?.method ?? '?'} ${res.request?.url ?? '?'}`;
  const type = res.headers?.['content-type'] ?? 'no content-type';
  throw new Error(
    `expected status ${want}, got ${res.status} on ${where} [${type}] — server said: ${detail || '(empty body)'}`,
  );
}

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
    expectStatus(created, 201);
    const list = await request(app()).get('/businesses');
    expectStatus(list, 200);
    expect(list.body.map((b: any) => b.name)).toContain('Acme');
  });

  it('rejects an analyze against a private URL (SSRF guard)', async () => {
    const biz = await seedBusiness({ websiteUrl: 'http://localhost:9999' });
    const res = await request(app()).post(`/businesses/${biz._id}/analyze`);
    expectStatus(res, 400);
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
    expectStatus(res, 400);
  });

  it('creates, normalizes slide ids/order, and persists a PATCH', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1080' });
    expectStatus(created, 201);

    const patched = await request(app())
      .patch(`/projects/${created.body._id}`)
      .send({
        slides: [
          { authored: { html: '<h1 class="headline">A</h1>' } },
          { authored: { html: '<h1 class="headline">B</h1>' } },
        ],
      });
    expectStatus(patched, 200);
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
    expectStatus(saved, 201);

    await request(app())
      .patch(`/projects/${pid}`)
      .send({ slides: [{ authored: { html: '<h1 class="headline">CHANGED</h1>' } }] });

    const list = await request(app()).get(`/projects/${pid}/versions`);
    const checkpoint = list.body.versions.find((v: any) => v.label === 'checkpoint');
    expect(checkpoint).toBeTruthy();

    const restored = await request(app()).post(`/projects/${pid}/versions/${checkpoint._id}/restore`);
    expectStatus(restored, 200);
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
    expectStatus(restored, 200);
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
            // not ours — must be dropped
            photos: [{ id: 'p1', mediaAssetId: String(foreign._id), placement: 'background' }],
          },
          {
            imageNeed: 'upload',
            // ours — must survive
            photos: [{ id: 'p2', mediaAssetId: String(mine._id), placement: 'background' }],
          },
        ],
      });
    expectStatus(res, 200);
    expect(res.body.slides[0].photos).toHaveLength(0);
    expect(String(res.body.slides[1].photos[0].mediaAssetId)).toBe(String(mine._id));
  });

  /**
   * Read-tolerance for the RETIRED slide-level `mediaAssetId`. A document
   * written before `npm run migrate:photos` still carries the field; Mongoose
   * strict mode ignores it on read and zod strips it at the wire boundary, so
   * an unmigrated project must load and save normally — it simply shows no
   * photo (which is exactly why the migration has to run).
   */
  it('loads an UNMIGRATED slide (legacy mediaAssetId) without crashing', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const asset = await MediaAssetModel.create({
      businessId: biz._id,
      type: 'upload',
      key: 'legacy.png',
      url: 'http://x/legacy.png',
      width: 10,
      height: 10,
    });
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'Legacy', type: 'carousel', format: '1080x1080' });
    const pid = created.body._id;

    // Write the legacy field straight through the driver — the schema no
    // longer has a path for it, so a normal save could not produce this shape.
    await ProjectModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(pid) },
      {
        $set: {
          slides: [
            {
              id: 'legacy-1',
              order: 0,
              imageNeed: 'upload',
              mediaAssetId: asset._id,
              photos: [],
              authored: { html: '<h1 class="headline">Still here</h1>' },
            },
          ],
        },
      },
    );

    const read = await request(app()).get(`/projects/${pid}`);
    expectStatus(read, 200);
    expect(read.body.slides).toHaveLength(1);
    expect(read.body.slides[0].authored.html).toContain('Still here');
    // Crucially NOT resurrected as a photo — the back-compat rule is gone, so
    // the picture stays invisible until the migration folds it in.
    expect(read.body.slides[0].photos).toEqual([]);

    // …and it still saves. The retired field is dropped on the way in (zod) and
    // on the way out (Mongoose has no path for it), so the round trip retires it.
    const patched = await request(app())
      .patch(`/projects/${pid}`)
      .send({ slides: [{ ...read.body.slides[0], mediaAssetId: String(asset._id) }] });
    expectStatus(patched, 200);
    expect(patched.body.slides[0].mediaAssetId).toBeUndefined();
    expect(patched.body.slides[0].photos).toEqual([]);
    const stored = await ProjectModel.collection.findOne({ _id: new mongoose.Types.ObjectId(pid) });
    expect((stored?.slides as any[])[0].mediaAssetId).toBeUndefined();
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
    expectStatus(created, 201);
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
    expectStatus(res, 200);
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
    expectStatus(res, 400);
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
    expectStatus(res, 200);
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
    expectStatus(res, 200);
    const kept = res.body.slides[0].photos;
    expect(kept).toHaveLength(1);
    expect(String(kept[0].mediaAssetId)).toBe(String(asset._id));
  });

  it('gives a free overlay a frame when one is missing', async () => {
    const { project, slideId, asset } = await seedSlideWithSlot();
    const res = await request(app())
      .put(`/projects/${project._id}/slides/${slideId}/photos`)
      .send({ photos: [{ id: 'p1', mediaAssetId: String(asset._id), placement: 'free' }] });
    expectStatus(res, 200);
    expect(res.body.slides[0].photos[0].frame).toBeTruthy();
  });

  it('404s for a slide that is not on this project', async () => {
    const { project, asset } = await seedSlideWithSlot();
    const res = await request(app())
      .put(`/projects/${project._id}/slides/does-not-exist/photos`)
      .send({ photos: [{ id: 'p1', mediaAssetId: String(asset._id), placement: 'free' }] });
    expectStatus(res, 404);
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
    expectStatus(res, 200);
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

  /**
   * THE ARGUMENT THAT WAS NEVER PASSED.
   *
   * `authorRecipe` takes a `previous` so it can notice — and now carry — a role
   * fragment the re-author drops. Neither route supplied one, so the check was
   * unreachable and detailmasters lost its `statement` fragment in silence. The
   * defect was pure wiring, which is where this asserts.
   */
  it('hands the author the recipe each route is replacing', async () => {
    const biz = await seedBusiness();
    const kit = await seedApprovedKit(String(biz._id));
    const standing = fakeRecipe('Standing');
    await BrandKitModel.updateOne({ _id: kit._id }, { $set: { recipe: standing } });

    authorRecipeMock.mockImplementation(async () => fakeRecipe('Fresh'));
    expectStatus(await request(app()).post(`/brandkits/${kit._id}/recipe`), 200);
    expect(authorRecipeMock.mock.calls[0]?.[1]?.previous?.signature?.name).toBe('Standing');

    // A SECOND kit for the candidates half: the route above has already stored
    // its result on the first one, so 'Standing' is no longer what a run there
    // would be replacing.
    const other = await seedApprovedKit(String(biz._id));
    await BrandKitModel.updateOne({ _id: other._id }, { $set: { recipe: standing } });

    authorRecipeMock.mockReset();
    let n = 0;
    authorRecipeMock.mockImplementation(async () => fakeRecipe(`Take ${++n}`));
    expectStatus(await request(app()).post(`/brandkits/${other._id}/recipe/candidates`).send({}), 200);
    expect(authorRecipeMock).toHaveBeenCalledTimes(2);
    // Every candidate replaces the SAME standing recipe, so each is held to it.
    for (const call of authorRecipeMock.mock.calls)
      expect(call[1]?.previous?.signature?.name).toBe('Standing');
  });

  it('caps the run at three candidates', async () => {
    const { res } = await seedAndAuthor(3);
    expectStatus(res, 200);
    expect(res.body.candidates).toHaveLength(3);
    const bad = await request(app())
      .post(`/brandkits/${String(new mongoose.Types.ObjectId())}/recipe/candidates`)
      .send({ count: 4 });
    expectStatus(bad, 400); // validation runs before the kit lookup
  });

  it('select promotes the chosen candidate to kit.recipe and clears the list', async () => {
    const { kit, res } = await seedAndAuthor(3);
    const chosen = res.body.candidates[1];

    const sel = await request(app())
      .post(`/brandkits/${kit._id}/recipe/select`)
      .send({ candidateId: chosen.id });
    expectStatus(sel, 200);
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
    expectStatus(sel, 404);
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
    expectStatus(partial, 200);
    expect(partial.body.candidates).toHaveLength(1);
    expect(partial.body.candidates[0].recipe.signature.name).toBe('Survivor');

    // Every author fails → a 502 with the upstream reason, nothing persisted.
    authorRecipeMock.mockRejectedValue(new Error('model exploded'));
    const res = await request(app()).post(`/brandkits/${kit._id}/recipe/candidates`).send({});
    expectStatus(res, 502);
    expect(res.body.error).toMatch(/model exploded/);
  });
});

// ── Recipe refine: one layer, not the whole design ────────────────────────────
// The point of the endpoint is that everything NOT asked about survives, so
// these assert byte-identity of the untouched layers — and that the flat
// (no-layers) recipes every brand actually has stored still get an honest,
// whole-sheet answer that clears the same gates.
describe('recipe refine', () => {
  const BG = '.cb-slide { background: radial-gradient(circle at 20% 0%, var(--cb-accent), var(--cb-ground)); }';
  const TYPE = '.cb-slide .headline { font-size: 104px; font-family: var(--cb-display); }';
  const COMPONENTS = '.cb-slide .cta { border-radius: var(--cb-radius); }';
  const CALM_BG = '.cb-slide { background: var(--cb-ground); }';

  function refinableRecipe(extra: Record<string, unknown> = {}) {
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
      signature: { name: 'Gold rule', description: 'A hairline rule under every headline' },
      stylesheet: [BG, TYPE, COMPONENTS].join('\n'),
      components: [
        { className: 'headline', use: 'The hook' },
        { className: 'cta', use: 'The button' },
      ],
      ...extra,
    };
  }

  async function seedKitWithRecipe(recipe: Record<string, unknown> | null) {
    const biz = await seedBusiness();
    const kit = await seedApprovedKit(String(biz._id));
    if (recipe) {
      kit.set('recipe', recipe);
      await kit.save();
    }
    return kit;
  }

  const refine = (kitId: string, body: Record<string, unknown>) =>
    request(app()).post(`/brandkits/${kitId}/recipe/refine`).send(body);

  beforeEach(() => {
    aiReplyMock.mockReset();
    aiReplyMock.mockReturnValue('');
  });

  it('replaces only the targeted layer and leaves the others byte-identical', async () => {
    const kit = await seedKitWithRecipe(
      refinableRecipe({ layers: { background: BG, type: TYPE, components: COMPONENTS } }),
    );
    aiReplyMock.mockReturnValue(CALM_BG);

    const res = await refine(String(kit._id), { layer: 'background', instruction: 'too busy — calm it' });
    expectStatus(res, 200);
    expect(res.body.refine).toMatchObject({ layer: 'background', mode: 'layer' });

    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipe?.layers?.background).toBe(CALM_BG);
    expect(fresh?.recipe?.layers?.type).toBe(TYPE); // untouched, byte for byte
    expect(fresh?.recipe?.layers?.components).toBe(COMPONENTS);
    // The stored blob is recomposed exactly as the renderer composes layers.
    expect(fresh?.recipe?.stylesheet).toBe([CALM_BG, TYPE, COMPONENTS].join('\n'));
    // …and the model was actually shown the brand and the ask.
    const sent = JSON.stringify(aiReplyMock.mock.calls[0]?.[0] ?? {});
    expect(sent).toContain('too busy');
    expect(sent).toContain('LAYER TO CHANGE: background');
  });

  it('rewrites the whole sheet — and says so — when the recipe has no layer split', async () => {
    const kit = await seedKitWithRecipe(refinableRecipe());
    const WHOLE = [CALM_BG, TYPE, COMPONENTS].join('\n');
    aiReplyMock.mockReturnValue(WHOLE);

    const res = await refine(String(kit._id), { layer: 'background', instruction: 'flatten the ground' });
    expectStatus(res, 200);
    expect(res.body.refine).toMatchObject({ layer: 'background', mode: 'sheet' });
    expect(JSON.stringify(aiReplyMock.mock.calls[0]?.[0] ?? {})).toContain('NO LAYER SPLIT');

    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipe?.stylesheet).toBe(WHOLE);
    expect(fresh?.recipe?.layers).toBeFalsy(); // no fake split is invented
    // The gates still ran: both advertised classes are still defined, so both survive.
    expect(fresh?.recipe?.components?.map((c: any) => c.className)).toEqual(['headline', 'cta']);
  });

  it('repairs a contrast failure through the same gate the author uses', async () => {
    const kit = await seedKitWithRecipe(
      refinableRecipe({
        tokens: {
          ground: '#0B0F1A',
          ink: '#1A2030', // ~1.2:1 on that ground — unreadable
          accent: '#F5C044',
          displayFamily: 'Inter',
          bodyFamily: 'Inter',
          radius: 16,
        },
      }),
    );
    aiReplyMock.mockReturnValue([CALM_BG, TYPE, COMPONENTS].join('\n'));

    const res = await refine(String(kit._id), { layer: 'background', instruction: 'calmer' });
    expectStatus(res, 200);
    expect(res.body.refine.repairs.join(' ')).toMatch(/ink/);
    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipe?.tokens?.ink).not.toBe('#1A2030');
  });

  it('parses a reply wrapped in fences and prose', async () => {
    const kit = await seedKitWithRecipe(
      refinableRecipe({ layers: { background: BG, type: TYPE, components: COMPONENTS } }),
    );
    aiReplyMock.mockReturnValue(
      ['Happy to — here is the calmer background:', '', '```css', CALM_BG, '```', '', 'Hope that reads better!'].join('\n'),
    );
    const res = await refine(String(kit._id), { layer: 'background', instruction: 'calmer' });
    expectStatus(res, 200);
    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipe?.layers?.background).toBe(CALM_BG);
  });

  it('rejects a bad layer, an unknown kit, an empty instruction and a recipe-less kit', async () => {
    const kit = await seedKitWithRecipe(refinableRecipe());
    aiReplyMock.mockReturnValue(CALM_BG);

    const badLayer = await refine(String(kit._id), { layer: 'colours', instruction: 'x' });
    expectStatus(badLayer, 400);
    const noInstruction = await refine(String(kit._id), { layer: 'type', instruction: '  ' });
    expectStatus(noInstruction, 400);

    const unknown = await refine(String(new mongoose.Types.ObjectId()), {
      layer: 'type',
      instruction: 'bigger headlines',
    });
    expectStatus(unknown, 404);

    const bare = await seedKitWithRecipe(null);
    const noRecipe = await refine(String(bare._id), { layer: 'type', instruction: 'bigger headlines' });
    expectStatus(noRecipe, 400);
    expect(noRecipe.body.error).toMatch(/no recipe/i);

    // None of the rejections reached the model.
    expect(aiReplyMock).not.toHaveBeenCalled();
  });

  it('502s with the upstream reason when the model returns no CSS', async () => {
    const kit = await seedKitWithRecipe(refinableRecipe());
    aiReplyMock.mockReturnValue('I would rather not.');
    const res = await refine(String(kit._id), { layer: 'type', instruction: 'bigger headlines' });
    expectStatus(res, 502);
    expect(res.body.error).toMatch(/no CSS/i);
    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.recipe?.stylesheet).toContain('radial-gradient'); // nothing was saved
  });
});

// ── Tweak signals → kit suggestion ────────────────────────────────────────────
// Every deterministic slide tweak is a labelled preference about the brand's
// recipe; these cover the whole learning loop: press → counter on the approved
// kit → derived suggestion (correct direction) → apply-clears / dismiss-snoozes.
describe('tweak signals → kit suggestion', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** A minimal valid recipe with the tunable typography block. */
  function recipeWith(extra: Record<string, unknown> = {}) {
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
      typography: { displayCase: 'sentence', displayWeight: 700, displayTracking: '-0.02em', density: 'balanced' },
      signature: { name: 'Gold rule', description: 'A recurring move' },
      stylesheet: '.cb-slide .headline { font-size: 100px; }',
      components: [],
      ...extra,
    };
  }

  /** Approved kit WITH a recipe + one authored-slide project to press tweaks on. */
  async function seedTweakable(recipeExtra: Record<string, unknown> = {}) {
    const biz = await seedBusiness();
    const kit = await seedApprovedKit(String(biz._id));
    kit.set('recipe', recipeWith(recipeExtra));
    await kit.save();
    const created = await request(app())
      .post('/projects')
      .send({
        businessId: String(biz._id),
        title: 'T',
        type: 'carousel',
        format: '1080x1080',
        slides: [{ authored: { html: '<h1 class="headline">Hi</h1>' } }],
      });
    expectStatus(created, 201);
    return { biz, kit, project: created.body, slideId: created.body.slides[0].id as string };
  }

  const press = (projectId: string, slideId: string, tweak: string) =>
    request(app()).post(`/projects/${projectId}/slides/${slideId}/tweak`).send({ tweak });

  // The size buttons used to pattern-match `class="headline…"`, so they only
  // worked when `headline` was the FIRST class in a double-quoted attribute —
  // on a recipe writing `class="lead headline"` the button silently did nothing.
  it('resizes a headline whose class attribute does not start with `headline`', async () => {
    const { biz } = await seedTweakable();
    const created = await request(app())
      .post('/projects')
      .send({
        businessId: String(biz._id),
        title: 'Awkward classes',
        type: 'carousel',
        format: '1080x1080',
        // Single-quoted, and `headline` is neither first nor last.
        slides: [{ authored: { html: `<h1 class='lead headline wide'>Hi</h1>` } }],
      });
    expectStatus(created, 201);
    const id = created.body._id as string;
    const sid = created.body.slides[0].id as string;

    const smaller = await press(id, sid, 'smaller-headline');
    expectStatus(smaller, 200);
    expect(smaller.body.slides[0].authored.html).toContain('sm');

    const bigger = await press(id, sid, 'bigger-headline');
    expectStatus(bigger, 200);
    expect(bigger.body.slides[0].authored.html).not.toMatch(/\bsm\b/);
  });

  it('three smaller-headline presses → counters on the approved kit and a denser-step suggestion', async () => {
    const { biz, kit, project, slideId } = await seedTweakable();
    for (let i = 0; i < 3; i++) expect((await press(project._id, slideId, 'smaller-headline')).status).toBe(200);

    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.tweakSignals?.smallerHeadline).toBe(3);

    const state = await request(app()).get(`/businesses/${biz._id}/brandkit`);
    expectStatus(state, 200);
    expect(state.body.approved.tweakSignals.smallerHeadline).toBe(3);
    // Density drives a rhythm multiplier (roomy 1.15 → balanced 1 → dense
    // 0.86): repeated "smaller headline" means the type keeps running too BIG,
    // so the correct direction is one step TOWARD dense.
    expect(state.body.suggestion).toMatchObject({
      kind: 'density',
      from: 'balanced',
      to: 'dense',
      reason: 'smaller-headline',
      count: 3,
    });
  });

  it('net bigger-headline presses suggest the opposite step (toward roomy)', async () => {
    const { biz, project, slideId } = await seedTweakable();
    for (let i = 0; i < 4; i++) await press(project._id, slideId, 'bigger-headline');
    await press(project._id, slideId, 'smaller-headline'); // netting: 4 − 1 = 3
    const state = await request(app()).get(`/businesses/${biz._id}/brandkit`);
    expect(state.body.suggestion).toMatchObject({ kind: 'density', to: 'roomy', reason: 'bigger-headline', count: 3 });
  });

  it('applying the density step via the ordinary knobs PATCH clears the spent counters', async () => {
    const { biz, kit, project, slideId } = await seedTweakable();
    for (let i = 0; i < 3; i++) await press(project._id, slideId, 'smaller-headline');

    const patched = await request(app()).patch(`/brandkits/${kit._id}`).send({ recipe: { density: 'dense' } });
    expectStatus(patched, 200);
    expect(patched.body.recipe.typography.density).toBe('dense');

    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.tweakSignals?.smallerHeadline).toBe(0);
    expect(fresh?.tweakSignals?.biggerHeadline).toBe(0);

    const state = await request(app()).get(`/businesses/${biz._id}/brandkit`);
    expect(state.body.suggestion).toBeNull();
  });

  it('dismiss suppresses the suggestion for 14 days without clearing the counters', async () => {
    const { biz, kit, project, slideId } = await seedTweakable();
    for (let i = 0; i < 3; i++) await press(project._id, slideId, 'smaller-headline');

    const dismissed = await request(app()).post(`/brandkits/${kit._id}/suggestion/dismiss`);
    expectStatus(dismissed, 200);

    const state = await request(app()).get(`/businesses/${biz._id}/brandkit`);
    expect(state.body.suggestion).toBeNull();
    // A snooze, not amnesia: the presses are still on the kit.
    expect(state.body.approved.tweakSignals.smallerHeadline).toBe(3);

    // 15 days later, the same standing corrections resurface on their own.
    await BrandKitModel.updateOne(
      { _id: kit._id },
      { $set: { 'tweakSignals.dismissedAt': new Date(Date.now() - 15 * DAY_MS) } },
    );
    const later = await request(app()).get(`/businesses/${biz._id}/brandkit`);
    expect(later.body.suggestion).toMatchObject({ kind: 'density', to: 'dense' });
  });

  it('invert is only suggested when the recipe HAS an inverse surface; the flip applies and clears', async () => {
    // No surfaces.inverse → three inverts earn nothing (there is nothing to flip to).
    const bare = await seedTweakable();
    for (let i = 0; i < 3; i++) await press(bare.project._id, bare.slideId, 'invert');
    const bareState = await request(app()).get(`/businesses/${bare.biz._id}/brandkit`);
    expect(bareState.body.approved.tweakSignals.invert).toBe(3);
    expect(bareState.body.suggestion).toBeNull();

    // With an inverse surface, the flip is offered…
    const inv = await seedTweakable({ surfaces: { inverse: { ground: '#F8FAFC', ink: '#0B0F1A' } } });
    for (let i = 0; i < 3; i++) await press(inv.project._id, inv.slideId, 'invert');
    const state = await request(app()).get(`/businesses/${inv.biz._id}/brandkit`);
    expect(state.body.suggestion).toMatchObject({ kind: 'invert', count: 3 });

    // …and applying swaps default ↔ inverse (round-trippable) and spends the counter.
    const patched = await request(app()).patch(`/brandkits/${inv.kit._id}`).send({ recipe: { flipSurfaces: true } });
    expectStatus(patched, 200);
    expect(patched.body.recipe.tokens.ground).toBe('#F8FAFC');
    expect(patched.body.recipe.tokens.ink).toBe('#0B0F1A');
    expect(patched.body.recipe.surfaces.inverse).toMatchObject({ ground: '#0B0F1A', ink: '#F8FAFC' });

    const fresh = await BrandKitModel.findById(inv.kit._id).lean<Record<string, any> | null>();
    expect(fresh?.tweakSignals?.invert).toBe(0);
    const after = await request(app()).get(`/businesses/${inv.biz._id}/brandkit`);
    expect(after.body.suggestion).toBeNull();
  });

  it('un-invert withdraws an invert press — the counter is a net preference', async () => {
    const { biz, kit, project, slideId } = await seedTweakable({
      surfaces: { inverse: { ground: '#F8FAFC', ink: '#0B0F1A' } },
    });
    for (let i = 0; i < 3; i++) await press(project._id, slideId, 'invert');
    await press(project._id, slideId, 'un-invert');
    const fresh = await BrandKitModel.findById(kit._id).lean<Record<string, any> | null>();
    expect(fresh?.tweakSignals?.invert).toBe(2);
    const state = await request(app()).get(`/businesses/${biz._id}/brandkit`);
    expect(state.body.suggestion).toBeNull(); // back under the threshold
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
    expectStatus(res, 200);
    expect(await modelFor('vision')).toBe('claude-vision-override');
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('rate limiting', () => {
  it('429s expensive POSTs after the window budget', async () => {
    // Its OWN app: the limiter's map lives inside `createApp`, and these 31
    // requests would otherwise spend the budget every other test shares.
    const shared = createApp();
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(shared)
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1080' });
    // State the precondition. Without it a create that comes back without an
    // `_id` surfaces thirty requests later as "expected 400 to be 429", which
    // describes the symptom and hides the cause — exactly how this test failed.
    expectStatus(created, 201);

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
    expectStatus(created, 201);
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
    expectStatus(started, 202);
    const jobId = started.body.jobId as string;
    expect(jobId).toBeTruthy();

    const poll = await request(app()).get(`/projects/${project._id}/export-video/${jobId}`);
    expectStatus(poll, 200);
    expect(['queued', 'rendering']).toContain(poll.body.state);
    expect(typeof poll.body.percent).toBe('number');

    // Wait until the runner has claimed the job — cancelling a still-queued job
    // is also correct, but then the mock render never runs and can't be awaited.
    await until(() => renderVideoMock.mock.calls.length > 0);

    const cancel = await request(app()).post(
      `/projects/${project._id}/export-video/${jobId}/cancel`,
    );
    expectStatus(cancel, 200);
    expect(cancel.body.state).toBe('cancelled');

    // The running render notices the durable flag and aborts; the job STAYS
    // cancelled (the runner must not overwrite it with done/error).
    await until(() => renderEnded);
    const after = await request(app()).get(`/projects/${project._id}/export-video/${jobId}`);
    expectStatus(after, 200);
    expect(after.body.state).toBe('cancelled');
    expect((await VideoJobModel.findById(jobId))?.get('state')).toBe('cancelled');

    // Cancelling again is a harmless no-op.
    const again = await request(app()).post(
      `/projects/${project._id}/export-video/${jobId}/cancel`,
    );
    expectStatus(again, 200);
    expect(again.body.state).toBe('cancelled');
  }, 20_000);

  it('persists the artifact and serves the download from the same poll URL', async () => {
    renderVideoMock.mockResolvedValue([
      { name: '01.mp4', buffer: Buffer.from('mp4-bytes'), key: 'renders/x/01.mp4', url: 'http://x/01.mp4', frames: 10 },
    ]);

    const project = await seedAuthoredProject();
    const started = await request(app()).post(`/projects/${project._id}/export-video`);
    expectStatus(started, 202);
    const jobId = started.body.jobId as string;

    let downloadHeaders: Record<string, string> | null = null;
    for (let i = 0; i < 100; i++) {
      const res = await request(app()).get(`/projects/${project._id}/export-video/${jobId}`);
      expectStatus(res, 200);
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

// ── Promo story ───────────────────────────────────────────────────────────────
describe('POST /projects/:id/promo-story', () => {
  const carouselWithCover = async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'Win back lapsed clients', type: 'carousel', format: '1080x1350' });
    await request(app())
      .patch(`/projects/${created.body._id}`)
      .send({ slides: [{ id: 's1', order: 0, authored: { html: '<h1 class="headline">Cover</h1>', role: 'cover' } }] });
    return created.body._id as string;
  };

  it('refuses a project that is not a carousel', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const story = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'S', type: 'story', format: '1080x1920' });
    const res = await request(app()).post(`/projects/${story.body._id}/promo-story`);
    expectStatus(res, 400);
    expect(res.body.error).toMatch(/only a carousel/i);
  });

  it('refuses a carousel with no slides', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const empty = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'C', type: 'carousel', format: '1080x1350' });
    const res = await request(app()).post(`/projects/${empty.body._id}/promo-story`);
    expectStatus(res, 400);
    expect(res.body.error).toMatch(/no slides/i);
  });

  /**
   * The blank-frame guard. A cover with no authored markup renders to the empty
   * ~7KB PNG that the retired slide format produces, and a promo story showing
   * an empty rectangle is worse than no promo story at all.
   */
  it('refuses a cover with no authored markup rather than rendering a blank frame', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'C', type: 'carousel', format: '1080x1350' });
    await request(app())
      .patch(`/projects/${created.body._id}`)
      .send({ slides: [{ id: 's1', order: 0 }] });
    const res = await request(app()).post(`/projects/${created.body._id}/promo-story`);
    expectStatus(res, 400);
    expect(res.body.error).toMatch(/no authored markup/i);
  });

  it('refuses a brand with no design recipe', async () => {
    // seedApprovedKit stores no `recipe`, so this is the ordinary state of a
    // kit approved before recipes existed.
    const id = await carouselWithCover();
    const res = await request(app()).post(`/projects/${id}/promo-story`);
    expectStatus(res, 400);
    expect(res.body.error).toMatch(/no design recipe/i);
  });

  it('404s on an unknown project', async () => {
    const res = await request(app()).post(`/projects/${new mongoose.Types.ObjectId()}/promo-story`);
    expectStatus(res, 404);
  });
})

// ── Review-driven guards ──────────────────────────────────────────────────────
describe('compose guards and settings from the carousel review', () => {
  it('refuses to compose with an empty photo pool unless textOnly is acknowledged', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1350' });
    const res = await request(app())
      .post(`/projects/${created.body._id}/compose`)
      .send({ idea: 'Some idea' });
    expectStatus(res, 400);
    expect(res.body.error).toMatch(/no usable photos/i);
    // The same call with the acknowledgement gets PAST the gate (it then fails
    // later on the missing recipe, which is the pre-existing behaviour).
    const acked = await request(app())
      .post(`/projects/${created.body._id}/compose`)
      .send({ idea: 'Some idea', textOnly: true });
    expect(acked.body.error ?? '').not.toMatch(/no usable photos/i);
  });

  it('stores caption, dmKeyword and audience at create time', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    const created = await request(app())
      .post('/projects')
      .send({
        businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1350',
        caption: { text: 'Ready-made caption', hashtags: ['#carcare', '#ceramiccoating'] },
        settings: { dmKeyword: 'COATING', audience: 'car owner' },
      });
    expectStatus(created, 201);
    expect(created.body.caption?.text).toBe('Ready-made caption');
    expect(created.body.caption?.hashtags).toHaveLength(2);
    expect(created.body.settings?.dmKeyword).toBe('COATING');
    expect(created.body.settings?.audience).toBe('car owner');
  });

  /**
   * A logo or avatar harvested from the site lists fine and ships as a blurry
   * stamp — the pool must not offer what cannot fill a slot.
   */
  it('keeps small images out of the brand photo pool', async () => {
    const biz = await seedBusiness();
    await seedApprovedKit(String(biz._id));
    // Through the real upload path, so the bytes exist and the pool's
    // orphan check keeps them: a bare DB row is exactly what it filters.
    const mk = async (w: number, h: number) =>
      request(app())
        .post(`/businesses/${biz._id}/media`)
        .attach('file', solidPng(w, h, '#223344'), { filename: `p${w}.png`, contentType: 'image/png' });
    await mk(640, 447);   // site chrome — out
    await mk(2120, 1280); // real photo — in
    const created = await request(app())
      .post('/projects')
      .send({ businessId: String(biz._id), title: 'P', type: 'carousel', format: '1080x1350' });
    // With one usable photo the gate does not fire even without textOnly.
    const res = await request(app())
      .post(`/projects/${created.body._id}/compose`)
      .send({ idea: 'Some idea' });
    expect(res.body.error ?? '').not.toMatch(/no usable photos/i);
  });
})
