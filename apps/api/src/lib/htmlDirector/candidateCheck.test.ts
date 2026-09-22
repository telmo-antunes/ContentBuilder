import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { keepsTheWords, measureCandidates, pictureTreatment, readableText, slotSizesFor, slotSizesOn, soundCandidates, unbleedPicture } from './candidateCheck';
import { UNKNOWN_VERDICT, type LayoutVerdict, type OpenProbe, type OverflowState } from './renderCheck';
import { detailMastersRecipe } from './recipes';

/**
 * NO BROWSER, NO DATABASE. The probe is the seam: a scripted fake answers what
 * each candidate measured, exactly as `renderCheck.test.ts` does it.
 */
const verdict = (over: Partial<LayoutVerdict> = {}): LayoutVerdict => ({
  ...UNKNOWN_VERDICT,
  state: 'fits' as OverflowState,
  ...over,
});

function fakeProbe(script: (html: string, index: number) => LayoutVerdict): { openProbe: OpenProbe; opened: () => number } {
  let opened = 0;
  const openProbe = (async () => {
    opened += 1;
    return {
      async measure(items: readonly { index: number; html: string }[]) {
        return items.map((i) => script(i.html, i.index));
      },
      async close() {},
    };
  }) as unknown as OpenProbe;
  return { openProbe, opened: () => opened };
}

const c = (html: string) => ({ html });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('no candidate is offered unmeasured', () => {
  it('drops the one whose blocks collide and keeps the sound one', async () => {
    // The real failure: a quote card painted on top of a screenshot. Plausible
    // markup, broken canvas — and it was shown, picked and saved.
    const { openProbe } = fakeProbe((html) =>
      html.includes('card') ? verdict({ collide: true }) : verdict(),
    );
    const out = await soundCandidates(
      detailMastersRecipe,
      '1080x1350',
      [c('<figure class="cb-shot edge"></figure><div class="card">on top</div>'), c('<div class="headline">clean</div>')],
      { openProbe },
    );
    expect(out.kept.map((k) => k.html)).toEqual(['<div class="headline">clean</div>']);
    expect(out.rejected).toEqual([['collision']]);
  });

  it('drops a candidate that overflows the canvas', async () => {
    const { openProbe } = fakeProbe((html) => (html.includes('long') ? verdict({ state: 'overflows' }) : verdict()));
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<p>long</p>'), c('<p>short</p>')], { openProbe });
    expect(out.kept).toHaveLength(1);
    expect(out.rejected).toEqual([['overflows']]);
  });

  it('keeps an airy candidate — slack is taste, not a broken canvas', async () => {
    const { openProbe } = fakeProbe(() => verdict({ slack: 0.62 }));
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<div class="headline">One line.</div>')], { openProbe });
    expect(out.kept).toHaveLength(1);
    expect(out.rejected).toEqual([]);
  });

  it('ships unchecked when the renderer cannot be reached, rather than offering nothing', async () => {
    const openProbe = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3000');
    }) as unknown as OpenProbe;
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<p>a</p>'), c('<p>b</p>')], { openProbe });
    expect(out.kept).toHaveLength(2);
    expect(out.rejected).toEqual([]);
  });

  it('measures every candidate in ONE probe, and caps what comes back', async () => {
    const { openProbe, opened } = fakeProbe(() => verdict());
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<p>a</p>'), c('<p>b</p>'), c('<p>c</p>')], {
      openProbe,
      max: 2,
    });
    expect(opened()).toBe(1);
    expect(out.kept).toHaveLength(2);
  });

  it('measures the slot at the size the photo actually occupies', async () => {
    expect(
      slotSizesFor([
        { id: '1', mediaAssetId: 'a', placement: 'slot', slot: 'price', shape: 'wide' },
        { id: '2', mediaAssetId: 'b', placement: 'background' },
        { id: '3', mediaAssetId: 'c', placement: 'slot', slot: 'plain' },
      ] as never),
    ).toEqual({ price: { shape: 'wide' } });
  });

  it('reports faults per candidate without dropping anything, when asked to measure only', async () => {
    const { openProbe } = fakeProbe((_h, i) => (i === 0 ? verdict({ collide: true, state: 'overflows' }) : verdict()));
    const out = await measureCandidates(detailMastersRecipe, '1080x1350', [c('<p>a</p>'), c('<p>b</p>')], { openProbe });
    expect(out[0]!.faults).toEqual(['overflows', 'collision']);
    expect(out[1]!.faults).toEqual([]);
  });
});

describe('a rewrite keeps the picture’s treatment', () => {
  const inset = '<div class="headline">A</div><figure class="cb-shot wide" data-cb-slot="price"></figure>';
  const bleed = '<figure class="cb-shot edge left" data-cb-slot="price"></figure><div class="card"><div class="quote">over it</div></div>';

  it('tells a contained exhibit from a backdrop behind the copy', () => {
    expect(pictureTreatment(inset)).toBe('inset');
    expect(pictureTreatment(bleed)).toBe('bleed');
    expect(pictureTreatment('<div class="headline">no picture</div>')).toBe('none');
  });

  it('does not mistake a slot named "edge-case" for the bleed class', () => {
    expect(pictureTreatment('<figure class="cb-shot" data-cb-slot="edge-case"></figure>')).toBe('inset');
  });
});

