import { describe, it, expect } from 'vitest';
import { applyFixes } from './critique';

const freeSlide = (): Record<string, any> => ({
  id: 's1',
  order: 0,
  layoutType: 'FreePosition',
  blocks: [
    { type: 'title', text: 'Hi', frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.12 } },
    { type: 'paragraph', text: 'Long', frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.1 } },
  ],
  overrides: {},
});

describe('applyFixes', () => {
  it('grows FreePosition text frames on overflow (monotonic — never shrinks)', () => {
    const slide = freeSlide();
    const before = slide.blocks.map((b: any) => b.frame.h);
    const { issues, applied } = applyFixes(slide, true, null, 'carousel', '1080x1080');
    expect(issues).toContain('text overflow');
    expect(applied).toContain('enlarged text frames');
    slide.blocks.forEach((b: any, i: number) => expect(b.frame.h).toBeGreaterThanOrEqual(before[i]!));
  });

  it('keeps grown frames within the canvas (h ≤ 0.92)', () => {
    const slide = freeSlide();
    slide.blocks[1]!.frame = { x: 0.1, y: 0.05, w: 0.8, h: 0.85 };
    applyFixes(slide, true, null, 'carousel', '1080x1080');
    expect(slide.blocks[1]!.frame.h).toBeLessThanOrEqual(0.92);
  });

  it('does not grow frames on a preset layout, but still flags overflow', () => {
    const slide = { id: 's', order: 0, layoutType: 'TextOnly', blocks: [{ type: 'paragraph', text: 'x' }], overrides: {} };
    const { issues, applied } = applyFixes(slide, true, null, 'carousel', '1080x1080');
    expect(issues).toContain('text overflow');
    expect(applied).not.toContain('enlarged text frames');
  });

  it('swaps theme when the vision pass flags poor contrast', () => {
    const slide = freeSlide();
    slide.overrides = { theme: 'editorial' };
    const { applied } = applyFixes(slide, false, { contrastPoor: true, theme: 'minimal' }, 'carousel', '1080x1080');
    expect(slide.overrides.theme).toBe('minimal');
    expect(applied.some((a) => a.startsWith('theme'))).toBe(true);
  });

  it('does nothing when there is no overflow and no critique', () => {
    const slide = freeSlide();
    const { issues, applied } = applyFixes(slide, false, null, 'carousel', '1080x1080');
    expect(issues).toHaveLength(0);
    expect(applied).toHaveLength(0);
  });
});
