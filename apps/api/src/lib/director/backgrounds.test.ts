import { describe, it, expect } from 'vitest';
import type { BgColors } from '@contentbuilder/shared';
import { resolveBackground } from './backgrounds';

const COLORS: BgColors = {
  primary: '#34d399',
  secondary: '#10b981',
  accent: '#6ee7b7',
  background: '#0a0b0a',
  text: '#ffffff',
  palette: ['#0a0b0a', '#34d399', '#6ee7b7', '#ffffff'],
};

const bg = (inner: string, base = '#0a0b0a') =>
  `<svg viewBox="0 0 1080 1350"><rect x="0" y="0" width="1080" height="1350" fill="${base}"/>${inner}</svg>`;

describe('resolveBackground', () => {
  it('keeps a clean, legible authored SVG', () => {
    const r = resolveBackground('canvas', bg('<circle cx="540" cy="600" r="200" fill="#34d399" opacity="0.12"/>'), COLORS, '1080x1350', 's');
    expect(r.source).toBe('authored');
    expect(r.svg).toContain('<circle');
  });

  it('falls back to a motif for un-sanitizable input', () => {
    const r = resolveBackground('canvas', 'not an svg at all', COLORS, '1080x1350', 's');
    expect(r.source).toBe('motif');
    expect(r.svg).toMatch(/^<svg/);
    expect(r.svg).toContain('<rect');
  });

  it('falls back to a motif when the authored SVG is illegible (light base under white text)', () => {
    const r = resolveBackground('canvas', bg('<circle cx="1" cy="1" r="1" fill="#111"/>', '#f5f0e8'), COLORS, '1080x1350', 's');
    expect(r.source).toBe('motif');
  });

  it('falls back to a motif when missing', () => {
    expect(resolveBackground('texture', undefined, COLORS, '1080x1350', 's').source).toBe('motif');
  });

  it('is role-aware: a bold field passes as statement but is rejected as canvas', () => {
    const bold = bg('<rect x="0" y="0" width="600" height="1350" fill="#34d399"/>'); // full-opacity brand field
    expect(resolveBackground('statement', bold, COLORS, '1080x1350', 's').source).toBe('authored');
    expect(resolveBackground('canvas', bold, COLORS, '1080x1350', 's').source).toBe('motif');
  });
});
