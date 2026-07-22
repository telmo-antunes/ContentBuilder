import { describe, it, expect } from 'vitest';
import { sanitizeSvgBackground, sanitizeSvgBackgroundEx, sanitizeSvgUpload } from './svgSanitize';

const POST = { width: 1080, height: 1350 };
const STORY = { width: 1080, height: 1920 };

/** A minimal valid background: full-canvas base rect + one shape. */
const bg = (inner: string, w = 1080, h = 1350) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" fill="#0a0b0a"/>${inner}</svg>`;

describe('sanitizeSvgBackground', () => {
  it('accepts a clean background and re-wraps with a format-aware root', () => {
    const out = sanitizeSvgBackground(bg('<circle cx="540" cy="600" r="240" fill="#34d399"/>'), POST);
    expect(out).toBeTruthy();
    expect(out).toContain('viewBox="0 0 1080 1350"');
    expect(out).toContain('<circle');
    expect(out).toContain('#34d399');
  });

  it('uses story dimensions when asked', () => {
    const out = sanitizeSvgBackground(bg('<circle cx="540" cy="900" r="240" fill="#34d399"/>', 1080, 1920), STORY);
    expect(out).toContain('viewBox="0 0 1080 1920"');
  });

  it('strips <script> and its payload', () => {
    const out = sanitizeSvgBackground(
      bg('<script>fetch("//evil")</script><rect x="100" y="100" width="200" height="200" fill="#111"/>'),
      POST,
    );
    expect(out).toBeTruthy();
    expect(out!.toLowerCase()).not.toContain('script');
    expect(out).not.toContain('evil');
  });

  it('strips event handlers, foreignObject, and inline style attributes', () => {
    const out = sanitizeSvgBackground(
      bg('<rect x="1" y="1" width="10" height="10" fill="#222" onload="x()" style="fill:red"/><foreignObject><body/></foreignObject>'),
      POST,
    );
    expect(out).toBeTruthy();
    expect(out!.toLowerCase()).not.toContain('onload');
    expect(out!.toLowerCase()).not.toContain('style=');
    expect(out!.toLowerCase()).not.toContain('foreignobject');
  });

  it('neutralizes external url() references', () => {
    const out = sanitizeSvgBackground(bg('<rect x="1" y="1" width="10" height="10" fill="url(http://evil/x.png)"/>'), POST);
    expect(out).toBeTruthy();
    expect(out).not.toContain('evil');
  });

  it('rejects unknown elements (element allowlist)', () => {
    expect(sanitizeSvgBackground(bg('<blink></blink>'), POST)).toBeNull();
  });

  it('rejects when there is no full-canvas base coat', () => {
    const noBase = '<svg viewBox="0 0 1080 1350"><circle cx="540" cy="600" r="200" fill="#34d399"/></svg>';
    expect(sanitizeSvgBackground(noBase, POST)).toBeNull();
  });

  it('rejects when the first rect does not cover the canvas', () => {
    const small = '<svg viewBox="0 0 1080 1350"><rect x="0" y="0" width="500" height="500" fill="#0a0b0a"/></svg>';
    expect(sanitizeSvgBackground(small, POST)).toBeNull();
  });

  it('rejects a base rect without a solid hex fill', () => {
    const grad = '<svg viewBox="0 0 1080 1350"><rect x="0" y="0" width="1080" height="1350" fill="url(#g)"/></svg>';
    expect(sanitizeSvgBackground(grad, POST)).toBeNull();
  });

  it('rejects prose with no <svg>', () => {
    expect(sanitizeSvgBackground('here is your background', POST)).toBeNull();
  });

  it('respects the byte cap', () => {
    const huge = bg('<circle cx="1" cy="1" r="1" fill="#111"/>'.repeat(1) + 'x'.repeat(0));
    expect(sanitizeSvgBackground(huge, { ...POST, maxBytes: 5 })).toBeNull();
  });

  it('exposes the base-coat fill via the Ex variant', () => {
    const ex = sanitizeSvgBackgroundEx(bg('<circle cx="540" cy="600" r="240" fill="#34d399"/>'), POST);
    expect(ex?.baseFill).toBe('#0a0b0a');
  });
});

describe('sanitizeSvgUpload (logo-safe)', () => {
  it('preserves the file viewBox and text, strips script + handlers', () => {
    const logo = '<svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg"><text x="0" y="40" onclick="x()">ACME</text><script>steal()</script></svg>';
    const out = sanitizeSvgUpload(logo);
    expect(out).toBeTruthy();
    expect(out).toContain('viewBox="0 0 200 60"');
    expect(out).toContain('ACME');
    expect(out!.toLowerCase()).not.toContain('script');
    expect(out!.toLowerCase()).not.toContain('onclick');
    expect(out).not.toContain('steal');
  });

  it('keeps internal #fragment href but drops external href', () => {
    const svg = '<svg viewBox="0 0 10 10"><use href="#a"/><image href="http://evil/x.png"/></svg>';
    const out = sanitizeSvgUpload(svg);
    expect(out).toBeTruthy();
    expect(out).toContain('href="#a"');
    expect(out).not.toContain('evil');
  });

  it('returns null for non-SVG input', () => {
    expect(sanitizeSvgUpload('<html><body>nope</body></html>')).toBeNull();
  });
});
