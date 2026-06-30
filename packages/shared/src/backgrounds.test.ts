import { describe, it, expect } from 'vitest';
import { buildBrandBackgrounds } from './backgrounds';

const COLORS = {
  primary: '#C49444',
  secondary: '#B08F5D',
  accent: '#D4BC8C',
  background: '#4D3C24',
  text: '#DED6CA',
  palette: ['#4D3C24', '#B08F5D', '#C49444', '#D4BC8C', '#DED6CA'],
};

describe('buildBrandBackgrounds', () => {
  it('returns the three distinct styles', () => {
    const bgs = buildBrandBackgrounds(COLORS);
    expect(bgs.map((b) => b.id)).toEqual(['mesh', 'livery', 'orbs']);
    expect(bgs.every((b) => b.label.length > 0)).toBe(true);
  });

  it('emits valid SVG seeded with palette colours', () => {
    for (const b of buildBrandBackgrounds(COLORS)) {
      expect(b.svg.startsWith('<svg')).toBe(true);
      expect(b.svg).toContain('</svg>');
      expect(b.svg).toContain('viewBox="0 0 1080 1350"');
      // Styles blend the palette, so assert it carries hex colours (not a fixed one).
      expect(b.svg).toMatch(/#[0-9a-fA-F]{6}/);
    }
  });

  it('does not throw on short/invalid hex', () => {
    expect(() => buildBrandBackgrounds({ primary: '#fff', secondary: '', accent: 'x', background: '#000' })).not.toThrow();
  });
});
