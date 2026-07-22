import { describe, it, expect } from 'vitest';
import type { BrandLayout } from '@contentbuilder/shared';
import { enforceReadingOrder } from './readingOrder';

const layout = (blocks: BrandLayout['blocks']): BrandLayout => ({ name: 'X', purpose: 'list', imageNeed: 'none', blocks });
const yOf = (l: BrandLayout, type: string) => l.blocks.find((b) => b.type === type)!.frame.y;

describe('enforceReadingOrder', () => {
  it('lifts a header above the body it introduces (same column)', () => {
    const l = layout([
      { type: 'eyebrow', frame: { x: 0.1, y: 0.15, w: 0.8, h: 0.05 }, z: 10 },
      { type: 'list', frame: { x: 0.1, y: 0.42, w: 0.8, h: 0.3 }, z: 11 },
      { type: 'title', frame: { x: 0.1, y: 0.85, w: 0.8, h: 0.1 }, z: 12 }, // header stranded below the list
    ]);
    const fixed = enforceReadingOrder(l);
    expect(yOf(fixed, 'eyebrow')).toBeLessThan(yOf(fixed, 'title'));
    expect(yOf(fixed, 'title')).toBeLessThan(yOf(fixed, 'list')); // title now above its list
  });

  it('leaves an already-correct column untouched', () => {
    const l = layout([
      { type: 'title', frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.15 }, z: 10 },
      { type: 'paragraph', frame: { x: 0.1, y: 0.35, w: 0.8, h: 0.4 }, z: 11 },
    ]);
    expect(enforceReadingOrder(l)).toEqual(l);
  });

  it('does not touch side-by-side columns (intentional asymmetry)', () => {
    const l = layout([
      { type: 'paragraph', frame: { x: 0.55, y: 0.2, w: 0.35, h: 0.4 }, z: 10 },
      { type: 'title', frame: { x: 0.08, y: 0.5, w: 0.4, h: 0.2 }, z: 11 }, // lower, but a different column
    ]);
    expect(enforceReadingOrder(l)).toEqual(l);
  });
});
