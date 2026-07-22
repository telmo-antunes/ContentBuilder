import { describe, it, expect } from 'vitest';
import { GENERIC_POST_LAYOUTS, GENERIC_STORY_LAYOUTS } from './compositions';
import { directorLayoutSchema } from './schema';

describe('generic fallback layouts', () => {
  it('post set covers exactly the six purposes', () => {
    expect(GENERIC_POST_LAYOUTS.map((l) => l.purpose).sort()).toEqual(
      ['content', 'cover', 'cta', 'image-feature', 'list', 'quote'],
    );
  });

  it('story set covers exactly the four story purposes', () => {
    expect(GENERIC_STORY_LAYOUTS.map((l) => l.purpose).sort()).toEqual(['content', 'cover', 'cta', 'quote']);
  });

  it('every generic layout validates and declares a background role', () => {
    for (const l of [...GENERIC_POST_LAYOUTS, ...GENERIC_STORY_LAYOUTS]) {
      expect(directorLayoutSchema.safeParse(l).success, `${l.name} should validate`).toBe(true);
      expect(l.backgroundRole).toBeTruthy();
    }
  });

  it('the list layout has a tall list block', () => {
    const list = GENERIC_POST_LAYOUTS.find((l) => l.purpose === 'list');
    const listBlock = list?.blocks.find((b) => b.type === 'list');
    expect(listBlock?.frame.h).toBeGreaterThanOrEqual(0.35);
  });

  it('the cta layouts anchor a cta block', () => {
    for (const set of [GENERIC_POST_LAYOUTS, GENERIC_STORY_LAYOUTS]) {
      const cta = set.find((l) => l.purpose === 'cta');
      expect(cta?.blocks.some((b) => b.type === 'cta')).toBe(true);
    }
  });
});
