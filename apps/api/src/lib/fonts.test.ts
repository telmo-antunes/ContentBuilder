import { describe, expect, it, vi } from 'vitest';
import { cleanFontFamily, isGenericFont, resolveRenderFonts } from './fonts';

describe('cleanFontFamily', () => {
  it('takes the first family and strips quotes', () => {
    expect(cleanFontFamily('"Playfair Display", Georgia, serif')).toBe('Playfair Display');
    expect(cleanFontFamily("'Open Sans', sans-serif")).toBe('Open Sans');
  });

  it('unmangles Next.js internal font tokens', () => {
    expect(cleanFontFamily('__Playfair_Display_eea437')).toBe('Playfair Display');
    expect(cleanFontFamily('__DM_Sans_abc123, sans-serif')).toBe('DM Sans');
  });

  it('handles empty input', () => {
    expect(cleanFontFamily(undefined)).toBe('');
    expect(cleanFontFamily('')).toBe('');
  });
});

describe('isGenericFont', () => {
  it('flags platform defaults, case-insensitively', () => {
    expect(isGenericFont('Arial')).toBe(true);
    expect(isGenericFont('-apple-system')).toBe(true);
    expect(isGenericFont('DM Sans')).toBe(false);
  });
});

describe('resolveRenderFonts', () => {
  const mapped = { heading: 'Montserrat', body: 'Inter' };

  it('prefers the site font when available on Google Fonts', async () => {
    const available = vi.fn(async () => true);
    const r = await resolveRenderFonts(
      { heading: '"DM Sans", sans-serif', body: '"Karla", sans-serif' },
      mapped,
      available,
    );
    expect(r.render).toEqual({ heading: 'DM Sans', body: 'Karla' });
    expect(r.usesSiteFont).toBe(true);
  });

  it('keeps the mapped font when the site font is not on Google Fonts', async () => {
    const available = vi.fn(async () => false);
    const r = await resolveRenderFonts(
      { heading: 'SomeProprietaryFace', body: 'AnotherPaidFont' },
      mapped,
      available,
    );
    expect(r.render).toEqual(mapped);
    expect(r.usesSiteFont).toBe(false);
  });

  it('never treats a generic/system font as a brand font', async () => {
    const available = vi.fn(async () => true);
    const r = await resolveRenderFonts(
      { heading: 'Arial, sans-serif', body: '-apple-system, sans-serif' },
      mapped,
      available,
    );
    expect(r.render).toEqual(mapped);
    expect(available).not.toHaveBeenCalled();
  });

  it('uses a bundled family directly without a network check', async () => {
    const available = vi.fn(async () => true);
    const r = await resolveRenderFonts(
      { heading: '"Playfair Display", serif', body: '' },
      mapped,
      available,
    );
    expect(r.render.heading).toBe('Playfair Display');
    expect(r.render.body).toBe('Inter');
    expect(r.usesSiteFont).toBe(false);
    expect(available).not.toHaveBeenCalled();
  });
});
