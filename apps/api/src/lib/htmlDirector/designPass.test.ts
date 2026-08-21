import { describe, expect, it, vi } from 'vitest';

let reply = '';
const aiCalls: unknown[] = [];

vi.mock('../ai', () => ({
  modelFor: async () => 'design-tier',
  textOf: () => reply,
  aiMessage: async (params: unknown) => {
    aiCalls.push(params);
    return { content: [{ type: 'text', text: reply }] };
  },
}));

const { improveByLooking, slidesWorthDesigning, copyFingerprint, DESIGN_PASS_ESTIMATE_USD } =
  await import('./designPass');
const { withSpendLedger } = await import('../spend');
const { detailMastersRecipe } = await import('./recipes');

const HTML = '<div class="eyebrow">Below the surface</div>\n<div class="headline">Foam decides it.</div>';
const call = (html = HTML) =>
  improveByLooking(detailMastersRecipe, { html, image: 'ZmFrZQ==', role: 'cover' });

describe('the design pass', () => {
  it('accepts a rearrangement that keeps every word', async () => {
    reply = JSON.stringify({
      html: '<div class="headline">Foam decides it.</div>\n<div class="eyebrow">Below the surface</div>',
      change: 'led with the headline',
    });
    const out = await call();
    expect(out!.change).toBe('led with the headline');
    expect(copyFingerprint(out!.html)).toBe(copyFingerprint(HTML));
  });

  it('DISCARDS an improvement that edited the copy, however good it looks', async () => {
    // The whole upstream chain — budgets, verbatim locks, the human who
    // approved the words — depends on this being enforced, not requested.
    reply = JSON.stringify({
      html: '<div class="eyebrow">Below the surface</div>\n<div class="headline">Foam decides everything.</div>',
      change: 'punchier headline',
    });
    expect(await call()).toBeNull();
  });

  it('treats a decline as a real answer and keeps the slide', async () => {
    reply = JSON.stringify({ html: '', change: 'already right' });
    expect(await call()).toBeNull();
  });

  it('returns null when nothing actually changed', async () => {
    reply = JSON.stringify({ html: HTML, change: 'no change' });
    expect(await call()).toBeNull();
  });

  it('never throws on an unusable reply', async () => {
    reply = 'not json at all';
    await expect(call()).resolves.toBeNull();
  });

  it('asks the ceiling before spending, and stands down', async () => {
    reply = JSON.stringify({ html: '<div class="headline">Foam decides it.</div>', change: 'x' });
    aiCalls.length = 0;
    const { ledger } = await withSpendLedger({ ceilingUsd: DESIGN_PASS_ESTIMATE_USD / 2 }, async () => {
      expect(await call()).toBeNull();
    });
    expect(aiCalls).toHaveLength(0);
    expect(ledger.skipped).toEqual(['design-pass:cover']);
  });
});

describe('slidesWorthDesigning', () => {
  it('buys the cover and the list — the two frames a deck rides on', () => {
    expect(slidesWorthDesigning(['cover', 'statement', 'list', 'statement', 'cta'])).toEqual([0, 2]);
  });

  it('orders them so a half-affordable budget still buys the cover', () => {
    expect(slidesWorthDesigning(['cover', 'list'])[0]).toBe(0);
  });

  it('falls back to the closing slide when a deck has no list', () => {
    expect(slidesWorthDesigning(['cover', 'statement', 'cta'])).toEqual([0, 2]);
  });

  it('spends nothing on a deck with neither', () => {
    expect(slidesWorthDesigning(['statement', 'statement'])).toEqual([]);
  });
});
