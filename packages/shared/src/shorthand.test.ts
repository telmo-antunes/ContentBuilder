import { describe, it, expect } from 'vitest';
import { parseShorthand } from './shorthand';

describe('parseShorthand', () => {
  it('parses layout hints, blocks, and image intent, preserving copy verbatim', () => {
    const { slides } = parseShorthand(
      'Slide 1: cover, eyebrow: HELLO, title: A new job just landed, now what?\n' +
        'Slide 2: centered image, title: Every booking in one place, image',
    );
    expect(slides).toHaveLength(2);
    expect(slides[0]!.layoutType).toBe('Cover');
    // the comma inside the title is kept (fragment continuation), not split into blocks
    expect(slides[0]!.blocks.find((b) => b.type === 'title')?.text).toBe(
      'A new job just landed, now what?',
    );
    expect(slides[1]!.layoutType).toBe('CenteredHero');
    expect(slides[1]!.imageNeed).toBe('upload');
  });

  it('splits a list block into items', () => {
    const { slides } = parseShorthand('Slide 1: text only, list: alpha | beta | gamma');
    const list = slides[0]!.blocks.find((b) => b.type === 'list');
    expect(list?.items).toEqual(['alpha', 'beta', 'gamma']);
    expect(list?.text).toBe('');
  });

  it('warns on unknown block types but still parses the rest', () => {
    const { slides, warnings } = parseShorthand('Slide 1: cover, nonsense: x, title: Real Title');
    expect(slides[0]!.blocks.find((b) => b.type === 'title')?.text).toBe('Real Title');
    expect(slides[0]!.blocks.some((b) => (b.type as string) === 'nonsense')).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('defaults the first untyped slide to Cover and ignores blank lines', () => {
    const { slides } = parseShorthand('\n\ntitle: Just a title\n\n');
    expect(slides).toHaveLength(1);
    expect(slides[0]!.layoutType).toBe('Cover');
  });
});
