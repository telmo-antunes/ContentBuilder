import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

/**
 * Central Anthropic call helper. One place for model-family quirks so the
 * feature modules (vision, draft, caption, campaign, critique) stay clean.
 *
 * Claude Fable 5 notes (see platform docs):
 * - Thinking is ALWAYS on; never send `thinking: {type: "disabled"}` (400).
 *   Omitting the param (or explicit `{type: "adaptive"}`) is correct.
 * - Thinking tokens count against `max_tokens` — callers pass roomier caps.
 * - Safety classifiers can return HTTP 200 with `stop_reason: "refusal"` and
 *   empty/partial content. We retry the identical request once on Opus 4.8 so
 *   a rare false positive never fails a user-facing generation. (Server-side
 *   `fallbacks` is the long-term home for this once we adopt the beta.)
 */

const FALLBACK_MODEL = 'claude-opus-4-8';

/** Fable/Mythos-family models share the always-on-thinking + refusal surface. */
export function isFableFamily(model: string): boolean {
  return /fable|mythos/i.test(model);
}

/** The premium tier for once-per-asset judgment calls; falls back down the stack. */
export function premiumModel(): string {
  return config.ai.modelLarge ?? config.ai.modelSmall ?? config.ai.model!;
}

export function aiClient(): Anthropic {
  return new Anthropic({ apiKey: config.ai.apiKey });
}

/** Create a message; on a Fable-family refusal, retry once on the fallback model. */
export async function aiMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const client = aiClient();
  const resp = await client.messages.create(params);
  if (resp.stop_reason === 'refusal' && isFableFamily(params.model)) {
    console.warn(`[ai] ${params.model} declined a request — retrying on ${FALLBACK_MODEL}`);
    return client.messages.create({ ...params, model: FALLBACK_MODEL });
  }
  return resp;
}

/** First text block of a response ('' when absent/refused). */
export function textOf(resp: Anthropic.Message): string {
  const part = resp.content.find((c) => c.type === 'text');
  return part && 'text' in part ? part.text : '';
}
