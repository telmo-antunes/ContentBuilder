import { describe, expect, it } from 'vitest';
import { slideSchema } from './schemas';

describe('slideSchema decorations', () => {
  const base = { id: 's1', order: 0, layoutType: 'FreePosition', blocks: [] };

  it('round-trips a converted slide (scrim + logo + rule)', () => {
    const parsed = slideSchema.safeParse({
      ...base,
      overrides: {
        imageBackground: true,
        decorations: [
          { kind: 'scrim', frame: { x: 0, y: 0, w: 1, h: 1 }, z: 1, direction: 'to-top', opacity: 0.96 },
          { kind: 'logo', frame: { x: 0.07, y: 0.06, w: 0.2, h: 0.05 }, z: 2 },
          { kind: 'rule', frame: { x: 0.07, y: 0.13, w: 0.06, h: 0.01 }, z: 2 },
        ],
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.overrides?.decorations).toHaveLength(3);
  });

  it('rejects unknown decoration kinds and out-of-range opacity', () => {
    const bad = (decorations: unknown) =>
      slideSchema.safeParse({ ...base, overrides: { decorations } }).success;
    expect(bad([{ kind: 'sticker', frame: { x: 0, y: 0, w: 1, h: 1 } }])).toBe(false);
    expect(bad([{ kind: 'scrim', frame: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1.5 }])).toBe(false);
  });
});
