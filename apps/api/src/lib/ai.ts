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
  // Per-post: write the deck's copy, arrange it into slides, write the caption.
  | 'parse'
  | 'compose'
  | 'caption';

const OVERRIDE_FIELD: Record<AiFeature, string> = {
  vision: 'visionModel',
  recipe: 'recipeModel',
  parse: 'parseModel',
  compose: 'composeModel',
  caption: 'captionModel',
};

const ENV_DEFAULT: Record<AiFeature, () => string> = {
  // Reading colors/type/voice off the homepage is a vision task → vision tier.
  vision: () => config.ai.modelLarge ?? config.ai.model!,
  caption: premiumModel,
  // Authoring the brand recipe is design-critical → design tier.
  recipe: designModel,
  /**
   * THE TWO HALVES OF A COMPOSE ARE NOT THE SAME JOB, so they do not share a
   * tier. The parse WRITES the deck's copy — every headline, every row, the
   * whole voice of the post — from one sentence of idea. It is the single most
   * quality-determining output in the product, it runs ONCE per deck, and its
   * output is a few hundred tokens: buying the better model here costs well
   * under a cent per post.
   *
   * The compose is a typesetter — it arranges copy it is forbidden to alter,
   * into classes the recipe already fixed, under a guard chain that repairs it
   * mechanically. It runs once PER SLIDE, so it is the volume call, and the
   * cheap tier is what the architecture always intended for it. (With recipe
   * fragments it often runs no model at all.)
   */
  parse: premiumModel,
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
 * env-var tier for that feature — every AI call is user-controllable. Skips the
 * DB when disconnected (unit tests) so nothing buffers or hangs.
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

/**
 * PROMPT-CACHING CONTRACT — how every AI touchpoint adopts Anthropic prompt
 * caching (the recipe author uses it today; compose/caption/vision adopt the
 * same rules later):
 *
 * 1. `aiMessage`/`aiMessageLarge` take the SDK's own params type, whose
 *    `system` is `string | Anthropic.TextBlockParam[]`. A plain string is the
 *    legacy, uncached form; a block array is passed to the SDK UNTOUCHED, so a
 *    block may carry `cache_control: { type: 'ephemeral' }`.
 * 2. Build the array with `cachedSystem(staticPart, dynamicPart?)`. It places
 *    exactly ONE cache breakpoint, on the static block. The breakpoint caches
 *    everything up to and including that block (tools would render before
 *    system, and the system prefix renders before messages).
 * 3. What belongs in `staticPart`: ONLY content that is byte-identical across
 *    every call of that feature — the frozen system prompt, worked exemplars,
 *    enum tables. No timestamps, no per-brand/per-project data, no conditional
 *    sections, nothing serialized non-deterministically.
 * 4. What belongs in `dynamicPart` / the user message: everything per-call
 *    (evidence, drafts, directions). It sits after the breakpoint, so varying
 *    it never invalidates the cached prefix.
 * 5. Cache entries are model-scoped; the refusal retry below (which swaps to
 *    the fallback model) simply pays a fresh cache write there — correctness
 *    is unaffected. Prefixes under the model's minimum cacheable size
 *    (model-dependent, ~1–4K tokens) silently don't cache; that's harmless.
 *
 * Economics (per current Anthropic pricing, mirrored in lib/usage.ts): a 5m
 * cache write costs 1.25× the input rate, a cache read 0.1× — so the second
 * identical-prefix call is already cheaper than two uncached ones.
 */
export function cachedSystem(
  staticPart: string,
  dynamicPart?: string,
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
  ];
  if (dynamicPart !== undefined && dynamicPart !== '') {
    blocks.push({ type: 'text', text: dynamicPart });
  }
  return blocks;
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

// ── Structured output: forced tool use ──────────────────────────────────────

/**
 * STRUCTURED OUTPUT, THE FORCED-TOOL-USE WAY.
 *
 * Every JSON touchpoint used to ask for "STRICT JSON only" in prose and then
 * scrape the reply — `text.indexOf('{')` … `text.lastIndexOf('}')`, plus a
 * hand-rolled markdown-fence strip. That is silent corruption waiting to happen:
 * a stray brace in a preamble, a fence the regex missed, an explanatory sentence
 * containing `{` and the parse either throws or (worse) succeeds on the wrong
 * slice.
 *
 * Instead we declare ONE tool carrying the payload's JSON Schema and set
 * `tool_choice: {type:'tool', name}` so the model MUST call it. The payload then
 * arrives as the `input` of a `tool_use` content block — already parsed by the
 * SDK, never a string we have to find the edges of. Verified against
 * @anthropic-ai/sdk 0.106: `Tool { name, description?, input_schema }`,
 * `ToolChoiceTool { type: 'tool', name }`, and `ToolUseBlock { type: 'tool_use',
 * id, name, input: unknown }` inside `Message.content`.
 *
 * PROMPT CACHING. The tool list renders BEFORE `system`, so it is part of every
 * cached prefix: each `AiJsonTool` is therefore a module-level constant whose
 * bytes never vary per call, exactly like `cachedSystem`'s static block. Nothing
 * per-brand or per-request may go in a schema.
 *
 * NOTHING HARD-FAILS. `aiJson` returns BOTH the tool input (when there is one)
 * and the reply's text, so every caller keeps its old text-scraping path as the
 * fallback — for a model that ignores the tool, a refusal-retry that lands on a
 * different model, or a request the API rejects for carrying tools at all.
 */
export interface AiJsonTool {
  /** Tool name — also the name `tool_choice` forces and the block we read back. */
  name: string;
  /** What the tool is for. The model reads this, so write it like a prompt. */
  description: string;
  /** JSON Schema for the payload. Loose by design: zod remains the real gate. */
  schema: Anthropic.Tool.InputSchema;
}

/** Loose "is a JSON object" test — a tool_use input is typed `unknown`. */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Add the forced-tool-use envelope to a request: exactly one tool, and the
 * `tool_choice` that makes calling it the only thing the model may do.
 * Non-mutating, so the caller's params object (and its cached `system`) is
 * passed on untouched.
 */
export function withJsonTool<T extends Anthropic.MessageCreateParamsNonStreaming>(
  params: T,
  tool: AiJsonTool,
): T {
  return {
    ...params,
    tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
    tool_choice: { type: 'tool', name: tool.name },
  };
}

/** The input of the named `tool_use` block, or undefined when there is none. */
export function toolInputOf(
  resp: Anthropic.Message,
  name: string,
): Record<string, unknown> | undefined {
  for (const block of resp.content) {
    if (block.type === 'tool_use' && block.name === name && isJsonObject(block.input)) {
      return block.input;
    }
  }
  return undefined;
}

/** A 400 from the API — the request itself was rejected, so a retry is pointless
 *  unless we change it. Duck-typed rather than `instanceof BadRequestError` so
 *  it also holds for tests that stub the SDK module. */
function isBadRequest(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 400;
}

export interface AiJsonResult {
  /** The validated tool input, when the model called the tool. */
  json?: Record<string, unknown>;
  /** The reply's text — the caller's scraping fallback when `json` is absent. */
  text: string;
}

/**
 * Ask for one JSON payload through forced tool use.
 *
 * @param large stream the request (`aiMessageLarge`) instead of one-shotting it —
 *              for the big authored payloads that risk a socket timeout.
 *
 * On a 400 (the one error that says "this request shape is not acceptable" — e.g.
 * a model or thinking configuration that refuses a forced `tool_choice`) it
 * retries ONCE without the tool envelope, so the caller still gets text to
 * scrape rather than an exception. Any other error propagates unchanged.
 */
export async function aiJson(
  params: Anthropic.MessageCreateParamsNonStreaming,
  tool: AiJsonTool,
  opts?: { large?: boolean },
): Promise<AiJsonResult> {
  const send = opts?.large ? aiMessageLarge : aiMessage;
  try {
    const resp = await send(withJsonTool(params, tool));
    return { json: toolInputOf(resp, tool.name), text: textOf(resp) };
  } catch (err) {
    if (!isBadRequest(err)) throw err;
    console.warn(
      `[ai] ${params.model} rejected the forced "${tool.name}" tool — retrying as plain text:`,
      err instanceof Error ? err.message : err,
    );
    return { text: textOf(await send(params)) };
  }
}
