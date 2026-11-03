import type { AutocompleteUsage } from './schema';
import type { UsageInfo } from './operation';
export const AUTOCOMPLETE_FAILURE_LIMIT = 3;
export function mergeAutocompleteUsage(previous: UsageInfo, next: UsageInfo): UsageInfo {
  const merged = { ...previous, ...next };
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (previous[key] !== undefined || next[key] !== undefined) merged[key] = Math.max(0, previous[key] ?? 0, next[key] ?? 0);
  }
  return merged;
}
export function finishAutocomplete(usage: AutocompleteUsage, outcome: 'completed' | 'failed' | 'cancelled', reported: UsageInfo): AutocompleteUsage {
  return { ...usage, [outcome]: usage[outcome] + 1,
    inputTokens: usage.inputTokens + (reported.inputTokens ?? 0), outputTokens: usage.outputTokens + (reported.outputTokens ?? 0),
    cacheReadTokens: usage.cacheReadTokens + (reported.cacheReadTokens ?? 0), cacheWriteTokens: usage.cacheWriteTokens + (reported.cacheWriteTokens ?? 0),
    unreported: usage.unreported + (reported.inputTokens === undefined && reported.outputTokens === undefined ? 1 : 0),
    consecutiveFailures: outcome === 'completed' ? 0 : outcome === 'failed' ? usage.consecutiveFailures + 1 : usage.consecutiveFailures,
  };
}
