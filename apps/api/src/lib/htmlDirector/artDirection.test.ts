import { describe, expect, it, vi } from 'vitest';

let reply: unknown = {};
const aiCalls: unknown[] = [];

vi.mock('../ai', () => ({
  modelFor: async () => 'design-tier',
  aiJson: async (params: unknown) => {
    aiCalls.push(params);
    return { json: reply, text: '' };
  },
}));

const { planDeck, ART_DIRECTION_ESTIMATE_USD } = await import('./artDirection');
const { withSpendLedger } = await import('../spend');
const { detailMastersRecipe } = await import('./recipes');
const { brandRecipeSchema } = await import('@contentbuilder/shared');

const deck = (n = 5) =>
  Array.from({ length: n }, (_, i) => ({
    role: i === 0 ? 'cover' : i === n - 1 ? 'cta' : 'statement',
    parts: { headline: `Slide ${i + 1}` },
  }));

/** detailmasters authors several arrangements; this brand authors exactly one. */
const oneArrangement = brandRecipeSchema.parse({
  ...detailMastersRecipe,
  composition: { align: 'flush-left', patterns: ['statement: headline → body'] },
});

describe('art direction', () => {
  it('does not bother with a deck too short to have a shape', async () => {
    aiCalls.length = 0;
    expect(await planDeck(detailMastersRecipe, deck(2), '1080x1350')).toBeNull();
    expect(aiCalls).toHaveLength(0);
  });

  it('does not spend a call when the brand has nothing to choose between', async () => {
    // Every role has one arrangement, so a plan could only agree with the
    // default — paying to be told that is waste.
    aiCalls.length = 0;
    expect(await planDeck(oneArrangement, deck(5), '1080x1350')).toBeNull();
    expect(aiCalls).toHaveLength(0);
  });

  it('applies the variants it was offered', async () => {
    reply = { note: 'built to the argument', slides: [{ slide: 2, variant: 1 }] };
    const plan = await planDeck(detailMastersRecipe, deck(5), '1080x1350');
    expect(plan!.slides[1]!.variant).toBe(1);
    expect(plan!.note).toBe('built to the argument');
  });

  it('IGNORES a variant the brand does not have, rather than wrapping it', async () => {
    // A modulo here would silently select a different arrangement and call it
    // the director's choice.
    reply = { note: '', slides: [{ slide: 2, variant: 99 }] };
    const plan = await planDeck(detailMastersRecipe, deck(5), '1080x1350');
    expect(plan!.slides[1]!.variant).toBeUndefined();
  });

  it('allows ONE inversion, never at the ends', async () => {
    reply = {
      note: '',
      slides: [
        { slide: 1, invert: true }, // the cover — refused
        { slide: 3, invert: true }, // allowed
        { slide: 4, invert: true }, // a second beat — refused
        { slide: 5, invert: true }, // the close — refused
      ],
    };
    const plan = await planDeck(detailMastersRecipe, deck(5), '1080x1350');
    expect(plan!.slides.map((s) => s.invert === true)).toEqual([false, false, true, false, false]);
  });

  it('never inverts a brand with no inverse surface', async () => {
    const noInverse = brandRecipeSchema.parse({ ...detailMastersRecipe, surfaces: undefined });
    reply = { note: '', slides: [{ slide: 3, invert: true }] };
    const plan = await planDeck(noInverse, deck(5), '1080x1350');
    expect(plan!.slides.every((s) => !s.invert)).toBe(true);
  });

  it('survives an unusable answer — the deterministic plan is always correct', async () => {
    reply = { note: 42, slides: 'not an array' };
    const plan = await planDeck(detailMastersRecipe, deck(5), '1080x1350');
    expect(plan!.slides.every((s) => s.variant === undefined && !s.invert)).toBe(true);
  });

  it('asks the ceiling first', async () => {
    reply = { note: '', slides: [] };
    aiCalls.length = 0;
    const { ledger } = await withSpendLedger({ ceilingUsd: ART_DIRECTION_ESTIMATE_USD / 2 }, async () => {
      expect(await planDeck(detailMastersRecipe, deck(5), '1080x1350')).toBeNull();
    });
    expect(aiCalls).toHaveLength(0);
    expect(ledger.skipped).toEqual(['art-direction']);
  });
});
