import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { composeRecipeLayers, validateRecipeConsistency } from '@contentbuilder/shared';

/**
 * STRUCTURED OUTPUT — forced tool use, mocked at the SDK boundary (the same seam
 * ai.cache.test.ts stubs), so the real `aiJson`, the real recipe author and the
 * real compose parse all run against canned replies.
 *
 * What these pin down:
 *   1. the wire shape — one tool, `tool_choice: {type:'tool', name}` — and that
 *      the payload is read off the tool_use block rather than scraped;
 *   2. that a reply WITHOUT a tool_use block still succeeds through the old
 *      text-scraping path (an older model, a refusal retry, a 400 on tools);
 *   3. that the prompt-cached system prefix is byte-identical with the tools
 *      present — the cache invariant the tool list must not break;
 *   4. that an authored recipe carries `layers` and a `stylesheet` that equals
 *      their composition, while a recipe with no layers is untouched.
 */
const { createMock, streamMock, storageRead } = vi.hoisted(() => ({
  createMock: vi.fn(),
  streamMock: vi.fn(),
  storageRead: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: (params: unknown) => createMock(params),
      stream: (params: unknown) => ({ finalMessage: () => streamMock(params) }),
    };
  },
}));

vi.mock('../storage', () => ({
  getStorage: () => ({ read: (key: string) => storageRead(key) }),
}));

const { aiJson, cachedSystem, withJsonTool, toolInputOf } = await import('./ai');
const { authorRecipe } = await import('./htmlDirector/authorRecipe');
const { parseForCompose } = await import('./htmlDirector/compose');
const { dynatosRecipe } = await import('./htmlDirector/recipes');
const { PROMPT_VERSION } = await import('./promptVersion');

type Params = Anthropic.MessageCreateParamsNonStreaming;
type Blocks = Anthropic.TextBlockParam[];

/** A reply that CALLED the tool — the payload arrives already parsed. */
const toolReply = (name: string, input: unknown): Anthropic.Message =>
  ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'toolu_test', name, input }],
  }) as unknown as Anthropic.Message;

/** A reply that ignored the tool and wrote prose — the fallback path. */
const textReply = (text: string): Anthropic.Message =>
  ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }) as unknown as Anthropic.Message;

const TOOL = {
  name: 'emit_thing',
  description: 'Deliver the thing.',
  schema: { type: 'object' as const, properties: { a: { type: 'string' } }, required: ['a'] },
};

const EVIDENCE = {
  name: 'Test Brand Co',
  category: 'testing',
  colors: { background: '#0D1017', text: '#F5F3EF', accent: '#C9A66B' },
  fonts: { render: { heading: 'Montserrat', body: 'Inter' } },
};

const RUN = { model: 'claude-test', critique: false } as const;

/** A layered recipe payload: three layers, every advertised class defined. */
const LAYERS = {
  background: '.cb-slide{ background:#0f0b06; color:#ece4d3; }',
  type: '.cb-slide .headline{ font-size:112px; }\n.cb-slide .body{ font-size:46px; }',
  components: '.cb-slide .cta{ padding:28px 46px; }\n.cb-slide .cb-shot{ filter:saturate(.9); }',
};

const layeredPayload = (layers = LAYERS) => ({
  tokens: {
    ground: '#0f0b06',
    ink: '#ece4d3',
    accent: '#fcbc04',
    displayFamily: 'Oswald',
    bodyFamily: 'Inter',
    radius: 10,
  },
  signature: { name: 'gold italic payoff', description: 'A gold italic-serif line under the headline.' },
  layers,
  components: [
    { className: 'headline', use: 'The main statement.' },
    { className: 'body', use: 'One supporting sentence.' },
    { className: 'cta', use: 'The call-to-action button.' },
  ],
  voice: { description: 'Direct and plain.' },
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  createMock.mockReset();
  streamMock.mockReset();
  storageRead.mockReset();
});

