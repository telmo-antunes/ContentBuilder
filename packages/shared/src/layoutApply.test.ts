import { describe, expect, it } from 'vitest';
import { applyBrandLayout } from './layoutApply';
import type { BrandLayout, Slide } from './types';

const slide: Slide = {
  id: 's1',
  order: 0,
  layoutType: 'Cover',
  imageNeed: 'none',
  mediaAssetId: 'img1',
  blocks: [
    { type: 'eyebrow', text: 'KNOW EVERY CLIENT' },
    { type: 'title', text: 'You remember your regulars' },
    { type: 'paragraph', text: 'A leftover paragraph with no slot.' },
  ],
};

const layout: BrandLayout = {
  name: 'Editorial cover',
  purpose: 'cover',
  imageNeed: 'none',
  blocks: [
    { type: 'eyebrow', frame: { x: 0.1, y: 0.12, w: 0.5, h: 0.05 }, z: 10 },
    { type: 'title', frame: { x: 0.1, y: 0.2, w: 0.8, h: 0.28 }, z: 11 },
  ],
  decorations: [{ kind: 'rule', frame: { x: 0.1, y: 0.18, w: 0.08, h: 0.01 } }],
  backgroundMediaAssetId: 'bg-asset',
};

describe('applyBrandLayout', () => {
  it('pours copy into matching frames and becomes a FreePosition slide', () => {
    const out = applyBrandLayout(slide, layout);
    expect(out.layoutType).toBe('FreePosition');
    expect(out.blocks[0]).toMatchObject({ type: 'eyebrow', text: 'KNOW EVERY CLIENT', frame: { x: 0.1, y: 0.12 } });
    expect(out.blocks[1]).toMatchObject({ type: 'title', text: 'You remember your regulars' });
  });

  it('carries the layout background + decorations, keeps the slide image', () => {
    const out = applyBrandLayout(slide, layout);
    expect(out.overrides?.backgroundMediaAssetId).toBe('bg-asset');
    expect(out.overrides?.decorations?.[0]?.kind).toBe('rule');
    expect(out.mediaAssetId).toBe('img1'); // slide image preserved
  });

  it('never drops copy the layout had no slot for', () => {
    const out = applyBrandLayout(slide, layout);
    const para = out.blocks.find((b) => b.type === 'paragraph');
    expect(para?.text).toBe('A leftover paragraph with no slot.');
    expect(para?.frame).toBeTruthy(); // placed, not lost
  });

  it('an explicit backgroundAssetId overrides the layout default', () => {
    const out = applyBrandLayout(slide, layout, 'chosen-bg');
    expect(out.overrides?.backgroundMediaAssetId).toBe('chosen-bg');
  });

  it('fills only as many frames as the layout has, empty when no matching copy', () => {
    const bare: Slide = { ...slide, blocks: [{ type: 'title', text: 'Only a title' }] };
    const out = applyBrandLayout(bare, layout);
    expect(out.blocks[0]!.text).toBe(''); // eyebrow frame, no eyebrow copy
    expect(out.blocks[1]!.text).toBe('Only a title');
  });
});
