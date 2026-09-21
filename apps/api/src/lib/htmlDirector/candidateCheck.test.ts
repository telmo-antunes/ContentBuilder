import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { measureCandidates, pictureTreatment, slotSizesFor, soundCandidates, unbleedPicture } from './candidateCheck';
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
