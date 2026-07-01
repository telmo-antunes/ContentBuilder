import { describe, it, expect } from 'vitest';
import { buildBrandBackgrounds, renderMotif, MOTIF_CATALOG } from './backgrounds';

const COLORS = {
  primary: '#C49444',
  secondary: '#B08F5D',
  accent: '#D4BC8C',
  background: '#4D3C24',
  text: '#DED6CA',
  palette: ['#4D3C24', '#B08F5D', '#C49444', '#D4BC8C', '#DED6CA'],
};

describe('buildBrandBackgrounds', () => {
  it('defaults to three backgrounds from the generic family', () => {
    const bgs = buildBrandBackgrounds(COLORS);
    expect(bgs).toHaveLength(3);
    expect(bgs.map((b) => b.id)).toEqual(['other-mesh-0', 'other-livery-1', 'other-orbs-2']);
    expect(bgs.every((b) => b.label.length > 0)).toBe(true);
  });

  it('emits valid SVG seeded with palette colours', () => {
    for (const b of buildBrandBackgrounds(COLORS, { category: 'local-service', seed: 'biz1' })) {
      expect(b.svg.startsWith('<svg')).toBe(true);
      expect(b.svg).toContain('</svg>');
      expect(b.svg).toContain('viewBox="0 0 1080 1350"');
      expect(b.svg).toMatch(/#[0-9a-fA-F]{6}/);
    }
  });

  it('selects motifs by vertical (category)', () => {
    const svc = buildBrandBackgrounds(COLORS, { category: 'local-service' }).map((b) => b.id);
    const saas = buildBrandBackgrounds(COLORS, { category: 'saas-product' }).map((b) => b.id);
    expect(svc).toEqual(['local-service-livery-0', 'local-service-speedlines-1', 'local-service-shine-2']);
    expect(saas).toEqual(['saas-product-dotgrid-0', 'saas-product-nodenet-1', 'saas-product-panels-2']);
  });

  it('is deterministic per seed but unique across businesses', () => {
    const a1 = buildBrandBackgrounds(COLORS, { category: 'local-service', seed: 'bizA' });
    const a2 = buildBrandBackgrounds(COLORS, { category: 'local-service', seed: 'bizA' });
    const b1 = buildBrandBackgrounds(COLORS, { category: 'local-service', seed: 'bizB' });
    expect(a1.map((b) => b.svg)).toEqual(a2.map((b) => b.svg)); // same seed → identical
    expect(a1.map((b) => b.svg)).not.toEqual(b1.map((b) => b.svg)); // different seed → different
  });

  it('honours a business-chosen count (wrapping the family)', () => {
    const bgs = buildBrandBackgrounds(COLORS, { category: 'saas-product', count: 5, seed: 'x' });
    expect(bgs).toHaveLength(5);
    // 4th & 5th reuse the family motifs but must differ from the 1st & 2nd.
    expect(bgs[3]!.svg).not.toEqual(bgs[0]!.svg);
    expect(bgs[4]!.svg).not.toEqual(bgs[1]!.svg);
  });

  it('does not throw on short/invalid hex', () => {
    expect(() => buildBrandBackgrounds({ primary: '#fff', secondary: '', accent: 'x', background: '#000' })).not.toThrow();
  });
});

const NEAR_BLACK = {
  primary: '#C9A66B',
  secondary: '#4A5568',
  accent: '#E3C48D',
  background: '#000000',
  text: '#F5F3EF',
  palette: ['#000000', '#1A1F29', '#C9A66B', '#E3C48D'],
};

describe('renderMotif', () => {
  it('renders every catalog motif to valid, seeded SVG (light + near-black palettes)', () => {
    expect(MOTIF_CATALOG.length).toBe(15);
    for (const m of MOTIF_CATALOG) {
      for (const colors of [COLORS, NEAR_BLACK]) {
        const bg = renderMotif(m.id, colors, { seed: 'seed-1' });
        expect(bg, `motif ${m.id}`).not.toBeNull();
        expect(bg!.svg.startsWith('<svg')).toBe(true);
        expect(bg!.svg).toContain('</svg>');
        expect(bg!.svg).toMatch(/#[0-9a-fA-F]{6}/);
        expect(bg!.id).toBe(m.id);
      }
    }
  });

  it('returns null for an unknown motif id', () => {
    expect(renderMotif('not-a-motif', COLORS, { seed: 'x' })).toBeNull();
  });

  it('is deterministic for a fixed seed (snapshot)', () => {
    expect(renderMotif('mesh', COLORS, { seed: 'snap' })!.svg).toMatchSnapshot();
    expect(renderMotif('dotgrid', COLORS, { seed: 'snap' })!.svg).toMatchSnapshot();
    expect(renderMotif('waves', COLORS, { seed: 'snap' })!.svg).toMatchSnapshot();
  });
});
