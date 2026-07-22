import { describe, it, expect } from 'vitest';
import { BLOCK_TYPES, type BrandLayout } from '@contentbuilder/shared';
import { SAMPLE_TEXT, sampleSlideForLayout } from './renderPreview';
import { slideSchema } from './validation';

const LAYOUT: BrandLayout = {
  name: 'Cover',
  purpose: 'cover',
  imageNeed: 'none',
  blocks: [
    { type: 'eyebrow', frame: { x: 0.1, y: 0.12, w: 0.5, h: 0.05 } },
    { type: 'title', frame: { x: 0.1, y: 0.2, w: 0.8, h: 0.24 } },
    { type: 'list', frame: { x: 0.1, y: 0.5, w: 0.8, h: 0.35 } },
  ],
  decorations: [{ kind: 'logo', frame: { x: 0.1, y: 0.86, w: 0.2, h: 0.06 } }],
  backgroundMediaAssetId: 'bg-1',
};

describe('renderPreview sample copy', () => {
  it('has sample copy for every block type', () => {
    for (const t of BLOCK_TYPES) {
      const s = SAMPLE_TEXT[t];
      expect(s, `missing SAMPLE_TEXT for ${t}`).toBeTruthy();
      expect(Boolean(s.text) || (s.items?.length ?? 0) > 0).toBe(true);
    }
  });

  it('builds a valid FreePosition slide from a brand layout', () => {
    const slide = sampleSlideForLayout(LAYOUT);
    const parsed = slideSchema.safeParse(slide);
    expect(parsed.success).toBe(true);
    expect(slide.layoutType).toBe('FreePosition');
    // copy poured into the layout's frames
    expect(slide.blocks.find((b) => b.type === 'title')?.text).toBe(SAMPLE_TEXT.title.text);
    expect(slide.blocks.find((b) => b.type === 'list')?.items?.length).toBeGreaterThan(0);
    expect(slide.blocks.every((b) => b.frame)).toBe(true);
    // background carried through from the layout
    expect(slide.overrides?.backgroundMediaAssetId).toBe('bg-1');
  });

  it('honors an explicit background override', () => {
    const slide = sampleSlideForLayout(LAYOUT, 'bg-override');
    expect(slide.overrides?.backgroundMediaAssetId).toBe('bg-override');
  });
});
