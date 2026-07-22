import { describe, it, expect } from 'vitest';
import type { BrandLayout } from '@contentbuilder/shared';
import { instantiateFromLibrary } from './draft';
import type { ContentUnit } from './draftParse';

const LAYOUTS: BrandLayout[] = [
  { name: 'Cover', purpose: 'cover', imageNeed: 'none', backgroundRole: 'statement', backgroundMediaAssetId: 'bg-cover', blocks: [{ type: 'title', frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 }, z: 10 }] },
  { name: 'Content', purpose: 'content', imageNeed: 'none', backgroundRole: 'canvas', backgroundMediaAssetId: 'bg-content', blocks: [{ type: 'paragraph', frame: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, z: 10 }] },
];

const UNITS: ContentUnit[] = [
  { purpose: 'cover', blocks: [{ type: 'title', text: 'Hello there' }] },
  { purpose: 'content', blocks: [{ type: 'paragraph', text: 'Body copy one' }] },
  { purpose: 'content', blocks: [{ type: 'paragraph', text: 'Body copy two' }] },
  { purpose: 'quote', blocks: [{ type: 'quote', text: 'A short quote' }] },
];

describe('instantiateFromLibrary', () => {
  it('pours copy into the brand layouts, preserving order + backgrounds', () => {
    const slides = instantiateFromLibrary(UNITS, LAYOUTS);
    expect(slides).toHaveLength(4);
    expect(slides.every((s) => s.layoutType === 'FreePosition')).toBe(true);
    expect(slides.map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(slides[0]?.blocks.find((b) => b.type === 'title')?.text).toBe('Hello there');
    expect(slides[0]?.overrides?.backgroundMediaAssetId).toBe('bg-cover');
    expect(slides[1]?.overrides?.backgroundMediaAssetId).toBe('bg-content');
  });

  it('mirrors a repeated purpose for variety', () => {
    const slides = instantiateFromLibrary(UNITS, LAYOUTS);
    const p1 = slides[1]?.blocks.find((b) => b.type === 'paragraph')?.frame?.x;
    const p2 = slides[2]?.blocks.find((b) => b.type === 'paragraph')?.frame?.x;
    expect(p1).toBeCloseTo(0.1); // first content, unmirrored
    expect(p2).toBeCloseTo(0.4); // second content, mirrored (1 - 0.1 - 0.5)
  });

  it('falls back to the content layout for an unsupported purpose (copy preserved)', () => {
    const slides = instantiateFromLibrary(UNITS, LAYOUTS);
    const quoteText = JSON.stringify(slides[3]);
    expect(quoteText).toContain('A short quote'); // the quote copy survives somewhere on the slide
  });

  it('returns [] with no layouts', () => {
    expect(instantiateFromLibrary(UNITS, [])).toEqual([]);
  });
});
