import { describe, expect, it } from 'vitest';

const { saysTheSameThing } = await import('./visionRepair');

describe('the copy must survive a vision repair unchanged', () => {
  const slide =
    '<p class="eyebrow">Foam and carpet</p>' +
    '<h1 class="headline">The smell is in the foam</h1>' +
    '<div class="fill"></div>' +
    '<p class="body">Extraction decides the result.</p>';

  it('passes a pure rearrangement', () => {
    // The spacer moves and the body swaps places with the headline. Same words.
    const moved =
      '<p class="eyebrow">Foam and carpet</p>' +
      '<div class="fill"></div>' +
      '<p class="body">Extraction decides the result.</p>' +
      '<h1 class="headline">The smell is in the foam</h1>';
    expect(saysTheSameThing(slide, moved)).toBe(true);
  });

  it('passes text moved between elements', () => {
    // Rearranging INTO a panel is a legitimate fix and must not be rejected.
    const panelled =
      '<p class="eyebrow">Foam and carpet</p>' +
      '<h1 class="headline">The smell is in the foam</h1>' +
      '<div class="panel"><div class="row">Extraction decides the result.</div></div>';
    expect(saysTheSameThing(slide, panelled)).toBe(true);
  });

  it('catches a word being changed', () => {
    expect(saysTheSameThing(slide, slide.replace('decides', 'determines'))).toBe(false);
  });

  it('catches a word being dropped', () => {
    expect(saysTheSameThing(slide, slide.replace('The smell is in the foam', 'The smell is in foam'))).toBe(false);
  });

  it('catches a word being added', () => {
    expect(saysTheSameThing(slide, slide.replace('Extraction', 'Proper extraction'))).toBe(false);
  });

  it('ignores whitespace, casing and element boundaries', () => {
    const reflowed =
      '<p class="eyebrow">foam and CARPET</p>\n  ' +
      '<h1 class="headline">The  smell   is in the foam</h1>' +
      '<div class="fill"></div><p class="body">Extraction decides the result.</p>';
    expect(saysTheSameThing(slide, reflowed)).toBe(true);
  });

  it('ignores punctuation, so a full stop moving between blocks is not a rewrite', () => {
    expect(saysTheSameThing('<p class="body">One. Two.</p>', '<p class="body">One</p><p class="body">Two</p>')).toBe(true);
  });
});
