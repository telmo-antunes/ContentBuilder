import { describe, expect, it } from 'vitest';
import { applyBrandMark, brandMarkVariants, canonicalMark, ensureBrandMark, findBrandMark } from './brandMark';

/** The real pair from the DetailMasters deck that exposed this. */
const GOOD =
  '<div class="logo-row"><i class="monogram"></i><div class="wordmark"><b>detail</b><span class="it">masters</span></div></div>';
const BAD = '<div class="logo-row">detail<span class="monogram">masters</span></div>';

const cover = `${GOOD}<div class="fill"></div><h1 class="headline">Book the detail</h1>`;
const cta = `${BAD}<div class="fill"></div><a class="cta">Book now</a>`;

describe('findBrandMark', () => {
  it('finds the mark and separates its wrapper from its contents', () => {
    const m = findBrandMark(cover)!;
    expect(m.outer).toBe(GOOD);
    expect(m.inner).toBe('<i class="monogram"></i><div class="wordmark"><b>detail</b><span class="it">masters</span></div>');
  });

  it('returns the OUTERMOST mark, never a nested one', () => {
    // `.wordmark` is itself a mark class. Replacing the inner match inside the
    // outer one is how you corrupt markup, so the wrapper has to win.
    expect(findBrandMark(cover)!.outer).toBe(GOOD);
  });

  it('closes on the right tag when the mark nests the same element', () => {
    const nested = '<div class="logo"><div class="a"><div class="b">x</div></div></div><p>after</p>';
    expect(findBrandMark(nested)!.outer).toBe('<div class="logo"><div class="a"><div class="b">x</div></div></div>');
  });

  it('says nothing about a slide with no mark', () => {
    expect(findBrandMark('<h1 class="headline">Just a headline</h1>')).toBeNull();
  });

  it('does not mistake a list row for a logo row', () => {
    expect(findBrandMark('<div class="panel"><div class="row">One</div></div>')).toBeNull();
  });
});

describe('canonicalMark', () => {
  it('picks the structured mark over the improvised one in a two-slide deck', () => {
    // The tie-break that matters: one of each, so frequency cannot decide.
    // Loose text in a layout wrapper renders in whatever the slide inherits,
    // and "masters" inside .monogram lands inside the logo image.
    expect(canonicalMark([cover, cta])).toContain('class="wordmark"');
    expect(canonicalMark([cta, cover])).toContain('class="wordmark"');
  });

  it('lets the majority win even when the outlier scores higher', () => {
    const fancy = '<div class="logo-row"><i class="monogram"></i><div class="wordmark">a</div><span class="x">b</span></div>';
    const plain = '<div class="logo-row"><div class="wordmark">a</div></div>';
    // Three slides say `plain`; one says `fancy`. Three slides are the brand.
    expect(canonicalMark([plain, plain, plain, fancy])).toBe('<div class="wordmark">a</div>');
  });

  it('returns null for a deck that never shows a mark', () => {
    expect(canonicalMark(['<h1 class="headline">A</h1>', '<p class="body">B</p>'])).toBeNull();
  });
});

describe('applyBrandMark', () => {
  it('swaps the contents and keeps the wrapper the slide authored', () => {
    const fixed = applyBrandMark(cta, findBrandMark(cover)!.inner);
    expect(fixed).toContain(GOOD);
    // Everything else on the slide is untouched.
    expect(fixed).toContain('<a class="cta">Book now</a>');
    expect(fixed).not.toContain('>detail<span class="monogram">');
  });

  it('leaves a slide alone when it already has the mark', () => {
    expect(applyBrandMark(cover, findBrandMark(cover)!.inner)).toBe(cover);
  });

  it('leaves a slide with no mark completely alone', () => {
    const plain = '<h1 class="headline">A</h1>';
    expect(applyBrandMark(plain, '<i class="monogram"></i>')).toBe(plain);
  });
});

describe('ensureBrandMark', () => {
  it('makes one deck agree, and says how many slides it rewrote', () => {
    const { htmls, repaired } = ensureBrandMark([cover, cta]);
    expect(repaired).toBe(1);
    expect(brandMarkVariants(htmls)).toBe(1);
    expect(htmls[1]).toContain('class="wordmark"');
  });

  it('is idempotent — a repaired deck repairs to itself', () => {
    const once = ensureBrandMark([cover, cta]).htmls;
    const twice = ensureBrandMark(once);
    expect(twice.repaired).toBe(0);
    expect(twice.htmls).toEqual(once);
  });

  it('touches nothing when the deck already agrees', () => {
    const deck = [cover, cover];
    expect(ensureBrandMark(deck)).toEqual({ htmls: deck, repaired: 0 });
  });

  it('does not invent a mark on slides that deliberately have none', () => {
    // Most slides carry no brand mark at all — a gate that added one would be
    // redesigning the deck, not repairing it.
    const bare = '<h1 class="headline">A</h1>';
    const { htmls } = ensureBrandMark([cover, bare, cta]);
    expect(htmls[1]).toBe(bare);
    expect(brandMarkVariants(htmls)).toBe(1);
  });
});
