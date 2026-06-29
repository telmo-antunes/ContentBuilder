import { describe, it, expect } from 'vitest';
import { repairFrame, extractSlides } from './draft';

describe('repairFrame', () => {
  it('passes a valid in-bounds frame through unchanged', () => {
    expect(repairFrame({ x: 0.1, y: 0.2, w: 0.6, h: 0.3 }, 0)).toEqual({ x: 0.1, y: 0.2, w: 0.6, h: 0.3 });
  });

  it('clamps out-of-range values into [0,1]', () => {
    const f = repairFrame({ x: -0.5, y: 2, w: 5, h: -1 }, 0);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.y).toBeGreaterThanOrEqual(0);
    expect(f.w).toBeGreaterThan(0);
    expect(f.w).toBeLessThanOrEqual(1);
    expect(f.h).toBeGreaterThan(0);
  });

  it('keeps the rectangle inside the canvas (x+w ≤ 1, y+h ≤ 1)', () => {
    const f = repairFrame({ x: 0.9, y: 0.95, w: 0.5, h: 0.4 }, 0);
    expect(f.x + f.w).toBeLessThanOrEqual(1.0001);
    expect(f.y + f.h).toBeLessThanOrEqual(1.0001);
  });

  it('falls back to defaults for garbage input', () => {
    const f = repairFrame(undefined, 0);
    expect(f.w).toBeGreaterThan(0);
    expect(f.h).toBeGreaterThan(0);
    expect(f.x).toBeGreaterThanOrEqual(0);
  });
});

describe('extractSlides (free mode)', () => {
  it('forces FreePosition and repairs frames so a slightly-off slide is not dropped', () => {
    const raw = JSON.stringify([
      {
        order: 0,
        layoutType: 'WrongLayout',
        imageNeed: 'none',
        blocks: [{ type: 'title', text: 'Hi', frame: { x: 1.4, y: 0.1, w: 0.8, h: 0.2 }, z: 1 }],
      },
    ]);
    const slides = extractSlides(raw, 'free');
    expect(slides).toHaveLength(1);
    expect(slides[0]!.layoutType).toBe('FreePosition');
    const fr = slides[0]!.blocks[0]!.frame!;
    expect(fr.x + fr.w).toBeLessThanOrEqual(1.0001); // repaired back in-bounds
  });

  it('repairs an out-of-range imageFrame instead of dropping the slide', () => {
    const raw = JSON.stringify([
      {
        order: 0,
        layoutType: 'FreePosition',
        imageNeed: 'upload',
        overrides: { imageFrame: { x: 0.1, y: 0.1, w: 2, h: 0.5 } },
        blocks: [{ type: 'title', text: 'Over an image', frame: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 }, z: 1 }],
      },
    ]);
    const slides = extractSlides(raw, 'free');
    expect(slides).toHaveLength(1);
    const imgf = slides[0]!.overrides?.imageFrame!;
    expect(imgf.w).toBeLessThanOrEqual(1);
  });

  it('coerces any object into a FreePosition slide (free mode forces the layout)', () => {
    const slides = extractSlides(JSON.stringify([{ garbage: true }]), 'free');
    expect(slides).toHaveLength(1);
    expect(slides[0]!.layoutType).toBe('FreePosition');
  });

  it('throws when the model returns no JSON array', () => {
    expect(() => extractSlides('sorry, I cannot do that', 'free')).toThrow();
  });
});

describe('extractSlides (designer mode)', () => {
  it('drops slides with an invalid layout but keeps the valid ones', () => {
    const raw = JSON.stringify([
      { order: 0, layoutType: 'NotALayout', blocks: [] },
      { order: 1, layoutType: 'Cover', blocks: [{ type: 'title', text: 'Hi' }] },
    ]);
    const slides = extractSlides(raw, 'designer');
    expect(slides).toHaveLength(1);
    expect(slides[0]!.layoutType).toBe('Cover');
  });

  it('drops blocks with an invalid type via the allowlist', () => {
    const raw = JSON.stringify([
      { order: 0, layoutType: 'TextOnly', blocks: [{ type: 'not-a-block', text: 'x' }] },
    ]);
    // an invalid block type fails the slide's schema → the whole slide is dropped
    expect(extractSlides(raw, 'designer')).toHaveLength(0);
  });
});
