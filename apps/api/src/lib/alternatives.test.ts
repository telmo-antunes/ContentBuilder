import { describe, expect, it } from 'vitest';
import { mergeVariant } from './alternatives';
import type { SlideInput } from './validation';

const designerSlide: SlideInput = {
  id: 's1',
  order: 0,
  layoutType: 'Statement',
  imageNeed: 'none',
  blocks: [{ type: 'title', text: 'EVERY SINGLE DETAIL' }],
} as SlideInput;

const freeSlide: SlideInput = {
  id: 's2',
  order: 0,
  layoutType: 'FreePosition',
  imageNeed: 'none',
  blocks: [
    { type: 'title', text: 'Hello', frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }, z: 10 },
    { type: 'paragraph', text: 'World', frame: { x: 0.1, y: 0.35, w: 0.8, h: 0.1 }, z: 11 },
  ],
} as SlideInput;

describe('mergeVariant (designer)', () => {
  it('applies layoutType + valid overrides, keeps copy verbatim', () => {
    const m = mergeVariant(designerSlide, { layoutType: 'Quote', overrides: { theme: 'minimal' } }, false);
    expect(m?.layoutType).toBe('Quote');
    expect(m?.overrides?.theme).toBe('minimal');
    expect(m?.blocks[0]!.text).toBe('EVERY SINGLE DETAIL');
  });

  it('drops invalid override VALUES but keeps the variant', () => {
    const m = mergeVariant(
      designerSlide,
      { layoutType: 'Cover', overrides: { theme: 'dark', imageTreatment: 'gradient' } },
      false,
    );
    expect(m?.layoutType).toBe('Cover');
    expect(m?.overrides?.theme).toBeUndefined();
    expect(m?.overrides?.imageTreatment).toBeUndefined();
  });

  it('sets imageNeed to upload for image layouts', () => {
    const m = mergeVariant(designerSlide, { layoutType: 'BackgroundImage' }, false);
    expect(m?.imageNeed).toBe('upload');
  });

  it('rejects unknown layout types', () => {
    expect(mergeVariant(designerSlide, { layoutType: 'MemeGrid' }, false)).toBeNull();
    expect(mergeVariant(designerSlide, { layoutType: 'FreePosition' }, false)).toBeNull();
  });
});

describe('mergeVariant (free)', () => {
  it('re-frames blocks by index, keeps text', () => {
    const m = mergeVariant(
      freeSlide,
      {
        blocks: [
          { frame: { x: 0.1, y: 0.6, w: 0.8, h: 0.2 }, z: 12 },
          { frame: { x: 0.1, y: 0.85, w: 0.8, h: 0.08 } },
        ],
      },
      true,
    );
    expect(m?.blocks[0]!.frame?.y).toBeCloseTo(0.6);
    expect(m?.blocks[0]!.text).toBe('Hello');
    expect(m?.blocks[1]!.z).toBe(11); // default 10 + i when variant omits z
  });

  it('rejects a variant with the wrong block count', () => {
    const m = mergeVariant(freeSlide, { blocks: [{ frame: { x: 0, y: 0, w: 1, h: 1 } }] }, true);
    expect(m).toBeNull();
  });

  it('imageBackground wins over imageFrame', () => {
    const m = mergeVariant(
      freeSlide,
      {
        blocks: [
          { frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 } },
          { frame: { x: 0.1, y: 0.4, w: 0.8, h: 0.1 } },
        ],
        imageFrame: { x: 0, y: 0, w: 1, h: 0.5 },
        imageBackground: true,
      },
      true,
    );
    expect(m?.overrides?.imageBackground).toBe(true);
    expect(m?.overrides?.imageFrame).toBeUndefined();
  });
});
