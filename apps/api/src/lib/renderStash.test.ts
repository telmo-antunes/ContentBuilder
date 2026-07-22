import { describe, it, expect } from 'vitest';
import { createStash, type StashRenderPayload } from './renderStash';

const payload = (): StashRenderPayload => ({
  format: '1080x1350',
  type: 'carousel',
  slides: [],
  brandKit: null,
  media: [],
});

describe('renderStash', () => {
  it('round-trips a payload by id', () => {
    const stash = createStash();
    const id = stash.put(payload());
    expect(stash.get(id)).toEqual(payload());
  });

  it('returns null for an unknown id', () => {
    const stash = createStash();
    expect(stash.get('nope')).toBeNull();
  });

  it('expires entries after the TTL', () => {
    let t = 0;
    const stash = createStash({ ttlMs: 100, now: () => t });
    const id = stash.put(payload());
    t = 50;
    expect(stash.get(id)).not.toBeNull();
    t = 101;
    expect(stash.get(id)).toBeNull();
  });

  it('evicts oldest beyond the cap (LRU-by-insertion)', () => {
    let t = 0;
    const stash = createStash({ max: 2, now: () => t });
    const a = stash.put(payload());
    t = 1;
    const b = stash.put(payload());
    t = 2;
    const c = stash.put(payload());
    expect(stash.size()).toBe(2);
    expect(stash.get(a)).toBeNull(); // oldest evicted
    expect(stash.get(b)).not.toBeNull();
    expect(stash.get(c)).not.toBeNull();
  });
});
