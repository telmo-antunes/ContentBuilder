import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { RecipeEvidence } from './htmlDirector/authorRecipe';
import type { BrandRecipe } from '@contentbuilder/shared';

/**
 * Prompt-caching tests, mocked at the SDK boundary (the same seam
 * compose.test.ts stubs): the fake Anthropic client records exactly what
 * params the app would put on the wire, so these tests pin down
 * (a) system pass-through, (b) the cachedSystem block shape,
 * (c) the authorRecipe cached-prefix layout, and (d) cache telemetry pricing.
 */
const { createMock, streamMock, usageCreate, usageFind } = vi.hoisted(() => ({
  createMock: vi.fn(),
  streamMock: vi.fn(),
  usageCreate: vi.fn(),
  usageFind: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: (params: unknown) => createMock(params),
      stream: (params: unknown) => ({ finalMessage: () => streamMock(params) }),
    };
  },
}));

vi.mock('../models/Usage', () => ({
  Usage: {
    create: (doc: unknown) => usageCreate(doc),
    find: () => usageFind(),
  },
}));

const { aiMessage, aiMessageLarge, cachedSystem } = await import('./ai');
const { authorRecipe } = await import('./htmlDirector/authorRecipe');
const { dynatosRecipe, detailMastersRecipe } = await import('./htmlDirector/recipes');
const { recordUsage, estimateCostUsd, getUsageSummary } = await import('./usage');
const mongoose = (await import('mongoose')).default;

type Params = Anthropic.MessageCreateParamsNonStreaming;
type Blocks = Anthropic.TextBlockParam[];

/** A minimal successful SDK message. */
const ok = (text: string): Anthropic.Message =>
  ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }) as unknown as Anthropic.Message;

/** Count cache_control breakpoints across a system block array. */
const breakpoints = (system: Params['system']): number =>
  Array.isArray(system) ? system.filter((b) => b.cache_control != null).length : 0;

/** A substring that appears verbatim inside a recipe's serialized exemplar. */
const exemplarSnippet = (r: BrandRecipe): string => JSON.stringify(r.tokens);

const EVIDENCE: RecipeEvidence = {
  name: 'Test Brand Co',
  category: 'testing',
  colors: {
    background: '#0D1017',
    text: '#F5F3EF',
    accent: '#C9A66B',
    palette: ['#0D1017', '#F5F3EF', '#C9A66B'],
  },
  fonts: { render: { heading: 'Montserrat', body: 'Inter' } },
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  createMock.mockReset();
  streamMock.mockReset();
  usageCreate.mockReset();
  usageFind.mockReset();
});

