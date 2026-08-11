import { describe, expect, it } from 'vitest';
import { normalizeMediaUrl } from './index';

describe('normalizeMediaUrl', () => {
  it('strips the origin from legacy absolute media URLs', () => {
    expect(normalizeMediaUrl('http://localhost:4000/media/seed/apex-logo.png')).toBe(
      '/media/seed/apex-logo.png',
    );
    expect(normalizeMediaUrl('http://127.0.0.1:4100/media/uploads/abc.png')).toBe(
      '/media/uploads/abc.png',
    );
    expect(normalizeMediaUrl('https://cdn.example.com/media/x.png')).toBe('/media/x.png');
  });

  it('is idempotent — already-relative URLs pass through', () => {
    expect(normalizeMediaUrl('/media/seed/apex-logo.png')).toBe('/media/seed/apex-logo.png');
    expect(normalizeMediaUrl(normalizeMediaUrl('http://localhost:4000/media/a.png'))).toBe(
      '/media/a.png',
    );
  });

  it('leaves non-media URLs untouched', () => {
    const remote = 'https://images.pexels.com/photos/1/car.jpg';
    expect(normalizeMediaUrl(remote)).toBe(remote);

    const dataUri = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    expect(normalizeMediaUrl(dataUri)).toBe(dataUri);

    // "/media/" appearing deeper in a path is not an origin prefix.
    expect(normalizeMediaUrl('/uploads/media/x.png')).toBe('/uploads/media/x.png');
    expect(normalizeMediaUrl('https://example.com/assets/media/x.png')).toBe(
      'https://example.com/assets/media/x.png',
    );
  });

  it('passes through empty and nullish values', () => {
    expect(normalizeMediaUrl('')).toBe('');
    expect(normalizeMediaUrl(undefined)).toBeUndefined();
    expect(normalizeMediaUrl(null)).toBeNull();
  });
});
