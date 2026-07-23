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

/** First non-empty candidate — the model fallback-chain primitive (pure/testable). */
export function pickModel(...candidates: Array<string | undefined>): string | undefined {
  return candidates.find((c) => typeof c === 'string' && c.trim() !== '')?.trim();
}

/** The premium tier for once-per-asset judgment calls; falls back down the stack. */
export function premiumModel(): string {
  return config.ai.modelLarge ?? config.ai.modelSmall ?? config.ai.model!;
}

/**
 * The DESIGN-critical tier: the Brand Design Director (layouts + authored
 * backgrounds). Prefers the dedicated design model, then the judgment stack, so
 * an unset `ANTHROPIC_MODEL_DESIGN` still designs — just on a cheaper model.
 */
export function designModel(): string {
  return pickModel(config.ai.modelDesign, config.ai.modelLarge, config.ai.modelSmall, config.ai.model)!;
}

/** Every live AI touchpoint, each individually overridable from Settings. */
export type AiFeature =
  // Onboarding: read the brand from its site (vision), then author its recipe.
  | 'vision'
  | 'recipe'
  // Per-post: compose the idea into authored slides, write the caption, fit a photo.
  | 'compose'
  | 'caption'
  | 'photofit';

const OVERRIDE_FIELD: Record<AiFeature, string> = {
  vision: 'visionModel',
  recipe: 'recipeModel',
  compose: 'composeModel',
  caption: 'captionModel',
  photofit: 'photoFitModel',
};

const ENV_DEFAULT: Record<AiFeature, () => string> = {
  // Reading colors/type/voice off the homepage is a vision task → vision tier.
  vision: () => config.ai.modelLarge ?? config.ai.model!,
  // Judging photos against copy is a vision task → vision tier.
  photofit: () => config.ai.modelLarge ?? config.ai.model!,
  caption: premiumModel,
  // Authoring the brand recipe is design-critical → design tier; composing an
  // idea into authored slides is a mechanical parse+arrange → cheap tier.
  recipe: designModel,
  compose: () => config.ai.modelSmall ?? config.ai.model!,
};

/**
 * Models that accept adaptive extended thinking + a high reasoning-effort knob.
 * Haiku and Sonnet-4.x reject these params (400), so `withOpusReasoning` gates on
 * this family and leaves everything else untouched.
 */
const REASONING_MODELS = /opus-4|fable|mythos|sonnet-5/i;

/**
 * Turn on adaptive thinking + high effort for a design/spatial-reasoning call —
 * but only when the resolved model supports them. Safe to call unconditionally.
 */
export function withOpusReasoning<T extends Anthropic.MessageCreateParamsNonStreaming>(params: T): T {
  if (REASONING_MODELS.test(params.model)) {
    params.thinking = { type: 'adaptive' };
    params.output_config = { effort: 'high' };
  }
  return params;
}

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

/**
 * Like `aiMessage`, but STREAMED — for large authored outputs (e.g. SVG
 * background sets at 20–30K max_tokens) where a non-streaming request risks an
 * SDK/socket timeout. Returns the assembled final message. Same Fable-family
 * refusal-retry semantics.
 */
export async function aiMessageLarge(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const client = aiClient();
  const resp = await client.messages.stream(params).finalMessage();
  if (resp.stop_reason === 'refusal' && isFableFamily(params.model)) {
    console.warn(`[ai] ${params.model} declined a request — retrying on ${FALLBACK_MODEL}`);
    return client.messages.stream({ ...params, model: FALLBACK_MODEL }).finalMessage();
  }
  return resp;
}

/** First text block of a response ('' when absent/refused). */
export function textOf(resp: Anthropic.Message): string {
  const part = resp.content.find((c) => c.type === 'text');
  return part && 'text' in part ? part.text : '';
}
