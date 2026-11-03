import { expect, it } from 'vitest';
import { autocompleteUsageSchema } from './schema';
import { AUTOCOMPLETE_FAILURE_LIMIT, finishAutocomplete, mergeAutocompleteUsage } from './autocomplete-usage';
it('counts cumulative stream usage once, retaining partial reports', () => {
  const reported = mergeAutocompleteUsage(mergeAutocompleteUsage({ inputTokens: 100, outputTokens: 0 }, { inputTokens: 100, outputTokens: 40 }), { outputTokens: 40 });
  const result = finishAutocomplete({ ...autocompleteUsageSchema.parse({}), requests: 1 }, 'completed', reported);
  expect(result).toMatchObject({ requests: 1, completed: 1, inputTokens: 100, outputTokens: 40, unreported: 0 });
});
it('pauses after repeated failures; cancellation does not erase the failure streak', () => {
  let usage = autocompleteUsageSchema.parse({});
  for (let i = 0; i < AUTOCOMPLETE_FAILURE_LIMIT; i++) usage = finishAutocomplete(usage, 'failed', {});
  usage = finishAutocomplete(usage, 'cancelled', { inputTokens: 10 });
  expect(usage).toMatchObject({ consecutiveFailures: 3, failed: 3, cancelled: 1, unreported: 3, inputTokens: 10 });
  expect(finishAutocomplete(usage, 'completed', {}).consecutiveFailures).toBe(0);
});
