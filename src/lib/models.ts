import Anthropic from '@anthropic-ai/sdk';
import type { ModelInfo } from '@anthropic-ai/sdk/resources/models';
import { createHash } from 'node:crypto';
import { RequestError } from './http';
import { latestInFamily, modelFamilies } from './model-choice';

export interface ModelOption { id: string; name: string; vision: boolean | null; structured: boolean | null; maxTokens: number | null; createdAt?: string; efforts?: Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'> }
export interface ModelCatalog { models: ModelOption[]; defaultModel: string }
const state = globalThis as typeof globalThis & { contentBuilderModels?: { key: string; expires: number; value: ModelCatalog } };
export function modelOption(model: ModelInfo): ModelOption {
  return { id: model.id, name: model.display_name, vision: model.capabilities?.image_input.supported ?? null,
    structured: model.capabilities?.structured_outputs.supported ?? null, maxTokens: model.max_tokens, createdAt: model.created_at,
    efforts: model.capabilities?.effort?.supported ? (['low', 'medium', 'high', 'xhigh', 'max'] as const).filter(level => model.capabilities?.effort?.[level]?.supported) : [] };
}
export function modelProblem(model: ModelOption, structured: boolean, vision = true): string | undefined {
  if (vision && model.vision === false) return 'This model does not accept the website and slide images used by this action.';
  if (structured && model.structured === false) return 'This model does not support the structured response required by this action.';
}
export async function modelCatalog(refresh = false, signal?: AbortSignal): Promise<ModelCatalog> {
  const key = createHash('sha256').update(`capabilities-v2|${process.env.ANTHROPIC_API_KEY ?? ''}|${process.env.ANTHROPIC_BASE_URL ?? ''}|${process.env.ANTHROPIC_MODEL ?? ''}`).digest('hex');
  if (!refresh && state.contentBuilderModels?.key === key && state.contentBuilderModels.expires > Date.now()) return state.contentBuilderModels.value;
  if (!process.env.ANTHROPIC_API_KEY) throw new RequestError('Set ANTHROPIC_API_KEY in .env to load available models.', 503);
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 15_000 });
    const models: ModelOption[] = [];
    for await (const model of client.models.list({ limit: 100 }, { signal })) models.push(modelOption(model));
    const value = { models, defaultModel: process.env.ANTHROPIC_MODEL ?? '' };
    state.contentBuilderModels = { key, expires: Date.now() + 300_000, value }; return value;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Anthropic.APIError && error.status === 401) throw new RequestError('The AI key was rejected. Check ANTHROPIC_API_KEY in .env.', 503);
    throw new RequestError('The provider’s model list is unavailable. Retry, or use your default model if configured.', 503);
  }
}
export async function resolveModel(selection: string | undefined, structured: boolean, signal: AbortSignal, vision = true): Promise<ModelOption> {
  let id = selection?.trim() || process.env.ANTHROPIC_MODEL;
  if (!id) throw new RequestError('Choose a model for this action or set ANTHROPIC_MODEL in .env.', 503);
  let catalog: ModelCatalog | undefined;
  try { catalog = await modelCatalog(false, signal); }
  catch { signal.throwIfAborted(); }
  if (id.startsWith('latest:')) {
    const family = id.slice(7);
    const latest = catalog && modelFamilies.some(value => value === family) ? latestInFamily(catalog.models, family) : undefined;
    if (!latest) throw new RequestError('Could not find the latest model in this category. Refresh the model list or choose an available model.', 503);
    id = latest.id;
  }
  let model = catalog?.models.find(item => item.id === id);
  if (!model) {
    // Resolve aliases and imported model selections without changing the choice.
    try {
      model = modelOption(await new Anthropic({ maxRetries: 0, timeout: 15_000 }).models.retrieve(id, {}, { signal }));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Anthropic.APIError && [400, 401, 403, 404].includes(error.status ?? 0)) throw new RequestError(`The selected model “${id}” is unavailable. Choose another model for this action.`, 422);
      // The configured default already worked before model discovery existed.
      // Keep that same ID on a discovery outage; never substitute another model.
      if (selection) throw new RequestError('Could not verify the selected model. Retry loading the model list.', 503);
      model = { id, name: id, vision: null, structured: null, maxTokens: null };
    }
  }
  const problem = modelProblem(model, structured, vision);
  if (problem) throw new RequestError(problem, 422);
  return model;
}
