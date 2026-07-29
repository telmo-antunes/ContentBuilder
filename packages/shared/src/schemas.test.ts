import { describe, expect, it } from 'vitest';
import { slideSchema } from './schemas';

describe('slideSchema (authored-first)', () => {
  it('parses an authored slide and keeps the live override fields', () => {
    const parsed = slideSchema.safeParse({
      id: 's1',
      order: 0,
      authored: { html: '<h1 class="headline">Hi</h1>', bg: 'photo', role: 'cover' },
      overrides: { theme: 'bold', focalPoint: { x: 0.4, y: 0.6 }, imageTreatment: 'tint' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.authored?.html).toContain('headline');
      expect(parsed.data.overrides?.theme).toBe('bold');
      expect(parsed.data.overrides?.focalPoint).toEqual({ x: 0.4, y: 0.6 });
    }
  });

  it('tolerates a block-era slide by STRIPPING its legacy fields', () => {
    // A stored version snapshot from the old layout engine must restore
    // without crashing — the retired fields are dropped at the wire boundary.
    const parsed = slideSchema.safeParse({
      id: 'legacy',
      order: 1,
      layoutType: 'SplitImageText',
      blocks: [{ type: 'title', text: 'Old copy' }],
      imageNeed: 'upload',
      overrides: {
        theme: 'soft',
        split: 'image-left',
        imageZoom: 2,
        imageBackground: true,
        decorations: [{ kind: 'scrim', frame: { x: 0, y: 0, w: 1, h: 1 } }],
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>;
      expect(data.layoutType).toBeUndefined();
      expect(data.blocks).toBeUndefined();
      expect(parsed.data.imageNeed).toBe('upload'); // still a live field
      const overrides = parsed.data.overrides as Record<string, unknown>;
      expect(overrides.theme).toBe('soft');
      expect(overrides.split).toBeUndefined();
      expect(overrides.imageZoom).toBeUndefined();
      expect(overrides.decorations).toBeUndefined();
    }
  });

  it('rejects a malformed authored payload', () => {
    expect(slideSchema.safeParse({ id: 's1', authored: { bg: 'photo' } }).success).toBe(false);
  });
});
