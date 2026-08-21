import { describe, expect, it, vi } from 'vitest';

let reply: (params: unknown) => unknown = () => ({});
const aiCalls: unknown[] = [];

vi.mock('../ai', () => ({
  modelFor: async () => 'test-model',
  aiJson: async (params: unknown) => {
    aiCalls.push(params);
    const json = reply(params);
    return { json, text: '' };
  },
}));

// A 2x1 PNG is enough: the sheet builder only needs decodable buffers.
vi.mock('../contactSheet', () => ({
  buildContactSheet: async (slides: readonly unknown[]) => Buffer.from(`sheet:${slides.length}`),
}));

const { critiqueDeck, CRITIQUE_ESTIMATE_USD } = await import('./deckCritique');
const { withSpendLedger } = await import('../spend');
const { detailMastersRecipe } = await import('./recipes');

const shots = (n: number) => Array.from({ length: n }, (_, i) => Buffer.from(`slide${i}`));

describe('the deck critique', () => {
  it('needs a sequence — one slide is not a deck', async () => {
    aiCalls.length = 0;
    expect(await critiqueDeck(detailMastersRecipe, shots(1), '1080x1350')).toBeNull();
    expect(aiCalls).toHaveLength(0);
  });

  it('ranks findings worst-first, so a caller that can act on one acts on that one', async () => {
    reply = () => ({
      verdict: 'Holds together.',
      findings: [
        { slide: 3, fault: 'taste thing', fix: 'nudge', severity: 'minor' },
        { slide: 0, fault: 'reads as one slide repeated', fix: 'vary the arrangements', severity: 'blocking' },
        { slide: 2, fault: 'picture is related but wrong', fix: 'shoot the headliner', severity: 'notable' },
      ],
    });
    const out = await critiqueDeck(detailMastersRecipe, shots(5), '1080x1350');
    expect(out!.findings.map((f) => f.severity)).toEqual(['blocking', 'notable', 'minor']);
    expect(out!.verdict).toBe('Holds together.');
  });

  it('accepts an empty verdict — a clean deck must be able to say so', async () => {
    reply = () => ({ verdict: 'Nothing wrong with it.', findings: [] });
    const out = await critiqueDeck(detailMastersRecipe, shots(4), '1080x1350');
    expect(out!.findings).toEqual([]);
  });

  it('drops junk findings instead of surfacing them', async () => {
    reply = () => ({
      verdict: 'ok',
      findings: [
        { slide: 2, fault: '', fix: 'x', severity: 'blocking' }, // no fault text
        { slide: 'nonsense', fault: 'real fault', fix: 'do it', severity: 'invented' },
      ],
    });
    const out = await critiqueDeck(detailMastersRecipe, shots(3), '1080x1350');
    expect(out!.findings).toHaveLength(1);
    // An unusable slide number becomes a deck-level finding; an unknown
    // severity settles at 'notable' rather than being trusted or dropped.
    expect(out!.findings[0]).toMatchObject({ slide: 0, severity: 'notable' });
  });

  it('never throws when the model call fails — a critique cannot block shipping', async () => {
    reply = () => {
      throw new Error('vision unavailable');
    };
    await expect(critiqueDeck(detailMastersRecipe, shots(3), '1080x1350')).resolves.toBeNull();
  });

  it('asks the ceiling first, and stands down when the budget is spent', async () => {
    reply = () => ({ verdict: 'ok', findings: [] });
    aiCalls.length = 0;
    const { ledger } = await withSpendLedger({ ceilingUsd: CRITIQUE_ESTIMATE_USD / 2 }, async () => {
      expect(await critiqueDeck(detailMastersRecipe, shots(4), '1080x1350')).toBeNull();
    });
    expect(aiCalls).toHaveLength(0);
    // …and it says so, rather than downgrading silently.
    expect(ledger.skipped).toEqual(['deck-critique']);
  });
});
