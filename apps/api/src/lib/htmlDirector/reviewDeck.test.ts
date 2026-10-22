import { describe, expect, it } from 'vitest';
import { betterRound, parseReview, shouldRevise, type DeckReview } from './reviewDeck';

const scores = (v: number) => ({ fidelity: v, hook: v, specificity: v, variety: v, hierarchy: v, brand: v, legibility: v, cta: v });

const review = (v: number, findings: DeckReview['findings'] = []): DeckReview => ({
  scores: scores(v),
  total: v * 8,
  findings,
  verdict: '',
  model: 'test',
});

describe('parseReview', () => {
  it('reads the eight scores, clamps, and ranks findings worst first', () => {
    const r = parseReview(
      {
        scores: { ...scores(4), hook: 7, cta: 0 },
        verdict: 'Holds together.',
        findings: [
          { slide: 3, fault: 'tiny', fix: 'bigger', severity: 'minor' },
          { slide: 1, fault: 'title', fix: 'hook', severity: 'blocking' },
          { slide: 0, fault: 'same', fix: 'vary', severity: 'nonsense' },
        ],
      },
      'm',
    );
    expect(r?.scores.hook).toBe(5);
    expect(r?.scores.cta).toBe(1);
    expect(r?.total).toBe(4 * 6 + 5 + 1);
    expect(r?.findings.map((f) => f.severity)).toEqual(['blocking', 'notable', 'minor']);
  });

  it('refuses a reply missing a dimension', () => {
    expect(parseReview({ scores: { hook: 3 }, findings: [] }, 'm')).toBeNull();
    expect(parseReview('nope', 'm')).toBeNull();
  });
});

describe('shouldRevise — a second round is earned, not automatic', () => {
  it('on a blocking finding', () => {
    expect(shouldRevise(review(4, [{ slide: 1, fault: 'a', fix: 'b', severity: 'blocking' }]), [])).toBe(true);
  });
  it('not on a low dimension alone — the revision lost that bet on the live runs', () => {
    const r = review(4);
    r.scores.variety = 2;
    expect(shouldRevise(r, [])).toBe(false);
  });
  it('on an overflow the probe measured', () => {
    expect(shouldRevise(review(4), ['slide 2 overflows the canvas — something must go or get smaller'])).toBe(true);
  });
  it('not on a clean deck with only minor notes, nor on an empty frame alone', () => {
    expect(shouldRevise(review(3, [{ slide: 2, fault: 'a', fix: 'b', severity: 'minor' }]), [])).toBe(false);
    expect(shouldRevise(review(3), ['slide 4: 61% of the frame is empty'])).toBe(false);
    expect(shouldRevise(review(3), ['slide 4: two elements collide'])).toBe(true);
  });
});

describe('betterRound — which deck ships', () => {
  it('prefers the higher total', () => {
    expect(betterRound(review(3), review(4))).toBe('b');
    expect(betterRound(review(4), review(3))).toBe('a');
  });
  it('on a tie, fewer blocking findings; then the first', () => {
    expect(betterRound(review(3, [{ slide: 1, fault: 'a', fix: 'b', severity: 'blocking' }]), review(3))).toBe('b');
    expect(betterRound(review(3), review(3))).toBe('a');
  });
  it('an unreviewed round never beats a reviewed one', () => {
    expect(betterRound(review(2), null)).toBe('a');
    expect(betterRound(null, review(2))).toBe('b');
  });
});
