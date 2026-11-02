import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyWorkspace } from './schema';
import { storeAsset, readImage } from './assets';
import { packWorkspace, unpackWorkspace } from './portable';

describe('portable drafts', () => {
  let first: string; let second: string; let cwd: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => { first = await mkdtemp(join(tmpdir(), 'cb-export-')); second = await mkdtemp(join(tmpdir(), 'cb-import-')); cwd = vi.spyOn(process, 'cwd').mockReturnValue(first); });
  afterEach(async () => { vi.restoreAllMocks(); await Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]); });
  it('opens in a clean directory with all originals, screenshots and history intact', async () => {
    const ref = await storeAsset(Buffer.from('image-test-bytes'), 'png');
    const image = await storeAsset(Buffer.from('screenshot'));
    const deck = { width: 600, height: 750, title: 'Portable', originBrief: 'Original', assets: { 'https://example.com/photo.png': ref }, slides: [{ html: '<img src="https://example.com/photo.png">' }] };
    const workspace = { ...emptyWorkspace, writing: { ...emptyWorkspace.writing, autocomplete: false, draft: 'My follow-up', messages: [{ id: 'chat-1', role: 'assistant' as const, text: 'Who is this for?', sourceBrief: 'Original' }] }, models: { ...emptyWorkspace.models, complete: 'autocomplete-choice', rephrase: 'rephrase-choice', chat: 'chat-choice', analyze: 'analysis-choice', generate: 'generation-choice', revise: 'revision-choice' }, recentRuns: [{ operation: 'generate' as const, outcome: 'success' as const, startedAt: '2026-11-02T12:00:00Z', durationMs: 500, instruction: 'Original', requestedModel: 'generation-choice', model: 'generation-choice', steps: [{ message: 'Writing slides', elapsedMs: 10 }], inputs: { brief: 'Original', directions: [{ slide: 1, text: 'Exact words' }], website: null, websiteNotes: '', images: [], width: 600, height: 750, target: 'New deck' } }], slideDirectionsEnabled: true, slideDirections: [{ id: 'direction-1', slide: 1, text: '  Keep this exact.\nUse the logo.' }], deck: { ...deck, originSlideDirections: [{ slide: 1, text: '  Keep this exact.\nUse the logo.' }] }, redo: { deck, instruction: 'Redo' }, revisionText: 'Pending text', brand: { url: 'https://example.com', notes: 'Brand', screenshot: image, captures: [], previews: [{ url: 'https://example.com/photo.png', thumbnail: image, original: ref }], images: ['https://example.com/photo.png'] } };
    const packed = await packWorkspace(workspace); expect(Object.keys(packed.assets)).toHaveLength(2);
    cwd.mockReturnValue(second);
    const restored = await unpackWorkspace(packed);
    expect(restored).toEqual(workspace); expect(await readImage(ref)).toEqual(Buffer.from('image-test-bytes'));
  });
  it('rejects missing or tampered assets before accepting a draft', async () => {
    const ref = await storeAsset(Buffer.from('original'));
    const packed = await packWorkspace({ ...emptyWorkspace, deck: { width: 600, height: 750, title: 'A', assets: { 'https://example.com/a.jpg': ref }, slides: [{ html: 'test' }] } });
    await expect(unpackWorkspace({ ...packed, assets: {} })).rejects.toThrow('missing an image');
    await expect(unpackWorkspace({ ...packed, assets: { [ref]: Buffer.from('tampered').toString('base64') } })).rejects.toThrow('damaged');
  });
  it('exports feedback evidence and usage even when its image is absent from the current deck', async () => {
    const ref = await storeAsset(Buffer.from('feedback-only-image'), 'png');
    const run = { id: 'reviewed', operation: 'generate' as const, outcome: 'success' as const, startedAt: 'now', durationMs: 30, instruction: 'Keep the title', feedback: { categories: ['instructions' as const], note: 'Title was changed', updatedAt: 'later' }, output: { width: 1080, height: 1350, title: 'Evidence', assets: { 'https://example.com/old.png': ref }, slides: [{ html: '<img src="https://example.com/old.png">' }] } };
    const workspace = { ...emptyWorkspace, recentRuns: [run], lastRun: run, writing: { ...emptyWorkspace.writing, usage: { ...emptyWorkspace.writing.usage, requests: 3, failed: 3, consecutiveFailures: 3, unreported: 3 } } };
    const packed = await packWorkspace(workspace);
    expect(Object.keys(packed.assets)).toEqual([ref]);
    cwd.mockReturnValue(second);
    expect(await unpackWorkspace(packed)).toEqual(workspace);
    expect(await readImage(ref)).toEqual(Buffer.from('feedback-only-image'));
  });
});