describe('aiJson: forced tool use', () => {
  it('sends exactly one tool and a tool_choice that forces it', async () => {
    createMock.mockResolvedValue(toolReply(TOOL.name, { a: 'x' }));
    await aiJson({ model: 'claude-test', max_tokens: 10, messages: [{ role: 'user', content: 'go' }] }, TOOL);

    const params = createMock.mock.calls[0]![0] as Params;
    expect(params.tools).toEqual([
      { name: 'emit_thing', description: 'Deliver the thing.', input_schema: TOOL.schema },
    ]);
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'emit_thing' });
  });

  it('returns the tool input verbatim — no string scraping anywhere', async () => {
    // A payload that string-scraping would mangle: braces inside the values, and
    // a fenced block in a field. `indexOf('{')`/`lastIndexOf('}')` would cut it
    // to pieces; reading the tool_use block cannot.
    const input = { a: 'a } brace { in prose', b: '```json\n{"not":"the payload"}\n```', c: { d: [1, 2] } };
    createMock.mockResolvedValue(toolReply(TOOL.name, input));
    const reply = await aiJson({ model: 'claude-test', max_tokens: 10, messages: [] }, TOOL);

    expect(reply.json).toEqual(input);
    expect(reply.text).toBe(''); // there was no text block to scrape in the first place
  });

  it('ignores a tool_use block from a different tool', async () => {
    createMock.mockResolvedValue(toolReply('some_other_tool', { a: 'x' }));
    const reply = await aiJson({ model: 'claude-test', max_tokens: 10, messages: [] }, TOOL);
    expect(reply.json).toBeUndefined();
  });

  it('falls back to the reply text when no tool_use block comes back', async () => {
    createMock.mockResolvedValue(textReply('```json\n{"a":"x"}\n```'));
    const reply = await aiJson({ model: 'claude-test', max_tokens: 10, messages: [] }, TOOL);

    expect(reply.json).toBeUndefined();
    expect(reply.text).toContain('{"a":"x"}');
  });

  it('retries once WITHOUT the tool when the API rejects the forced tool (400)', async () => {
    createMock
      .mockRejectedValueOnce(Object.assign(new Error('tool_choice not supported'), { status: 400 }))
      .mockResolvedValueOnce(textReply('{"a":"x"}'));
    const reply = await aiJson({ model: 'claude-test', max_tokens: 10, messages: [] }, TOOL);

    expect(createMock).toHaveBeenCalledTimes(2);
    const retried = createMock.mock.calls[1]![0] as Params;
    expect(retried.tools).toBeUndefined();
    expect(retried.tool_choice).toBeUndefined();
    expect(reply.text).toBe('{"a":"x"}');
  });

  it('propagates any other failure instead of paying for a second call', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
    await expect(aiJson({ model: 'claude-test', max_tokens: 10, messages: [] }, TOOL)).rejects.toThrow(
      'overloaded',
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the cached system prefix byte-identical (the prefix-match invariant)', async () => {
    createMock.mockResolvedValue(toolReply(TOOL.name, { a: 'x' }));
    const system = cachedSystem('THE FROZEN PROMPT');
    const params = { model: 'claude-test', max_tokens: 10, system, messages: [] };

    await aiJson(params, TOOL);
    await aiJson(params, TOOL);

    const first = createMock.mock.calls[0]![0] as Params;
    const second = createMock.mock.calls[1]![0] as Params;
    // same array, untouched — the tool envelope is added alongside, never inside
    expect(first.system).toBe(system);
    expect(second.system).toBe(system);
    expect(JSON.stringify(second.system)).toBe(JSON.stringify(first.system));
    expect((first.system as Blocks)[0]!.cache_control).toEqual({ type: 'ephemeral' });
    // …and the tool bytes are identical call to call, so the whole prefix is
    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools));
  });

  it('withJsonTool does not mutate the params it is given', () => {
    const params: Params = { model: 'claude-test', max_tokens: 10, messages: [] };
    const withTool = withJsonTool(params, TOOL);
    expect(withTool).not.toBe(params);
    expect(params.tools).toBeUndefined();
    expect(withTool.tools).toHaveLength(1);
  });

  it('toolInputOf ignores a non-object tool input', () => {
    expect(toolInputOf(toolReply(TOOL.name, 'just a string'), TOOL.name)).toBeUndefined();
    expect(toolInputOf(toolReply(TOOL.name, { a: 1 }), TOOL.name)).toEqual({ a: 1 });
  });
});

