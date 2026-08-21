/**
 * THE PER-POST SPEND LEDGER — and the ceiling that makes it a budget rather
 * than a report.
 *
 * WHY THIS EXISTS. Quality in this product is bought: a stronger tier on the
 * cover, a second look at a rendered slide, an art-direction pass that sees the
 * whole deck. Every one of those is worth money and none of them was counted —
 * `recordUsage` was wired into the caption, vision and verify paths but never
 * into the two calls that actually run per deck and per slide, so the most
 * expensive thing the product does was also the least visible.
 *
 * A ledger alone is a report you read after overspending. The ceiling is what
 * turns it into a decision: expensive steps ASK before they run
 * (`affordsUsd`), and the pipeline degrades in a fixed order instead of
 * failing. That order matters — it is why a breach yields a plainer deck and
 * never a broken one:
 *
 *   1. drop the extra alternatives (a nicety),
 *   2. drop the targeted repair (the deck is already gated for fit),
 *   3. drop the design pass (fragments compose it for free, and well),
 *   never: the parse, or the checks that keep a deck honest.
 *
 * SCOPE, not thread-through. The estimate travels in an AsyncLocalStorage
 * context opened once per compose request, so `aiMessage` can attribute every
 * call — including ones made deep inside the guard chain — without threading a
 * budget parameter through twenty signatures. Outside a context every helper
 * here is inert, which is exactly what the eval harness and the unit tests
 * want: no ceiling, no bookkeeping, no behaviour change.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { estimateCostUsd, recordUsage } from './usage';

export interface SpendEntry {
  feature: string;
  model: string;
  costUsd: number;
}

export interface SpendLedger {
  /** The project this spend belongs to, when the caller knows it. */
  projectId?: string;
  /** The hard ceiling in USD; `Infinity` means "count, don't cap". */
  ceilingUsd: number;
  spentUsd: number;
  entries: SpendEntry[];
  /** Steps the ceiling turned down, in the order they were refused. */
  skipped: string[];
}

const store = new AsyncLocalStorage<SpendLedger>();

/** The ledger for the current async scope, or undefined outside one. */
export function currentLedger(): SpendLedger | undefined {
  return store.getStore();
}

/** Run `fn` inside a fresh ledger and hand back both its value and the ledger. */
export async function withSpendLedger<T>(
  init: { projectId?: string; ceilingUsd?: number },
  fn: () => Promise<T>,
): Promise<{ value: T; ledger: SpendLedger }> {
  const ledger: SpendLedger = {
    projectId: init.projectId,
    ceilingUsd: init.ceilingUsd ?? Infinity,
    spentUsd: 0,
    entries: [],
    skipped: [],
  };
  const value = await store.run(ledger, fn);
  return { value, ledger };
}

/**
 * Record one call against the current ledger AND the usage collection.
 *
 * Both, deliberately: the ledger is live and per-request (it decides what runs
 * next), the collection is durable and cross-project (it feeds the dashboard).
 * Recording is best-effort and never throws — a bookkeeping failure must not
 * take down a generation that already succeeded.
 */
export async function noteSpend(args: {
  feature: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}): Promise<void> {
  const costUsd = estimateCostUsd(
    args.model,
    args.inputTokens ?? 0,
    args.outputTokens ?? 0,
    args.cacheCreationInputTokens ?? 0,
    args.cacheReadInputTokens ?? 0,
  );
  const ledger = store.getStore();
  if (ledger) {
    ledger.spentUsd += costUsd;
    ledger.entries.push({ feature: args.feature, model: args.model, costUsd });
  }
  await recordUsage(args);
}

/** What is left under the ceiling; `Infinity` outside a ledger. */
export function remainingUsd(): number {
  const ledger = store.getStore();
  if (!ledger) return Infinity;
  return Math.max(0, ledger.ceilingUsd - ledger.spentUsd);
}

/**
 * Can this step afford to run? Records the refusal when it cannot, so the
 * hand-off can say what the budget bought and what it turned down — a silent
 * downgrade is the one outcome worse than an expensive deck.
 *
 * `estimateUsd` is the caller's own honest guess at the step's cost. It does
 * not have to be exact: it is a gate, and the real spend is measured after.
 */
export function affordsUsd(estimateUsd: number, label: string): boolean {
  const ledger = store.getStore();
  if (!ledger) return true;
  if (ledger.ceilingUsd - ledger.spentUsd >= estimateUsd) return true;
  if (!ledger.skipped.includes(label)) ledger.skipped.push(label);
  console.warn(
    `[spend] skipping ${label}: $${estimateUsd.toFixed(3)} would breach the $${ledger.ceilingUsd.toFixed(
      2,
    )} ceiling (spent $${ledger.spentUsd.toFixed(3)})`,
  );
  return false;
}

/** A compact, storable summary — what the review page shows per post. */
export function summarize(ledger: SpendLedger): {
  spentUsd: number;
  ceilingUsd: number | null;
  calls: number;
  skipped: string[];
  byFeature: Array<{ feature: string; costUsd: number; calls: number }>;
} {
  const byFeature = new Map<string, { feature: string; costUsd: number; calls: number }>();
  for (const e of ledger.entries) {
    const row = byFeature.get(e.feature) ?? { feature: e.feature, costUsd: 0, calls: 0 };
    row.costUsd += e.costUsd;
    row.calls += 1;
    byFeature.set(e.feature, row);
  }
  return {
    spentUsd: ledger.spentUsd,
    ceilingUsd: Number.isFinite(ledger.ceilingUsd) ? ledger.ceilingUsd : null,
    calls: ledger.entries.length,
    skipped: [...ledger.skipped],
    byFeature: [...byFeature.values()].sort((a, b) => b.costUsd - a.costUsd),
  };
}
