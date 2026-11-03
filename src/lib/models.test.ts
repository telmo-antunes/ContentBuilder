import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ list: vi.fn(), retrieve: vi.fn(), stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class Client {
    static APIError = actual.default.APIError;
    models = { list: mock.list, retrieve: mock.retrieve };
    messages = { stream: mock.stream };
  }
  return { ...actual, default: Client };
});
import Anthropic from '@anthropic-ai/sdk';
import { modelCatalog, modelProblem, resolveModel } from './models';
import { ask } from './ai';

const info = (id: string, vision = true, structured = true) => ({ id, display_name: id, max_tokens: 8192, capabilities: { image_input: { supported: vision }, structured_outputs: { supported: structured } } });
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('ANTHROPIC_API_KEY', 'test-key'); vi.stubEnv('ANTHROPIC_MODEL', 'configured');
  delete (globalThis as typeof globalThis & { contentBuilderModels?: unknown }).contentBuilderModels;
  mock.list.mockImplementation(async function* () { yield info('configured'); yield info('chosen'); });
});
afterEach(() => vi.unstubAllEnvs());
describe('per-action models', () => {
  it('discovers provider choices and caches the catalog without replacing explicit selections', async () => {
    expect((await modelCatalog()).models.map(m => m.id)).toEqual(['configured', 'chosen']);
    expect((await resolveModel('chosen', true, signal())).id).toBe('chosen');
    expect((await resolveModel('', true, signal())).id).toBe('configured');
    expect(mock.list).toHaveBeenCalledTimes(1);
  });
  it('resolves saved aliases to the provider response', async () => {
    mock.retrieve.mockResolvedValue(info('canonical-model'));
    expect((await resolveModel('saved-alias', true, signal())).id).toBe('canonical-model');
    expect(mock.retrieve.mock.calls[0][0]).toBe('saved-alias');
  });
  it('checks the capabilities required by each action', () => {
    const model = { id: 'a', name: 'A', vision: true, structured: false, maxTokens: null };
    expect(modelProblem(model, false)).toBeUndefined();
    expect(modelProblem(model, true)).toContain('structured');
    expect(modelProblem({ ...model, vision: false }, false)).toContain('images');
    expect(modelProblem({ ...model, vision: false, structured: true }, true, false)).toBeUndefined();
  });
  it('does not substitute the default for an unavailable explicit model', async () => {
    mock.retrieve.mockRejectedValue(new Anthropic.APIError(404, undefined, 'Missing model', new Headers()));
    await expect(resolveModel('missing', true, signal())).rejects.toThrow('selected model “missing” is unavailable');
  });
  it('keeps only the same configured ID usable during discovery outages', async () => {
    mock.list.mockImplementation(() => { throw new Error('Offline'); }); mock.retrieve.mockRejectedValue(new Error('Offline'));
    expect((await resolveModel('', true, signal())).id).toBe('configured');
    await expect(resolveModel('chosen', true, signal())).rejects.toThrow('Could not verify');
  });
  it('sends the chosen model and its output limit to the provider, reporting usage', async () => {
    mock.stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ model: 'chosen-snapshot', stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 12 }, content: [{ type: 'text', text: 'Result' }] }) });
    const usage = vi.fn();
    expect(await ask('System', 'Brief', { signal: signal(), progress: vi.fn(), usage }, true, 'chosen')).toBe('Result');
    expect(mock.stream.mock.calls[0][0]).toMatchObject({ model: 'chosen', max_tokens: 8192, output_config: { format: { type: 'json_schema' } } });
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ model: 'chosen-snapshot', inputTokens: 50, outputTokens: 12 }));
  });
  it('resolves latest within the chosen category without switching tiers', async () => {
    mock.list.mockImplementation(async function* () { yield info('claude-haiku-4-5'); yield info('claude-opus-6'); yield info('claude-haiku-5-5'); yield info('claude-sonnet-5'); });
    expect((await resolveModel('latest:haiku', true, signal(), false)).id).toBe('claude-haiku-5-5');
    expect((await resolveModel('latest:sonnet', true, signal())).id).toBe('claude-sonnet-5');
  });
  it('bounds the full stream lifetime, including a stalled body after connection', async () => {
    mock.stream.mockImplementation((_body, options) => ({ on: vi.fn(), finalMessage: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })) }));
    await expect(ask('System', 'Brief', { signal: signal(), progress: vi.fn(), usage: vi.fn() }, true, 'chosen', { timeoutMs: 20 })).rejects.toThrow('did not finish within');
  });
  it('configures supported effort and quick writing without forcing a thinking mode on other models', async () => {
    mock.list.mockImplementation(async function* () { yield { ...info('claude-haiku-5-5'), max_tokens: 128000, capabilities: { ...info('claude-haiku-5-5').capabilities, effort: { supported: true, low: { supported: true }, medium: { supported: true } } } }; });
    mock.stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 12, output_tokens_details: { thinking_tokens: 0 } }, content: [{ type: 'text', text: 'Result' }] }) });
    const usage = vi.fn();
    await ask('System', 'Brief', { signal: signal(), progress: vi.fn(), usage }, true, 'latest:haiku', { effort: 'low', quickWriting: true, maxTokens: 400 });
    expect(mock.stream.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 400, output_config: { effort: 'low', format: { type: 'json_schema' } }, thinking: { type: 'disabled' } });
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ thinkingTokens: 0, effort: 'low' }));
  });
});