describe('the recipe author through forced tool use', () => {
  it('authors from the tool payload, with no JSON in the text at all', async () => {
    streamMock.mockResolvedValue(toolReply('author_recipe', layeredPayload()));
    const recipe = await authorRecipe(EVIDENCE, RUN);

    const params = streamMock.mock.calls[0]![0] as Params;
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'author_recipe' });
    expect(recipe.signature.name).toBe('gold italic payoff');
    expect(recipe.components.map((c) => c.className)).toEqual(['headline', 'body', 'cta']);
  });

  it('carries `layers`, and its `stylesheet` IS their composition', async () => {
    streamMock.mockResolvedValue(toolReply('author_recipe', layeredPayload()));
    const recipe = await authorRecipe(EVIDENCE, RUN);

    expect(recipe.layers).toEqual(LAYERS);
    expect(recipe.stylesheet).toBe(composeRecipeLayers(recipe.layers));
    expect(recipe.stylesheet).toBe(`${LAYERS.background}\n${LAYERS.type}\n${LAYERS.components}`);
    // and because the two agree, the self-consistency gate finds every class the
    // layers define — a stale `stylesheet` would have dropped all three
    expect(validateRecipeConsistency(recipe).dropped).toEqual([]);
  });

  it('sanitises each layer in its own right', async () => {
    streamMock.mockResolvedValue(
      toolReply('author_recipe', layeredPayload({
        ...LAYERS,
        type: '@import url(https://evil.test/x.css); .cb-slide .headline{ font-size:112px; }\n.cb-slide .body{ font-size:46px; }',
      })),
    );
    const recipe = await authorRecipe(EVIDENCE, RUN);

    expect(recipe.layers!.type).not.toContain('@import');
    expect(recipe.stylesheet).not.toContain('@import');
    expect(recipe.stylesheet).toBe(composeRecipeLayers(recipe.layers));
  });

  it('stamps the prompt versions that wrote it', async () => {
    streamMock.mockResolvedValue(toolReply('author_recipe', layeredPayload()));
    const draftOnly = await authorRecipe(EVIDENCE, RUN);
    expect(draftOnly.promptVersion).toEqual({ author: PROMPT_VERSION.author });

    streamMock.mockReset();
    streamMock
      .mockResolvedValueOnce(toolReply('author_recipe', layeredPayload()))
      .mockResolvedValueOnce(toolReply('review_recipe', { verdict: 'pass' }));
    const reviewed = await authorRecipe(EVIDENCE, { model: 'claude-test' });
    expect(reviewed.promptVersion).toEqual({
      author: PROMPT_VERSION.author,
      critique: PROMPT_VERSION.critique,
    });
  });

  it('still authors when the model ignores the tool (text-scraping fallback)', async () => {
    streamMock.mockResolvedValue(
      textReply(`Here is the recipe you asked for:\n\`\`\`json\n${JSON.stringify(layeredPayload())}\n\`\`\``),
    );
    const recipe = await authorRecipe(EVIDENCE, RUN);

    expect(recipe.layers).toEqual(LAYERS);
    expect(recipe.stylesheet).toBe(composeRecipeLayers(recipe.layers));
  });
});

