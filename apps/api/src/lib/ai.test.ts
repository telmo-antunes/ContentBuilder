import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { pickModel, withOpusReasoning, isFableFamily } from './ai';

describe('pickModel (fallback chain)', () => {
  it('returns the first non-empty candidate', () => {
    expect(pickModel(undefined, '', '  ', 'claude-opus-4-8', 'x')).toBe('claude-opus-4-8');
  });
  it('trims whitespace', () => {
    expect(pickModel('  claude-haiku-4-5  ')).toBe('claude-haiku-4-5');
  });
  it('returns undefined when nothing is set', () => {
    expect(pickModel(undefined, '', '   ')).toBeUndefined();
  });
});

describe('isFableFamily', () => {
  it('matches fable/mythos only', () => {
    expect(isFableFamily('claude-fable-5')).toBe(true);
    expect(isFableFamily('claude-opus-4-8')).toBe(false);
    expect(isFableFamily('claude-haiku-4-5')).toBe(false);
  });
});

describe('withOpusReasoning', () => {
  const base = (model: string): Anthropic.MessageCreateParamsNonStreaming => ({
    model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: 'hi' }],
  });

  it('enables adaptive thinking + high effort on reasoning-capable models', () => {
    for (const m of ['claude-opus-4-8', 'claude-fable-5', 'claude-sonnet-5']) {
      const p = withOpusReasoning(base(m)) as unknown as Record<string, unknown>;
      expect(p.thinking).toEqual({ type: 'adaptive' });
      expect(p.output_config).toEqual({ effort: 'high' });
    }
  });

  it('leaves models that reject those params untouched', () => {
    for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-6']) {
      const p = withOpusReasoning(base(m)) as unknown as Record<string, unknown>;
      expect(p.thinking).toBeUndefined();
      expect(p.output_config).toBeUndefined();
    }
  });
});
