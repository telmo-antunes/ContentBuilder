import { describe, expect, it, vi } from 'vitest';

// The ledger writes through to the usage collection; that half is Mongo's job
// and is covered elsewhere. Here we care about the live, per-request half.
vi.mock('./usage', () => ({
  estimateCostUsd: (_model: string, input: number, output: number) => input * 1e-6 + output * 1e-5,
  recordUsage: async () => {},
}));

const { affordsUsd, currentLedger, noteSpend, remainingUsd, summarize, withSpendLedger } =
  await import('./spend');

const spend = (usd: number) =>
  // 1 output token = $1e-5, so this buys an exact dollar figure.
  noteSpend({ feature: 'compose', model: 'test', outputTokens: Math.round(usd / 1e-5) });

describe('the spend ledger', () => {
  it('is inert outside a ledger — evals and unit tests get no ceiling', async () => {
    expect(currentLedger()).toBeUndefined();
    expect(remainingUsd()).toBe(Infinity);
    expect(affordsUsd(1000, 'anything')).toBe(true);
  });

  it('accumulates what each call cost, attributed by feature', async () => {
    const { ledger } = await withSpendLedger({ ceilingUsd: 0.4 }, async () => {
      await spend(0.1);
      await noteSpend({ feature: 'parse', model: 'test', outputTokens: 5000 }); // $0.05
    });
    expect(ledger.spentUsd).toBeCloseTo(0.15, 5);
    const s = summarize(ledger);
    expect(s.calls).toBe(2);
    // Sorted most-expensive-first: what to look at when a post costs too much.
    expect(s.byFeature[0]!.feature).toBe('compose');
  });

  it('refuses a step that would breach the ceiling, and says which', async () => {
    const { ledger } = await withSpendLedger({ ceilingUsd: 0.2 }, async () => {
      await spend(0.18);
      expect(affordsUsd(0.05, 'design-pass:list')).toBe(false);
      // …and the cheaper step still runs: a breach degrades, never fails.
      expect(affordsUsd(0.01, 'caption')).toBe(true);
    });
    expect(ledger.skipped).toEqual(['design-pass:list']);
  });

  it('records a refusal once, however many times the step asks', async () => {
    const { ledger } = await withSpendLedger({ ceilingUsd: 0.05 }, async () => {
      await spend(0.05);
      affordsUsd(0.02, 'design-pass:cover');
      affordsUsd(0.02, 'design-pass:cover');
    });
    expect(ledger.skipped).toEqual(['design-pass:cover']);
  });

  it('keeps concurrent decks on their own budgets', async () => {
    // Slides compose through a pool, and two decks can be in flight at once —
    // an AsyncLocalStorage scope is what stops one post spending another's.
    const [a, b] = await Promise.all([
      withSpendLedger({ ceilingUsd: 1 }, async () => {
        await spend(0.3);
        return remainingUsd();
      }),
      withSpendLedger({ ceilingUsd: 1 }, async () => {
        await spend(0.1);
        return remainingUsd();
      }),
    ]);
    expect(a.value).toBeCloseTo(0.7, 5);
    expect(b.value).toBeCloseTo(0.9, 5);
  });
});
