/**
 * THE MODELS A JOB CAN RUN ON — for the Settings dropdown.
 *
 * The override used to be a free text field, so choosing a model meant
 * remembering an exact id ("claude-haiku-4-5-20251001") and a typo ran the job
 * on a 404. This is the list the page offers instead: current Anthropic
 * models with their list prices, so the choice is made with the cost in view.
 *
 * Prices are USD per million tokens, list rates (cached 2026-06-24). They
 * feed the label only; cost accounting lives in `usage.ts`.
 */
export interface ModelOption {
  id: string;
  label: string;
  /** Input / output list price, USD per 1M tokens. */
  inUsd: number;
  outUsd: number;
  /** Where it came from: the catalogue, the environment, or a stored override. */
  source: 'catalogue' | 'env' | 'stored';
}

const CATALOGUE: ReadonlyArray<Omit<ModelOption, 'source'>> = [
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', inUsd: 10, outUsd: 50 },
  { id: 'claude-opus-5', label: 'Claude Opus 5', inUsd: 5, outUsd: 25 },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', inUsd: 5, outUsd: 25 },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', inUsd: 5, outUsd: 25 },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', inUsd: 5, outUsd: 25 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', inUsd: 2, outUsd: 10 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', inUsd: 3, outUsd: 15 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', inUsd: 1, outUsd: 5 },
];

/** A readable name for an id the catalogue does not carry — "claude-haiku-4-5-20251001" → "Claude Haiku 4.5 (20251001)". */
export function labelForModelId(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-(\d{8}))?$/i.exec(id);
  if (!m) return id;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `Claude ${family} ${version}${m[4] ? ` (${m[4]})` : ''}`;
}

/** List price by family for an id outside the catalogue — the same families `usage.ts` prices by. */
function priceFor(id: string): { inUsd: number; outUsd: number } {
  if (/fable|mythos/i.test(id)) return { inUsd: 10, outUsd: 50 };
  if (/haiku/i.test(id)) return { inUsd: 1, outUsd: 5 };
  if (/sonnet-5\b/i.test(id)) return { inUsd: 2, outUsd: 10 };
  if (/sonnet/i.test(id)) return { inUsd: 3, outUsd: 15 };
  if (/opus/i.test(id)) return { inUsd: 5, outUsd: 25 };
  return { inUsd: 3, outUsd: 15 };
}

/**
 * The catalogue, plus any id the environment or a stored override already
 * names that the catalogue does not — so what is running today is always in
 * the list, never silently "Other".
 */
export function modelOptions(env: ReadonlyArray<string>, stored: ReadonlyArray<string> = []): ModelOption[] {
  const out: ModelOption[] = CATALOGUE.map((m) => ({ ...m, source: 'catalogue' }));
  const seen = new Set(out.map((m) => m.id));
  const add = (id: string, source: ModelOption['source']) => {
    const clean = id.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({ id: clean, label: labelForModelId(clean), ...priceFor(clean), source });
  };
  for (const id of env) add(id, 'env');
  for (const id of stored) add(id, 'stored');
  return out;
}
