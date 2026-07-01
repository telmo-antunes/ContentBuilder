import { describe, it, expect } from 'vitest';
import { brandColorQuality, contrast, saturation, snapToPalette, heuristicRoles } from './vision';
import type { PaletteColor } from './analyze';

describe('contrast', () => {
  it('is maximal for black on white and minimal for identical colors', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#123456', '#123456')).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrast('#0D1017', '#C9A66B')).toBeCloseTo(contrast('#C9A66B', '#0D1017'), 6);
  });
});

describe('saturation', () => {
  it('is 0 for greys and high for a vivid hue', () => {
    expect(saturation('#808080')).toBe(0);
    expect(saturation('#FFFFFF')).toBe(0);
    expect(saturation('#FF0000')).toBeGreaterThan(0.9);
  });
});

describe('brandColorQuality', () => {
  it('passes a saturated, legible palette', () => {
    const q = brandColorQuality({
      primary: '#C9A66B',
      accent: '#E3C48D',
      secondary: '#4A5568',
      background: '#0D1017',
      text: '#F5F3EF',
    });
    expect(q.ok).toBe(true);
    expect(q.score).toBeGreaterThan(0);
  });
  it('fails a monochrome/grey capture', () => {
    const q = brandColorQuality({
      primary: '#888888',
      accent: '#999999',
      secondary: '#777777',
      background: '#222222',
      text: '#EEEEEE',
    });
    expect(q.ok).toBe(false);
  });
  it('fails when text/background contrast is too low even if saturated', () => {
    const q = brandColorQuality({
      primary: '#FF3B30',
      accent: '#FF9500',
      secondary: '#FF2D55',
      background: '#FF3B30',
      text: '#FF4030',
    });
    expect(q.ok).toBe(false);
  });
});

describe('snapToPalette', () => {
  const palette = ['#0D1017', '#C9A66B', '#4A5568', '#F5F3EF'];
  it('returns an exact match unchanged (normalized)', () => {
    expect(snapToPalette('#c9a66b', palette)).toBe('#C9A66B');
  });
  it('snaps a near hex to the closest palette entry', () => {
    expect(snapToPalette('#CBA870', palette)).toBe('#C9A66B');
  });
  it('rejects a malformed hex', () => {
    expect(snapToPalette('nope', palette)).toBeNull();
  });
});

describe('heuristicRoles', () => {
  it('assigns background to the dominant color and a legible text color', () => {
    const palette: PaletteColor[] = [
      { hex: '#0D1017', population: 5000, hsl: [220, 0.2, 0.07] },
      { hex: '#C9A66B', population: 800, hsl: [38, 0.48, 0.6] },
      { hex: '#F5F3EF', population: 400, hsl: [40, 0.2, 0.95] },
    ];
    const roles = heuristicRoles(palette);
    expect(roles.colors.background).toBe('#0D1017');
    expect(contrast(roles.colors.background, roles.colors.text)).toBeGreaterThan(3);
    expect(roles.provenance).toBe('heuristic');
  });
});
