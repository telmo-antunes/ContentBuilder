import { describe, it, expect } from 'vitest';
import { dimensionsFor, safeAreaFor, isValidTypeFormat, isFormat, defaultFormatFor } from './formats';

describe('formats', () => {
  it('returns exact canvas dimensions', () => {
    expect(dimensionsFor('1080x1080')).toEqual({ width: 1080, height: 1080 });
    expect(dimensionsFor('1080x1350')).toEqual({ width: 1080, height: 1350 });
    expect(dimensionsFor('1080x1920')).toEqual({ width: 1080, height: 1920 });
  });

  it('constrains formats to their asset type', () => {
    expect(isValidTypeFormat('carousel', '1080x1080')).toBe(true);
    expect(isValidTypeFormat('carousel', '1080x1350')).toBe(true);
    expect(isValidTypeFormat('carousel', '1080x1920')).toBe(false);
    expect(isValidTypeFormat('story', '1080x1920')).toBe(true);
    expect(isValidTypeFormat('story', '1080x1080')).toBe(false);
  });

  it('reserves Instagram UI space only on stories', () => {
    expect(safeAreaFor('carousel')).toEqual({ padding: 80, topReserve: 0, bottomReserve: 0 });
    expect(safeAreaFor('story')).toEqual({ padding: 80, topReserve: 250, bottomReserve: 250 });
  });

  it('guards format strings', () => {
    expect(isFormat('1080x1080')).toBe(true);
    expect(isFormat('800x600')).toBe(false);
    expect(isFormat(null)).toBe(false);
  });

  it('picks a sensible default format per type', () => {
    expect(defaultFormatFor('carousel')).toBe('1080x1080');
    expect(defaultFormatFor('story')).toBe('1080x1920');
  });
});