describe('putting the picture back in the flow', () => {
  it('drops the bleed classes and leaves the rest of the figure alone', () => {
    const out = unbleedPicture('<figure class="cb-shot edge left wide" data-cb-slot="price"></figure><div class="card">x</div>');
    expect(out).toBe('<figure class="cb-shot wide" data-cb-slot="price"></figure><div class="card">x</div>');
    expect(pictureTreatment(out)).toBe('inset');
  });

  it('touches nothing but the slot figure', () => {
    const html = '<div class="card left">copy</div><figure class="cb-shot edge" data-cb-slot="a"></figure>';
    expect(unbleedPicture(html)).toBe('<div class="card left">copy</div><figure class="cb-shot" data-cb-slot="a"></figure>');
  });
});

describe('"same words" is a contract', () => {
  const parts = {
    eyebrow: 'The price',
    headline: 'Built from your own catalogue',
    body: 'The vehicle size sets the base figure on a size-priced service.',
  };

  it('accepts a candidate that says every part once, tags and entities notwithstanding', () => {
    const html =
      '<div class="eyebrow">The price</div><h1 class="headline sm">Built from <span class="it">your own catalogue</span></h1>' +
      '<div class="card"><div class="body">The vehicle size sets the base figure on a size&#8209;priced service.</div></div>';
    // A non-breaking hyphen is not a hyphen; the contract is the readable text.
    expect(keepsTheWords(parts, html.replace('&#8209;', '-'))).toEqual([]);
  });

  it('names what the applied arrangement did: lost the body, repeated the headline', () => {
    const html =
      '<div class="eyebrow">The price</div><div class="headline sm">Built from <span class="it">your own catalogue</span></div>' +
      '<figure class="cb-shot" data-cb-slot="catalogue"></figure><div class="card"><div class="quote">Built from <span class="it">your own catalogue</span></div></div>';
    expect(keepsTheWords(parts, html)).toEqual(['repeats the headline', 'lost the body']);
  });

  it('checks every row of a list', () => {
    const out = keepsTheWords(
      { headline: 'Four things.', rows: [{ text: 'Cash lands first' }, { text: 'Repeat visits secured' }] },
      '<div class="headline">Four things.</div><div class="panel"><div class="row">Cash lands first</div></div>',
    );
    expect(out).toEqual(['lost row 2']);
  });

  it('reads text the way a person does', () => {
    expect(readableText('<p class="body">Tom &amp; Jerry&#39;s   “quote”</p>')).toBe('tom & jerry\'s “quote”');
  });
});

describe('the photo is measured on the candidate’s own slot', () => {
  it('moves a size keyed to the old slot name onto the first declared slot', () => {
    expect(slotSizesOn('<figure class="cb-shot" data-cb-slot="pricing-ui"></figure>', { price: { shape: 'wide' } })).toEqual({
      'pricing-ui': { shape: 'wide' },
    });
  });
  it('keeps a size whose slot the candidate still declares', () => {
    expect(slotSizesOn('<figure data-cb-slot="a"></figure><figure data-cb-slot="price"></figure>', { price: { shape: 'wide' } })).toEqual({
      price: { shape: 'wide' },
    });
  });
  it('reserves nothing on a candidate with no slot', () => {
    expect(slotSizesOn('<div class="headline">A</div>', { price: { shape: 'wide' } })).toEqual({});
  });
});

describe('a broken candidate gets the ladder a deck gets', () => {
  const input = { role: 'statement', parts: { headline: 'Too long a line for this frame' }, format: '1080x1350', index: 0 } as never;

  it('climbs to the smaller headline and keeps the candidate once it fits — in one probe', async () => {
    // Overflows at the brand size, fits once the headline carries `sm`.
    const { openProbe, opened } = fakeProbe((html) => (/headline[^"]*\bsm\b/.test(html) ? verdict() : verdict({ state: 'overflows' })));
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<h1 class="headline">Too long a line for this frame</h1>')], {
      openProbe,
      input,
      recompose: async () => '',
    });
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.html).toContain('class="headline sm"');
    expect(out.repaired).toBe(1);
    expect(out.rejected).toEqual([]);
    expect(opened()).toBe(1);
  });

  it('still drops a candidate the whole ladder cannot save', async () => {
    const { openProbe } = fakeProbe(() => verdict({ state: 'overflows' }));
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<h1 class="headline">A</h1>')], {
      openProbe,
      input,
      recompose: async () => '',
    });
    expect(out.kept).toEqual([]);
    expect(out.rejected).toEqual([['overflows']]);
  });

  it('shrinks the headline for a collision even without the slide to recompose from', async () => {
    const { openProbe } = fakeProbe((html) => (/headline[^"]*\bsm\b/.test(html) ? verdict() : verdict({ collide: true })));
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<h1 class="headline">Tight</h1>')], { openProbe });
    expect(out.kept).toHaveLength(1);
    expect(out.repaired).toBe(1);
  });
});

describe('a repair is normalised like the originals', () => {
  it('strips the bleed the recompose rung brought back, before it is measured or kept', async () => {
    const input = { role: 'statement', parts: { headline: 'A' }, format: '1080x1350', index: 0 } as never;
    // Overflows until recomposed; the recompose comes back with an edge figure.
    const { openProbe } = fakeProbe((html) => (/recomposed/.test(html) ? verdict() : verdict({ state: 'overflows' })));
    const out = await soundCandidates(detailMastersRecipe, '1080x1350', [c('<h1 class="headline sm">A</h1><figure class="cb-shot" data-cb-slot="p"></figure>')], {
      openProbe,
      input,
      recompose: async () => '<h1 class="headline sm">A</h1><figure class="cb-shot edge" data-cb-slot="p"></figure><p class="body">recomposed</p>',
      normalise: (h) => h.replace(' edge', ''),
    });
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.html).not.toMatch(/\bedge\b/);
    expect(out.repaired).toBe(1);
  });
});
