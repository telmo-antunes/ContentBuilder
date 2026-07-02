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

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES.find((x) => x.match.test(model)) ?? DEFAULT_PRICE;
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}

/**
 * Persist one call's token usage. Best-effort: never throws and silently no-ops
 * when Mongo isn't connected (e.g. in unit tests), so it can't break a draft.
 */
export async function recordUsage(args: {
  feature: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const inputTokens = args.inputTokens ?? 0;
    const outputTokens = args.outputTokens ?? 0;
    await Usage.create({
      feature: args.feature,
      model: args.model,
      inputTokens,
      outputTokens,
      costUsd: estimateCostUsd(args.model, inputTokens, outputTokens),
    });
  } catch {
    /* usage tracking must never break a generation */
  }
}

export interface UsageSummary {
  totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  byModel: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  recent: Array<{ feature: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; createdAt: Date }>;
}

/** Aggregate usage for the dashboard (totals, per-model breakdown, recent calls). */
export async function getUsageSummary(): Promise<UsageSummary> {
  if (mongoose.connection.readyState !== 1) {
    return { totals: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, byModel: [], recent: [] };
  }
  const docs = await Usage.find().sort({ createdAt: -1 }).limit(500).lean();
  const totals = { calls: docs.length, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const byModelMap = new Map<string, { model: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const d of docs) {
    totals.inputTokens += d.inputTokens;
    totals.outputTokens += d.outputTokens;
    totals.costUsd += d.costUsd;
    const m = byModelMap.get(d.model) ?? { model: d.model, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    m.calls += 1;
    m.inputTokens += d.inputTokens;
    m.outputTokens += d.outputTokens;
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
      costUsd: d.costUsd,
      createdAt: d.createdAt as Date,
    })),
  };
}
