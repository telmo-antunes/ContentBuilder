import { describe, expect, it, vi } from 'vitest';

// Force the no-key path even when the local .env carries a real Pexels key
// (dotenv never overrides an existing env var, so '' sticks and config's
// optional() reads it as unset).
vi.hoisted(() => {
  process.env.PEXELS_API_KEY = '';
});

import { parsePickIndex, resolveDraftImages, stockConfigured } from './stock';
import type { SlideInput } from './validation';

describe('resolveDraftImages', () => {
  it('is a clean no-op without a Pexels key (placeholders remain)', async () => {
    expect(stockConfigured()).toBe(false); // tests never carry a key
    const slides = [
      {
        id: 's1',
        order: 0,
        layoutType: 'BackgroundImage',
        imageNeed: 'upload',
        imageQuery: 'coffee shop interior',
        blocks: [],
      },
    ] as unknown as SlideInput[];
    const placed = await resolveDraftImages('000000000000000000000000', slides, '1080x1350');
    expect(placed).toBe(0);
    expect(slides[0]!.mediaAssetId).toBeUndefined();
  });
});

describe('parsePickIndex', () => {
  it('reads a clean JSON pick (1-based → 0-based)', () => {
    expect(parsePickIndex('{ "pick": 3 }', 4)).toBe(2);
  });

  it('tolerates prose around the answer', () => {
    expect(parsePickIndex('Best fit is:\n{"pick": 1} — calm background', 4)).toBe(0);
  });

  it('falls back to the first bare integer', () => {
    expect(parsePickIndex('Candidate 2 fits best.', 4)).toBe(1);
  });

  it('rejects out-of-range or unusable answers', () => {
    expect(parsePickIndex('{ "pick": 9 }', 4)).toBeNull();
    expect(parsePickIndex('{ "pick": 0 }', 4)).toBeNull();
    expect(parsePickIndex('none of these work', 4)).toBeNull();
  });
});