describe('aiMessage / aiMessageLarge system pass-through', () => {
  it('passes a plain-string system through unchanged (legacy, uncached)', async () => {
    createMock.mockResolvedValue(ok('hi'));
    await aiMessage({
      model: 'claude-test',
      max_tokens: 10,
      system: 'BE BRIEF',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect((createMock.mock.calls[0]![0] as Params).system).toBe('BE BRIEF');
  });

  it('passes a cachedSystem block array to the SDK untouched', async () => {
    streamMock.mockResolvedValue(ok('hi'));
    const system = cachedSystem('STATIC PART', 'DYNAMIC PART');
    await aiMessageLarge({
      model: 'claude-test',
      max_tokens: 10,
      system,
      messages: [{ role: 'user', content: 'x' }],
    });
    // same reference — no cloning, reshaping, or stripping of cache_control
    expect((streamMock.mock.calls[0]![0] as Params).system).toBe(system);
  });
});

describe('cachedSystem', () => {
  it('puts exactly one ephemeral breakpoint on the static block', () => {
    const blocks = cachedSystem('THE FROZEN PROMPT');
    expect(blocks).toEqual([
      { type: 'text', text: 'THE FROZEN PROMPT', cache_control: { type: 'ephemeral' } },
    ]);
    expect(breakpoints(blocks)).toBe(1);
  });

  it('appends the dynamic part as a second, uncached block', () => {
    const blocks = cachedSystem('STATIC', 'DYNAMIC');
    expect(blocks).toEqual([
      { type: 'text', text: 'STATIC', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'DYNAMIC' },
    ]);
    expect(breakpoints(blocks)).toBe(1);
  });

  it('omits the dynamic block when absent or empty', () => {
    expect(cachedSystem('S')).toHaveLength(1);
    expect(cachedSystem('S', '')).toHaveLength(1);
  });
});

describe('authorRecipe cached-prefix layout', () => {
  beforeEach(() => {
    streamMock.mockImplementation(async () => ok(JSON.stringify(dynatosRecipe)));
  });

  it('author call: SYSTEM + both exemplars in the cached prefix, per-brand evidence outside it', async () => {
    await authorRecipe(EVIDENCE, { model: 'claude-test', critique: false, direction: 'go bold' });
    expect(streamMock).toHaveBeenCalledTimes(1);
    const params = streamMock.mock.calls[0]![0] as Params;
    const system = params.system as Blocks;

    // one breakpoint, on the static block, covering the whole system prefix
    expect(Array.isArray(system)).toBe(true);
    expect(breakpoints(params.system)).toBe(1);
    expect(system[system.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });

    // the cached prefix carries the frozen prompt AND both worked exemplars,
    // prompt first (same content, same order the user message used to carry)
    const sysText = system.map((b) => b.text).join('\n');
    expect(sysText).toContain('elite brand & art director');
    expect(sysText).toContain('TWO WORKED EXAMPLES');
    expect(sysText).toContain(exemplarSnippet(dynatosRecipe));
    expect(sysText).toContain(exemplarSnippet(detailMastersRecipe));
    expect(sysText.indexOf('elite brand & art director')).toBeLessThan(
      sysText.indexOf('TWO WORKED EXAMPLES'),
    );
    expect(sysText.indexOf(exemplarSnippet(dynatosRecipe))).toBeLessThan(
      sysText.indexOf(exemplarSnippet(detailMastersRecipe)),
    );

    // the user message is purely per-brand: evidence + direction, no exemplars
    const user = String(params.messages[0]!.content);
    expect(user).toContain('NOW AUTHOR THE RECIPE FOR THIS BRAND');
    expect(user).toContain('Test Brand Co');
    expect(user).toContain('go bold');
    expect(user).not.toContain('TWO WORKED EXAMPLES');
    expect(user).not.toContain(exemplarSnippet(dynatosRecipe));
    expect(user).not.toContain(exemplarSnippet(detailMastersRecipe));
  });

  it('sends a byte-identical cached prefix across different brands (the prefix-match invariant)', async () => {
    await authorRecipe(EVIDENCE, { model: 'claude-test', critique: false });
    await authorRecipe(
      { ...EVIDENCE, name: 'Another Brand' },
      { model: 'claude-test', critique: false },
    );
    const a = (streamMock.mock.calls[0]![0] as Params).system as Blocks;
    const b = (streamMock.mock.calls[1]![0] as Params).system as Blocks;
    expect(b).toEqual(a);
    expect(b[0]!.text).toBe(a[0]!.text);
  });

  it('critique call: cached CRITIQUE_SYSTEM prefix, per-brand draft in the user message', async () => {
    await authorRecipe(EVIDENCE, { model: 'claude-test' }); // critique defaults on
    expect(streamMock).toHaveBeenCalledTimes(2);
    const params = streamMock.mock.calls[1]![0] as Params;
    const system = params.system as Blocks;

    expect(breakpoints(params.system)).toBe(1);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    const sysText = system.map((b) => b.text).join('\n');
    expect(sysText).toContain('ruthless design director');
    // the critique prefix is its own cache entry — no exemplars, no evidence
    expect(sysText).not.toContain('TWO WORKED EXAMPLES');
    expect(sysText).not.toContain('Test Brand Co');

    const user = String(params.messages[0]!.content);
    expect(user).toContain('BRAND: Test Brand Co');
    expect(user).toContain('RECIPE TO REVIEW');
  });
});

describe('usage telemetry: cache fields + pricing', () => {
  beforeEach(() => {
    // recordUsage/getUsageSummary gate on a live Mongo connection
    Object.defineProperty(mongoose.connection, 'readyState', {
      get: () => 1,
      configurable: true,
    });
  });
  afterEach(() => {
    delete (mongoose.connection as unknown as Record<string, unknown>).readyState;
  });

  it('prices cache writes at 1.25× and reads at 0.1× the model input rate', () => {
    // haiku: $1/M in — write 1M = $1.25, read 1M = $0.10
    expect(estimateCostUsd('claude-haiku-4-5', 1_000_000, 0)).toBeCloseTo(1, 10);
    expect(estimateCostUsd('claude-haiku-4-5', 0, 0, 1_000_000, 0)).toBeCloseTo(1.25, 10);
    expect(estimateCostUsd('claude-haiku-4-5', 0, 0, 0, 1_000_000)).toBeCloseTo(0.1, 10);
    // multipliers follow the model's own input rate (sonnet: $3/M in)
    expect(estimateCostUsd('claude-sonnet-5', 0, 0, 1_000_000, 1_000_000)).toBeCloseTo(
      3 * 1.25 + 3 * 0.1,
      10,
    );
    // the legacy two-token call keeps its exact pre-cache behavior
    expect(estimateCostUsd('claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(18, 10);
  });

  it('records cache fields when present and prices them into costUsd', async () => {
    await recordUsage({
      feature: 'recipe',
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    });
    expect(usageCreate).toHaveBeenCalledTimes(1);
    const doc = usageCreate.mock.calls[0]![0] as Record<string, number>;
    expect(doc.cacheCreationInputTokens).toBe(1_000_000);
    expect(doc.cacheReadInputTokens).toBe(1_000_000);
    expect(doc.costUsd).toBeCloseTo(1 + 1.25 + 0.1, 10);
  });

  it('tolerates absent and null cache fields (legacy callers, SDK nulls)', async () => {
    await recordUsage({ feature: 'caption', model: 'claude-haiku-4-5', inputTokens: 10, outputTokens: 5 });
    await recordUsage({
      feature: 'caption',
      model: 'claude-haiku-4-5',
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
    });
    expect(usageCreate).toHaveBeenCalledTimes(2);
    for (const call of usageCreate.mock.calls) {
      const doc = call[0] as Record<string, number>;
      expect(doc.cacheCreationInputTokens).toBe(0);
      expect(doc.cacheReadInputTokens).toBe(0);
      expect(doc.costUsd).toBeCloseTo(estimateCostUsd('claude-haiku-4-5', 10, 5), 10);
    }
  });

  it('aggregates cache fields additively, treating pre-cache docs as zero', async () => {
    const now = new Date();
    usageFind.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [
            {
              feature: 'recipe',
              model: 'claude-test',
              inputTokens: 10,
              outputTokens: 5,
              cacheCreationInputTokens: 100,
              cacheReadInputTokens: 400,
              costUsd: 1,
              createdAt: now,
            },
            // legacy doc written before cache telemetry — no cache fields at all
            { feature: 'caption', model: 'claude-test', inputTokens: 20, outputTokens: 10, costUsd: 2, createdAt: now },
          ],
        }),
      }),
    });
    const s = await getUsageSummary();
    expect(s.totals).toMatchObject({
      calls: 2,
      inputTokens: 30,
      outputTokens: 15,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 400,
      costUsd: 3,
    });
    expect(s.byModel).toHaveLength(1);
    expect(s.byModel[0]).toMatchObject({
      model: 'claude-test',
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 400,
    });
    expect(s.recent[0]).toMatchObject({ cacheCreationInputTokens: 100, cacheReadInputTokens: 400 });
    expect(s.recent[1]).toMatchObject({ cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  });
});
