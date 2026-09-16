import { describe, expect, it } from 'vitest';
import { labelForModelId, modelOptions } from './modelCatalogue';

describe('the model catalogue behind the Settings dropdown', () => {
  it('lists the current models with their list prices, most capable first', () => {
    const ids = modelOptions([]).map((m) => m.id);
    expect(ids[0]).toBe('claude-fable-5-1');
    expect(ids).toContain('claude-opus-5');
    expect(ids).toContain('claude-sonnet-5');
    expect(ids[ids.length - 1]).toBe('claude-haiku-4-5');
    const sonnet5 = modelOptions([]).find((m) => m.id === 'claude-sonnet-5')!;
    expect([sonnet5.inUsd, sonnet5.outUsd]).toEqual([2, 10]);
  });

  it('keeps what is running today in the list — a dated env id is appended, named and priced by family', () => {
    const out = modelOptions(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'], ['claude-opus-5']);
    const dated = out.find((m) => m.id === 'claude-haiku-4-5-20251001')!;
    expect(dated).toMatchObject({ label: 'Claude Haiku 4.5 (20251001)', inUsd: 1, outUsd: 5, source: 'env' });
    // Ids already in the catalogue are not duplicated.
    expect(out.filter((m) => m.id === 'claude-sonnet-4-6')).toHaveLength(1);
    expect(out.filter((m) => m.id === 'claude-opus-5')).toHaveLength(1);
  });

  it('names an unfamiliar id readably and falls back to the id itself when it is not a Claude id', () => {
    expect(labelForModelId('claude-sonnet-5')).toBe('Claude Sonnet 5');
    expect(labelForModelId('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(labelForModelId('my-proxy-model')).toBe('my-proxy-model');
  });
});
