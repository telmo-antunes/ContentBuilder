import { describe, expect, it } from 'vitest';
import { fillSlotsFromPool, poolIsTagged, poolPhotoFinder } from './photoPool';

const slotSlide = (id: string) => ({
  id,
  authored: { html: '<div class="headline">x</div><figure class="cb-shot" data-cb-slot="hero"></figure>', archetype: undefined },
});

describe('fillSlotsFromPool with a ranked preference', () => {
  const pool = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];

  it('takes the ranked candidates in order, then falls back to the pool', () => {
    const { photos } = fillSlotsFromPool([slotSlide('s1'), slotSlide('s2'), slotSlide('s3')], pool, undefined, [
      ['c', 'b'],
      ['c', 'b'],
      undefined,
    ]);
    expect(photos.map((p) => p[0]?.mediaAssetId)).toEqual(['c', 'b', 'a']);
  });

  it('still accepts a set, meaning any of these first', () => {
    const { photos } = fillSlotsFromPool([slotSlide('s1')], pool, undefined, [new Set(['b'])]);
    expect(photos[0]![0]!.mediaAssetId).toBe('b');
  });
});

describe('poolPhotoFinder', () => {
  const tagged = (id: string, subjects: string[]) => ({ _id: id, tags: { kind: 'photo' as const, subjects, tone: 'dark' as const, caption: '', taggedAt: new Date() } });

  it('answers yes to everything on an untagged pool', () => {
    const find = poolPhotoFinder([{ _id: 'a' }, { _id: 'b' }]);
    expect(find('foam on a car seat')).toBe(true);
    expect(poolIsTagged([{ _id: 'a' }])).toBe(false);
  });

  it('says no when a tagged pool holds nothing for the words', () => {
    const find = poolPhotoFinder([tagged('a', ['dashboard', 'booking table']), tagged('b', ['car bonnet', 'coating'])]);
    expect(find('foam on a car seat')).toBe(false);
    expect(find('ceramic coating on the bonnet')).toBe(true);
    // A query with nothing matchable cannot be judged, so it passes.
    expect(find('a car')).toBe(true);
    expect(find(undefined)).toBe(true);
  });

  it('needs at least half the pool tagged before it judges', () => {
    const find = poolPhotoFinder([tagged('a', ['dashboard']), { _id: 'b' }, { _id: 'c' }]);
    expect(find('foam on a car seat')).toBe(true);
  });
});
