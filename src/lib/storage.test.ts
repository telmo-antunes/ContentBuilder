import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyWorkspace } from './schema';

describe('versioned local saves', () => {
  let directory: string;
  let storage: typeof import('./storage');
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'contentbuilder-storage-'));
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    vi.resetModules(); storage = await import('./storage');
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
  it('starts empty and persists one previous deck across a reload', async () => {
    const initial = await storage.readWorkspace();
    const deck = { width: 600, height: 750, title: 'Previous', slides: [{ html: '<p>Original</p>' }] };
    const saved = await storage.saveWorkspace({ ...emptyWorkspace, brief: 'New draft', previous: { deck, instruction: 'Use purple' } }, initial.version);
    expect(await storage.readWorkspace()).toEqual(saved);
    expect(saved.version).not.toBe(initial.version);
  });
  it('rejects stale writes, including simultaneous saves from two tabs', async () => {
    const initial = await storage.readWorkspace();
    const saves = await Promise.allSettled([
      storage.saveWorkspace({ ...emptyWorkspace, brief: 'Tab one' }, initial.version),
      storage.saveWorkspace({ ...emptyWorkspace, brief: 'Tab two' }, initial.version),
    ]);
    expect(saves[0].status).toBe('fulfilled');
    expect(saves[1].status).toBe('rejected');
    if (saves[1].status === 'rejected') expect(saves[1].reason.status).toBe(409);
    expect((await storage.readWorkspace()).workspace.brief).toBe('Tab one');
  });
  it('reads existing drafts and moves embedded reference images to immutable assets', async () => {
    await mkdir(join(directory, '.data'));
    const brand = { url: 'https://example.com', notes: 'Inspiration', screenshot: 'data:image/jpeg;base64,Ynl0ZXM=', images: [] };
    await writeFile(join(directory, '.data/workspace.json'), JSON.stringify({ ...emptyWorkspace, brand, references: [{ ...brand, url: 'https://second.example' }] }));
    const loaded = await storage.readWorkspace();
    expect(loaded.workspace.brand!.screenshot).toMatch(/^\/api\/assets\/[a-f0-9]{64}\.jpg$/);
    expect(loaded.workspace.references[0].screenshot).toBe(loaded.workspace.brand!.screenshot);
    const saved = await storage.saveWorkspace(loaded.workspace, loaded.version);
    expect(saved.workspace.brand?.captures).toEqual([]);
    const json = await readFile(join(directory, '.data/workspace.json'), 'utf8');
    expect(json).not.toContain('base64');
    expect((await storage.readWorkspace()).version).toBe(saved.version);
  });
});
