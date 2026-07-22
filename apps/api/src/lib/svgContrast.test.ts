import { describe, it, expect } from 'vitest';
import { checkBackgroundLegibility } from './svgContrast';

const base = (fill: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"><rect x="0" y="0" width="1080" height="1350" fill="${fill}"/>${extra}</svg>`;

describe('checkBackgroundLegibility', () => {
  it('passes a dark base with white text', () => {
    const r = checkBackgroundLegibility(base('#0a0b0a'), '#ffffff');
    expect(r.ok).toBe(true);
    expect(r.offenders).toHaveLength(0);
    expect(r.worst).toBeGreaterThan(4.5);
  });

  it('fails a light base coat under white text', () => {
    const r = checkBackgroundLegibility(base('#f5f0e8'), '#ffffff');
    expect(r.ok).toBe(false);
    expect(r.offenders.join(' ')).toMatch(/base coat/);
  });

  it('fails when a high-opacity light shape sits under white text', () => {
    const r = checkBackgroundLegibility(
      base('#0a0b0a', '<rect x="100" y="100" width="400" height="400" fill="#eeeeee" opacity="0.85"/>'),
      '#ffffff',
    );
    expect(r.ok).toBe(false);
  });

  it('ignores a low-opacity shape (<0.25)', () => {
    const r = checkBackgroundLegibility(
      base('#0a0b0a', '<rect x="100" y="100" width="400" height="400" fill="#eeeeee" opacity="0.1"/>'),
      '#ffffff',
    );
    expect(r.ok).toBe(true);
  });

  it('checks gradient stops', () => {
    const r = checkBackgroundLegibility(
      base('#0a0b0a', '<defs><linearGradient id="g"><stop offset="0" stop-color="#f2f2f2" stop-opacity="0.9"/></linearGradient></defs>'),
      '#ffffff',
    );
    expect(r.ok).toBe(false);
  });

  it('reports no base coat when the first rect lacks a solid fill', () => {
    const r = checkBackgroundLegibility('<svg viewBox="0 0 1080 1350"><rect fill="url(#g)"/></svg>', '#ffffff');
    expect(r.ok).toBe(false);
    expect(r.offenders.join(' ')).toMatch(/base-coat/);
  });
});
