import { describe, expect, it } from 'vitest';
import { packSummary, type BrandTemplate } from './templates';

const skeleton = (over: Record<string, unknown> = {}) => ({
  name: 'Editorial cover',
  purpose: 'cover',
  imageNeed: 'none',
  blocks: [
    { type: 'eyebrow', frame: { x: 0.1, y: 0.12, w: 0.5, h: 0.05 }, z: 10 },
    { type: 'title', frame: { x: 0.1, y: 0.2, w: 0.8, h: 0.25 }, z: 11 },
  ],
  decorations: [{ kind: 'rule', frame: { x: 0.1, y: 0.18, w: 0.08, h: 0.01 }, z: 2 }],
  ...over,
});

describe('packSummary', () => {
  it('is compact: rounds frames, strips decorations', () => {
    const pack = [skeleton()] as unknown as BrandTemplate[];
    const s = packSummary(pack);
    expect(s).toContain('"purpose":"cover"');
    expect(s).not.toContain('decorations');
    expect(s).toContain('0.12');
  });
});
