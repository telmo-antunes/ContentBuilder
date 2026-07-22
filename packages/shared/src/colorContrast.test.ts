import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio, hexToRgb, AA_TEXT, AA_LARGE } from './colorContrast';

describe('colorContrast', () => {
  it('parses hex forms', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('not-a-color')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('computes WCAG relative luminance at the extremes', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    // mid grey is nowhere near 0.5 (gamma), sanity check it's below
    expect(relativeLuminance('#808080')).toBeLessThan(0.3);
  });

  it('black vs white is the maximal 21:1 ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
  });

  it('identical colors are 1:1 and order-independent', () => {
    expect(contrastRatio('#34d399', '#34d399')).toBeCloseTo(1, 5);
  });

  it('white text on a near-black brand background clears AA', () => {
    expect(contrastRatio('#ffffff', '#0a0b0a')).toBeGreaterThan(AA_TEXT);
  });

  it('white text on a light cream background fails AA', () => {
    expect(contrastRatio('#ffffff', '#f5f0e8')).toBeLessThan(AA_LARGE);
  });
});
