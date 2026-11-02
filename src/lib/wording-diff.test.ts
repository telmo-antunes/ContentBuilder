import { describe, expect, it } from 'vitest';
import { wordingDiff, changedSensitiveKinds, highlightedPart } from './wording-diff';
describe('wording review', () => {
  it.each([['Keep  two slides.\nOlá “mundo”.', 'Keep three slides.\nOlá “Portugal”.'], ['', 'New'], ['Removed', ''], ['same', 'same']])('preserves both exact versions', (before, after) => {
    const { parts } = wordingDiff(before, after);
    expect(parts.filter(p => p.kind !== 'added').map(p => p.text).join('')).toBe(before);
    expect(parts.filter(p => p.kind !== 'removed').map(p => p.text).join('')).toBe(after);
  });
  it('flags changed offers, quoted copy and written slide counts', () => {
    const before = 'Four slides. Offer 15% and “Free forever”.';
    const after = 'Five slides. Offer 20% and “Free today”.';
    expect(changedSensitiveKinds(before, after)).toEqual([0, 1, 2]);
    expect(changedSensitiveKinds('A 15% offer.', 'An offer of 15%.')).toEqual([]);
    const marked = wordingDiff(before, after).parts.flatMap(p => highlightedPart(p, p.kind === 'removed' ? before : after));
    expect(marked.filter(p => p.important).map(p => p.text).join(' ')).toContain('15');
    expect(marked.filter(p => p.important).map(p => p.text).join(' ')).toContain('forever');
  });
  it('bounds comparison work for long unrelated text without dropping content', () => {
    const before = 'old '.repeat(1000), after = 'new '.repeat(1000);
    const result = wordingDiff(before, after);
    expect(result.grouped).toBe(true);
    expect(result.parts.filter(p => p.kind !== 'added').map(p => p.text).join('')).toBe(before);
    expect(result.parts.filter(p => p.kind !== 'removed').map(p => p.text).join('')).toBe(after);
  });
});
