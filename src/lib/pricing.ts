import type { Workspace } from './schema';

// US dollars per million tokens: input, output, cache read. Cache writes cost 1.25 × input (5-minute cache).
// Anthropic first-party rates as of October 2026; Haiku 5.5's rate is for prompts up to 100K tokens.
const RATES: [RegExp, number, number, number][] = [
  [/^claude-(fable|mythos)-5/, 10, 50, 0.25],
  [/^claude-opus-5-5/, 4, 20, 0.2],
  [/^claude-opus-(5|4)/, 5, 25, 0.5],
  [/^claude-sonnet-5/, 2, 10, 0.2],
  [/^claude-sonnet-4/, 3, 15, 0.3],
  [/^claude-haiku-5-5/, 0.1, 0.5, 0.01],
  [/^claude-haiku-4/, 1, 5, 0.1],
];
export interface CallUsage { model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
/** The cost of one model call in US dollars, or null for a model without a known rate. */
export function callCost(usage: CallUsage): number | null {
  const rate = RATES.find(([pattern]) => pattern.test(usage.model ?? ''));
  if (!rate) return null;
  const [, input, output, read] = rate;
  return ((usage.inputTokens ?? 0) * input + (usage.outputTokens ?? 0) * output + (usage.cacheReadTokens ?? 0) * read + (usage.cacheWriteTokens ?? 0) * input * 1.25) / 1_000_000;
}
export function addSpend(workspace: Workspace, usd: number | undefined): Workspace {
  if (!usd || !Number.isFinite(usd) || usd <= 0) return workspace;
  const spend = workspace.spend;
  return { ...workspace, spend: { ...spend, post: spend.post + usd, total: spend.total + usd, since: spend.since || new Date().toISOString() } };
}
export function dollars(usd: number): string {
  return usd < 0.01 && usd > 0 ? '< $0.01' : `$${usd.toFixed(2)}`;
}
