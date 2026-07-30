import mongoose from 'mongoose';
import { Usage } from '../models/Usage';

/**
 * Approximate list prices in USD per 1M tokens, matched by model-family substring.
 * These are estimates for the cost dashboard, not billing-grade figures.
 */
const PRICES: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /fable|mythos/i, in: 10, out: 50 },
  { match: /haiku/i, in: 1, out: 5 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /opus/i, in: 5, out: 25 },
];
const DEFAULT_PRICE = { in: 3, out: 15 };

/**
 * Prompt-cache pricing, relative to the model's base INPUT rate (current
 * Anthropic pricing): writing a 5-minute-TTL cache entry costs 1.25× input —
 * the only TTL `cachedSystem` in lib/ai.ts emits — and reading one costs 0.1×.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens = 0,
  cacheReadInputTokens = 0,
): number {
  const p = PRICES.find((x) => x.match.test(model)) ?? DEFAULT_PRICE;
  return (
    (inputTokens / 1e6) * p.in +
    (outputTokens / 1e6) * p.out +
    (cacheCreationInputTokens / 1e6) * p.in * CACHE_WRITE_MULTIPLIER +
    (cacheReadInputTokens / 1e6) * p.in * CACHE_READ_MULTIPLIER
  );
}

/**
 * Persist one call's token usage. Best-effort: never throws and silently no-ops
 * when Mongo isn't connected (e.g. in unit tests), so it can't break a draft.
 *
 * The cache fields mirror the SDK response's `usage.cache_creation_input_tokens`
 * / `usage.cache_read_input_tokens` — pass them straight through (they are
 * `number | null` on the SDK type, and absent from calls that predate caching).
 */
export async function recordUsage(args: {
  feature: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const inputTokens = args.inputTokens ?? 0;
    const outputTokens = args.outputTokens ?? 0;
    const cacheCreationInputTokens = args.cacheCreationInputTokens ?? 0;
    const cacheReadInputTokens = args.cacheReadInputTokens ?? 0;
    await Usage.create({
      feature: args.feature,
      model: args.model,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      costUsd: estimateCostUsd(
        args.model,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      ),
    });
  } catch {
    /* usage tracking must never break a generation */
  }
}

export interface UsageSummary {
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    costUsd: number;
  };
  byModel: Array<{
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    costUsd: number;
  }>;
  recent: Array<{
    feature: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    costUsd: number;
    createdAt: Date;
  }>;
}

/** Aggregate usage for the dashboard (totals, per-model breakdown, recent calls). */
export async function getUsageSummary(): Promise<UsageSummary> {
  if (mongoose.connection.readyState !== 1) {
    return {
      totals: { calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0 },
      byModel: [],
      recent: [],
    };
  }
  const docs = await Usage.find().sort({ createdAt: -1 }).limit(500).lean();
  const totals = { calls: docs.length, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0 };
  const byModelMap = new Map<
    string,
    { model: string; calls: number; inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; costUsd: number }
  >();
  for (const d of docs) {
    // Docs written before cache telemetry existed lack the cache fields.
    const cacheWrite = d.cacheCreationInputTokens ?? 0;
    const cacheRead = d.cacheReadInputTokens ?? 0;
    totals.inputTokens += d.inputTokens;
    totals.outputTokens += d.outputTokens;
    totals.cacheCreationInputTokens += cacheWrite;
    totals.cacheReadInputTokens += cacheRead;
    totals.costUsd += d.costUsd;
    const m =
      byModelMap.get(d.model) ??
      { model: d.model, calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0 };
    m.calls += 1;
    m.inputTokens += d.inputTokens;
    m.outputTokens += d.outputTokens;
    m.cacheCreationInputTokens += cacheWrite;
    m.cacheReadInputTokens += cacheRead;
    m.costUsd += d.costUsd;
    byModelMap.set(d.model, m);
  }
  return {
    totals,
    byModel: [...byModelMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    recent: docs.slice(0, 20).map((d) => ({
      feature: d.feature,
      model: d.model,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheCreationInputTokens: d.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: d.cacheReadInputTokens ?? 0,
      costUsd: d.costUsd,
      createdAt: d.createdAt as Date,
    })),
  };
}
