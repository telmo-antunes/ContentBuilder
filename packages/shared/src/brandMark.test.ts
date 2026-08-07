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

/**
 * THESE TESTS EXIST BECAUSE THE FIRST SET DID NOT CATCH THE BUG.
 *
 * The original suite asserted only which variant won, on inputs where the
 * correct mark also happened to have the most elements. Both structural
 * signals were in fact broken by regex faults, scoring had silently collapsed
 * to "most elements wins", and every test still passed.
 *
 * So each signal is now pinned INDEPENDENTLY, with the weaker tiebreaks
 * deliberately pointing the other way. If a signal stops firing, the test that
 * covers it fails on its own rather than being carried by another.
 */
describe('canonicalMark — each signal, with the tiebreaks inverted', () => {
  it('rejects loose text in the wrapper even when the offender is bigger', () => {
    // Equal element counts; the loose variant is longer, so length would pick
    // it. Only the loose-text signal can give the right answer here.
    const clean = '<div class="logo-row"><span class="wordmark">Acme</span></div>';
    const loose = '<div class="logo-row">Acme Corporation Limited Group<span class="wordmark"></span></div>';
    expect(canonicalMark([clean, loose])).toBe('<span class="wordmark">Acme</span>');
  });

  it('rejects words stuffed into the logo image, even when that variant is longer', () => {
    const empty = '<div class="logo-row"><i class="monogram"></i><b class="wordmark">Acme</b></div>';
    const stuffed =
      '<div class="logo-row"><i class="monogram">Acme Corporation Limited</i><b class="wordmark"></b></div>';
    expect(canonicalMark([empty, stuffed])).toContain('<i class="monogram"></i>');
  });

  it('holds up when the improvisation has MORE elements than the real mark', () => {
    // The decisive case, and the one the old suite missed entirely: element
    // count is the weakest signal, so padding must not be able to win.
    const busier =
      '<div class="logo-row">detail<span class="monogram">masters</span><em>a</em><em>b</em><em>c</em><em>d</em></div>';
    expect(canonicalMark([GOOD, busier])).toContain('class="wordmark"');
  });

  it('sees loose text beside a NESTED child — the case the old regex could not strip', () => {
    // `<div class="wordmark"><b>x</b><span>y</span></div>` defeated the old
    // non-greedy strip, which left a bare `</div>` and cried loose text on a
    // clean mark. Here the loose text is real and must still be caught.
    const nestedClean = GOOD;
    const nestedLoose =
      '<div class="logo-row">detail<div class="wordmark"><b>detail</b><span class="it">masters</span></div><i class="monogram"></i></div>';
    expect(canonicalMark([nestedClean, nestedLoose])).toBe(
      '<i class="monogram"></i><div class="wordmark"><b>detail</b><span class="it">masters</span></div>',
    );
  });

  it('counts vocabulary as distinct CLASSES, so padding with bare elements gains nothing', () => {
    const vocab = '<div class="logo-row"><i class="monogram"></i><b class="wordmark">A</b></div>';
    const padded = '<div class="logo-row"><i class="monogram"></i><em></em><em></em><em></em><em></em></div>';
    expect(canonicalMark([vocab, padded])).toContain('class="wordmark"');
  });

  it('is not confused by a self-closing or void tag at the top level', () => {
    const withBr = '<div class="logo-row"><i class="monogram"></i><br><b class="wordmark">A</b></div>';
    // The <br> must not open a depth level and swallow the rest as "inside" it.
    expect(canonicalMark([withBr])).toContain('class="wordmark"');
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
