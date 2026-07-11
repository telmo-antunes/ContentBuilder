import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import { config } from '../config';
import { SettingModel } from '../models';

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

/** Every non-draft AI touchpoint, each individually overridable from Settings. */
export type AiFeature = 'vision' | 'critique' | 'caption' | 'campaign' | 'background' | 'templates' | 'alternatives';

const OVERRIDE_FIELD: Record<AiFeature, string> = {
  vision: 'visionModel',
  critique: 'critiqueModel',
  caption: 'captionModel',
  campaign: 'campaignModel',
  background: 'backgroundModel',
  templates: 'templatesModel',
  alternatives: 'alternativesModel',
};

const ENV_DEFAULT: Record<AiFeature, () => string> = {
  vision: () => config.ai.modelLarge ?? config.ai.model!,
  critique: () => config.ai.modelLarge ?? config.ai.model!,
  caption: premiumModel,
  campaign: premiumModel,
  background: () => config.ai.modelSmall ?? config.ai.model!,
  // Composition design is spatial-JSON work like free drafts → judgment tier.
  templates: premiumModel,
  alternatives: premiumModel,
};

/**
 * Resolve the model for a touchpoint: the AI Settings override wins, else the
 * env-var tier for that feature. (The two DRAFT paths resolve their own
 * overrides in draft.ts — together that makes every AI call user-controllable.)
 * Skips the DB when disconnected (unit tests) so nothing buffers or hangs.
 */
export async function modelFor(feature: AiFeature): Promise<string> {
  if (mongoose.connection.readyState === 1) {
    try {
      const doc = await SettingModel.findOne({ key: 'ai' }).lean<Record<string, unknown>>();
      const override = doc?.[OVERRIDE_FIELD[feature]];
      if (typeof override === 'string' && override.trim()) return override.trim();
    } catch {
      /* settings unavailable → env default */
    }
  }
  return ENV_DEFAULT[feature]();
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