describe('back-compat: a recipe with no layers', () => {
  it('authors flat, exactly as before — nothing invents a split', async () => {
    streamMock.mockResolvedValue(toolReply('author_recipe', dynatosRecipe));
    const recipe = await authorRecipe(EVIDENCE, RUN);

    expect(recipe.layers).toBeUndefined();
    expect(recipe.stylesheet).toBe(dynatosRecipe.stylesheet);
  });

  it('critiques flat: a whole-stylesheet patch still applies', async () => {
    streamMock
      .mockResolvedValueOnce(toolReply('author_recipe', dynatosRecipe))
      .mockResolvedValueOnce(
        toolReply('review_recipe', {
          verdict: 'revise',
          patch: { stylesheet: '.cb-slide .headline{ font-size:120px; }' },
        }),
      );
    const recipe = await authorRecipe(EVIDENCE, { model: 'claude-test' });

    expect(recipe.layers).toBeUndefined();
    expect(recipe.stylesheet).toBe('.cb-slide .headline{ font-size:120px; }');
  });
});

describe('critiquing a LAYERED recipe', () => {
  it('patches ONE layer and leaves the other two byte-identical', async () => {
    const background = '.cb-slide{ background:#111111; color:#ece4d3; }';
    streamMock
      .mockResolvedValueOnce(toolReply('author_recipe', layeredPayload()))
      .mockResolvedValueOnce(toolReply('review_recipe', { verdict: 'revise', patch: { layers: { background } } }));
    const recipe = await authorRecipe(EVIDENCE, { model: 'claude-test' });

    expect(recipe.layers!.background).toBe(background);
    expect(recipe.layers!.type).toBe(LAYERS.type);
    expect(recipe.layers!.components).toBe(LAYERS.components);
    // the sheet is re-derived, so what renders is what the critic actually wrote
    expect(recipe.stylesheet).toBe(composeRecipeLayers(recipe.layers));
    expect(recipe.stylesheet).toContain('#111111');
    expect(validateRecipeConsistency(recipe).dropped).toEqual([]);
  });

  it('drops the split when the critic rewrites the whole sheet instead', async () => {
    // The layer split no longer describes that CSS — keeping it would leave the
    // critic's fix in a field the renderer never reads.
    streamMock
      .mockResolvedValueOnce(toolReply('author_recipe', layeredPayload()))
      .mockResolvedValueOnce(
        toolReply('review_recipe', {
          verdict: 'revise',
          patch: {
            stylesheet:
              '.cb-slide{ background:#000; }\n.cb-slide .headline{ font-size:120px; }\n.cb-slide .body{ font-size:46px; }\n.cb-slide .cta{ padding:28px; }',
          },
        }),
      );
    const recipe = await authorRecipe(EVIDENCE, { model: 'claude-test' });

    expect(recipe.layers).toBeUndefined();
    expect(recipe.stylesheet).toContain('font-size:120px');
    expect(validateRecipeConsistency(recipe).dropped).toEqual([]);
  });
});

describe('the compose parse step through forced tool use', () => {
  const DECK = {
    slides: [
      { role: 'cover', image: true, parts: { eyebrow: 'Prepaid', headline: 'Get paid up front.' } },
      { role: 'cta', parts: { headline: 'Book a demo', cta: 'See how' } },
    ],
  };

  it('reads the deck off the tool_use block', async () => {
    createMock.mockResolvedValue(toolReply('write_slides', DECK));
    const inputs = await parseForCompose(dynatosRecipe, 'prepaid packages', { model: 'claude-test' });

    const params = createMock.mock.calls[0]![0] as Params;
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'write_slides' });
    expect(inputs.map((i) => i.role)).toEqual(['cover', 'cta']);
    expect(inputs[0]!.parts.headline).toBe('Get paid up front.');
    expect(inputs[0]!.photo).toBe(true);
  });

  it('falls back to scraping a fenced reply when the tool is ignored', async () => {
    createMock.mockResolvedValue(
      textReply(`Sure — here you go:\n\`\`\`json\n${JSON.stringify(DECK)}\n\`\`\`\nHope that helps!`),
    );
    const inputs = await parseForCompose(dynatosRecipe, 'prepaid packages', { model: 'claude-test' });
    expect(inputs.map((i) => i.role)).toEqual(['cover', 'cta']);
  });
});
