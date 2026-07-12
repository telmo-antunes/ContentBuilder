import { describe, expect, it, vi } from 'vitest';

// Force the no-key path even when the local .env carries a real Pexels key
// (dotenv never overrides an existing env var, so '' sticks and config's
// optional() reads it as unset).
vi.hoisted(() => {
  process.env.PEXELS_API_KEY = '';
});

import { resolveDraftImages, stockConfigured } from './stock';
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
