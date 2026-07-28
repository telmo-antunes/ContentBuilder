import { describe, it, expect } from 'vitest';
import { sanitizeAuthoredHtml } from './htmlSanitize';

describe('sanitizeAuthoredHtml', () => {
  it('keeps allowed tags and the class attribute', () => {
    const html = '<p class="eyebrow">Mindset</p><h1 class="headline">Recovery beats grit</h1>';
    expect(sanitizeAuthoredHtml(html)).toBe(html);
  });

  it('keeps a signature emphasis span', () => {
    const html = '<h1 class="headline">Every job on <span class="it">one screen.</span></h1>';
    expect(sanitizeAuthoredHtml(html)).toBe(html);
  });

  it('strips <script> blocks entirely', () => {
    const out = sanitizeAuthoredHtml('<div class="a">hi</div><script>alert(1)</script>');
    expect(out).toBe('<div class="a">hi</div>');
    expect(out).not.toContain('alert');
  });

  it('strips <style> blocks (styling belongs to the recipe)', () => {
    const out = sanitizeAuthoredHtml('<style>.x{color:red}</style><p class="body">ok</p>');
    expect(out).toBe('<p class="body">ok</p>');
  });

  it('removes event handlers', () => {
    const out = sanitizeAuthoredHtml('<div class="a" onclick="steal()">x</div>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('class="a"');
  });

  it('removes inline style and id attributes', () => {
    const out = sanitizeAuthoredHtml('<div class="a" style="position:fixed" id="pwn">x</div>');
    expect(out).toBe('<div class="a">x</div>');
  });

  it('drops disallowed tags but keeps their text', () => {
    const out = sanitizeAuthoredHtml('<marquee>run</marquee><iframe src="x"></iframe>done');
    expect(out).toBe('rundone');
  });

  it('rejects javascript: hrefs, keeps the anchor text', () => {
    const out = sanitizeAuthoredHtml('<a class="cta" href="javascript:alert(1)">Go</a>');
    expect(out).toBe('<a class="cta">Go</a>');
  });

  it('allows https and relative hrefs', () => {
    expect(sanitizeAuthoredHtml('<a href="https://x.com">y</a>')).toBe('<a href="https://x.com">y</a>');
    expect(sanitizeAuthoredHtml('<a href="/path">y</a>')).toBe('<a href="/path">y</a>');
  });

  it('allows image data URIs and https on img, rejects others', () => {
    expect(sanitizeAuthoredHtml('<img class="logo" src="data:image/png;base64,AAAA">')).toContain(
      'src="data:image/png;base64,AAAA"',
    );
    expect(sanitizeAuthoredHtml('<img src="https://x/y.png">')).toContain('src="https://x/y.png"');
    expect(sanitizeAuthoredHtml('<img src="data:text/html,<b>x">')).not.toContain('src=');
  });

  it('handles void tags without a bogus closer', () => {
    expect(sanitizeAuthoredHtml('a<br>b')).toBe('a<br>b');
    expect(sanitizeAuthoredHtml('a<br/>b')).toBe('a<br>b');
  });

  it('neutralises an obfuscated handler that survives tag parsing', () => {
    const out = sanitizeAuthoredHtml('<div class="a"\nonmouseover="x()">z</div>');
    expect(out).not.toMatch(/onmouseover=/i);
  });

  it('returns empty string for empty/junk input', () => {
    expect(sanitizeAuthoredHtml('')).toBe('');
    expect(sanitizeAuthoredHtml('<script>bad()</script>')).toBe('');
  });

  // ── image placeholders (data-cb-slot) ────────────────────────────────────
  // The slot name reaches a CSS attribute selector at render time, so it is
  // re-validated here rather than trusted from model output.
  describe('image slots', () => {
    it('keeps a well-formed slot on a container tag', () => {
      const out = sanitizeAuthoredHtml('<figure class="cb-shot" data-cb-slot="hero"></figure>');
      expect(out).toBe('<figure class="cb-shot" data-cb-slot="hero"></figure>');
    });

    it('lowercases the slot name so it matches the render selector', () => {
      expect(sanitizeAuthoredHtml('<figure data-cb-slot="Hero"></figure>')).toContain(
        'data-cb-slot="hero"',
      );
    });

    it('drops a slot name that could break out of the selector', () => {
      const out = sanitizeAuthoredHtml('<figure data-cb-slot="a&quot;] , [b"></figure>');
      expect(out).not.toContain('data-cb-slot');
    });

    it('drops a slot name with spaces or punctuation', () => {
      expect(sanitizeAuthoredHtml('<figure data-cb-slot="two words"></figure>')).not.toContain(
        'data-cb-slot',
      );
      expect(sanitizeAuthoredHtml('<div data-cb-slot="a.b"></div>')).not.toContain('data-cb-slot');
    });

    it('does not let the attribute ride on an arbitrary tag', () => {
      // An <img> already takes a src; a slot there would be two competing sources.
      expect(sanitizeAuthoredHtml('<img data-cb-slot="hero">')).not.toContain('data-cb-slot');
      expect(sanitizeAuthoredHtml('<h1 data-cb-slot="hero">x</h1>')).not.toContain('data-cb-slot');
    });

    it('still refuses every other data- attribute', () => {
      expect(sanitizeAuthoredHtml('<figure data-cb-other="x"></figure>')).not.toContain('data-cb-other');
      expect(sanitizeAuthoredHtml('<figure data-evil="x"></figure>')).not.toContain('data-evil');
    });
  });
});
