import { describe, it, expect } from 'vitest';
import { cleanHashtag } from './caption';

describe('cleanHashtag', () => {
  it('normalizes a plain word to a single #tag', () => {
    expect(cleanHashtag('detailing')).toBe('#detailing');
  });
  it('strips leading hashes and non-alphanumerics', () => {
    expect(cleanHashtag('##Auto-Detailing!')).toBe('#AutoDetailing');
  });
  it('rejects an empty / punctuation-only tag', () => {
    expect(cleanHashtag('#')).toBeNull();
    expect(cleanHashtag('!!!')).toBeNull();
  });
  it('caps very long tags', () => {
    const out = cleanHashtag('a'.repeat(80));
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(41); // '#' + 40
  });
});
