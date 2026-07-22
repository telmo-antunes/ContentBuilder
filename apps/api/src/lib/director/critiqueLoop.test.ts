import { describe, it, expect } from 'vitest';
import type { BrandLayout } from '@contentbuilder/shared';
import { parseVerdicts, applyBoundedFixes } from './critiqueLoop';

const layout = (over: Partial<BrandLayout> = {}): BrandLayout => ({
  name: 'Cover',
  purpose: 'cover',
  imageNeed: 'none',
  backgroundRole: 'statement',
  backgroundMediaAssetId: 'bg',
  blocks: [
    { type: 'title', frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }, z: 10 },
    { type: 'eyebrow', frame: { x: 0.1, y: 0.05, w: 0.5, h: 0.05 }, z: 9 },
  ],
  ...over,
});

describe('parseVerdicts', () => {
  it('slots verdicts by index and clamps fix magnitudes', () => {
    const raw = JSON.stringify([
      { index: 0, score: 8, fixes: [{ op: 'nudge', block: 0, dx: 0.2, dy: -0.03 }] },
      { index: 1, score: 3, backgroundFights: true, fixes: [] },
    ]);
    const v = parseVerdicts(raw, 2);
    expect(v[0]?.score).toBe(8);
    expect(v[0]?.fixes[0]?.dx).toBe(0.05); // 0.2 clamped to +0.05
    expect(v[0]?.fixes[0]?.dy).toBeCloseTo(-0.03);
    expect(v[1]?.backgroundFights).toBe(true);
  });

  it('drops out-of-range indices and survives garbage', () => {
    expect(parseVerdicts(JSON.stringify([{ index: 5, score: 9, fixes: [] }]), 2)).toEqual([null, null]);
    expect(parseVerdicts('not json', 3)).toEqual([null, null, null]);
  });
});

describe('applyBoundedFixes', () => {
  it('no verdict + no overflow leaves the layout unchanged', () => {
    const r = applyBoundedFixes(layout(), null, false, '1080x1350');
    expect(r.changed).toBe(false);
  });

  it('applies a nudge, clamped to the safe area', () => {
    const l = layout({ blocks: [{ type: 'title', frame: { x: 0.9, y: 0.1, w: 0.2, h: 0.1 }, z: 10 }] });
    const r = applyBoundedFixes(l, { index: 0, score: 5, fixes: [{ op: 'nudge', block: 0, dx: 0.05, dy: 0 }] }, false, '1080x1350');
    expect(r.changed).toBe(true);
    const f = r.layout.blocks[0]!.frame;
    expect(f.x + f.w).toBeLessThanOrEqual(1 - 80 / 1080 + 1e-9); // stays inside xMax
  });

  it('steps a TEXT-HEAVY background down a notch when it fights the text', () => {
    const r = applyBoundedFixes(layout({ purpose: 'content' }), { index: 0, score: 4, backgroundFights: true, fixes: [] }, false, '1080x1350');
    expect(r.newRole).toBe('texture'); // content: statement -> texture
    expect(r.changed).toBe(true);
  });

  it('does NOT calm a short-copy hero background (would look empty)', () => {
    const r = applyBoundedFixes(layout({ purpose: 'cover' }), { index: 0, score: 4, backgroundFights: true, fixes: [] }, false, '1080x1350');
    expect(r.newRole).toBe('statement'); // cover keeps its bold background
  });

  it('honors an explicit backgroundRole fix', () => {
    const r = applyBoundedFixes(layout(), { index: 0, score: 6, fixes: [{ op: 'backgroundRole', role: 'canvas' }] }, false, '1080x1350');
    expect(r.newRole).toBe('canvas');
  });

  it('enlarges the hero block when the slide is flagged sparse', () => {
    const r = applyBoundedFixes(layout(), { index: 0, score: 5, sparse: true, fixes: [] }, false, '1080x1350');
    expect(r.changed).toBe(true);
    const title = r.layout.blocks[0]!.frame;
    expect(title.h).toBeGreaterThan(0.2); // hero grew
    expect(title.w).toBeGreaterThanOrEqual(0.82);
  });

  it('grows the tallest block on ground-truth overflow', () => {
    const r = applyBoundedFixes(layout(), null, true, '1080x1350');
    expect(r.changed).toBe(true);
    expect(r.layout.blocks[0]!.frame.h).toBeGreaterThan(0.2); // title was tallest
  });
});
