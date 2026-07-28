import { describe, expect, it } from 'vitest';
import { STYLE_DESCRIPTOR_MAX, VOICE_MAX, clampText } from './text';

describe('clampText', () => {
  it('leaves text that fits completely alone', () => {
    expect(clampText('Confident, plain-spoken B2B.', 100)).toBe('Confident, plain-spoken B2B.');
  });

  it('normalises the whitespace model output arrives with', () => {
    expect(clampText('  two\n\nlines   here ', 100)).toBe('two lines here');
  });

  it('never cuts a word in half', () => {
    // The exact failure this replaced: a real kit stored
    // "…sophisticated without being pre" — a guillotined "premium".
    const s = 'Sophisticated without being premium and quiet without being timid';
    const out = clampText(s, 32);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/pre…$/);
    // Every word that survived is a whole word from the source.
    for (const w of out.replace('…', '').split(' ')) expect(s).toContain(w);
  });

  it('stops at a sentence when one lands late enough to be worth it', () => {
    const s = 'Direct, plain-spoken, unhurried and quietly certain. It avoids hype.';
    const out = clampText(s, 60);
    expect(out).toBe('Direct, plain-spoken, unhurried and quietly certain.');
    expect(out.endsWith('…')).toBe(false); // a complete sentence needs no ellipsis
  });

  it('ignores an EARLY full stop rather than throwing the answer away', () => {
    // "Acme Inc." must not collapse the description to three words — a
    // sentence boundary is only better than a word boundary when it keeps
    // most of the budget.
    const s = 'Acme Inc. speaks in short confident declaratives to shop operators every day';
    const out = clampText(s, 60);
    expect(out.startsWith('Acme Inc. speaks in short')).toBe(true);
    expect(out.length).toBeGreaterThan(40);
  });

  it('marks a mid-sentence clip so it never passes as a finished thought', () => {
    expect(clampText('a'.repeat(10) + ' ' + 'b'.repeat(60), 30)).toMatch(/…$/);
  });

  it('leaves no dangling punctuation before the ellipsis', () => {
    expect(clampText('Formal, technical, precise, measured and careful', 20)).not.toMatch(/[,;:—–-]…$/);
  });

  it('handles absent or junk input without throwing', () => {
    expect(clampText('', 100)).toBe('');
    expect(clampText(undefined as unknown as string, 100)).toBe('');
  });

  it('gives voice enough room for what the model is now asked to write', () => {
    // The old hard cap was 240 — under a single rich sentence about how a
    // brand talks, which is then fed to caption writing AND recipe authoring.
    expect(VOICE_MAX).toBeGreaterThan(240 * 2);
    expect(STYLE_DESCRIPTOR_MAX).toBeGreaterThan(200);
  });
});
