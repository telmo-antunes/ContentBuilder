import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import {
  brandRecipeSchema,
  ensureRecipeContrast,
  validateRecipeConsistency,
  typeFloorReport,
  relativeLuminance,
  type BrandRecipe,
} from '@contentbuilder/shared';

/**
 * The recipe author, mocked at the SDK + storage boundaries (the same seam
 * ai.cache.test.ts and compose.test.ts stub). These tests pin the three things
 * that are easy to break invisibly: what actually goes on the wire (the
 * homepage screenshot and the cached prefix), WHICH exemplars a brand is shown,
 * and how a critique patch is merged. Plus the quality gate on the hand-authored
 * light reference recipe — the exemplar can only teach a bar it clears itself.
 */
const { streamMock, storageRead, sharpOverride } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  storageRead: vi.fn(),
  /** Lets ONE test stub the encode step; null → the real sharp does the work. */
  sharpOverride: { impl: null as null | (() => unknown) },
}));

vi.mock('sharp', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: (...a: unknown[]) => unknown };
  return {
    default: (...a: unknown[]) => (sharpOverride.impl ? sharpOverride.impl() : actual.default(...a)),
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: () => {
        throw new Error('the recipe author must use the streamed helper');
      },
      stream: (params: unknown) => ({ finalMessage: () => streamMock(params) }),
    };
  },
}));

vi.mock('../../storage', () => ({
  getStorage: () => ({ read: (key: string) => storageRead(key) }),
}));

const { authorRecipe, pairingFor } = await import('./authorRecipe');
const { dynatosRecipe, detailMastersRecipe, halftonePressRecipe } = await import('./recipes');
const { PROMPT_VERSION } = await import('../promptVersion');

type Params = Anthropic.MessageCreateParamsNonStreaming;
type Blocks = Anthropic.TextBlockParam[];

const ok = (text: string): Anthropic.Message =>
  ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }) as unknown as Anthropic.Message;

/** Evidence with a given ground colour; everything else held constant. */
const evidence = (background: string, extra: Record<string, unknown> = {}) => ({
  name: 'Test Brand Co',
  category: 'testing',
  colors: { background, text: '#111111', accent: '#C9A66B' },
  fonts: { render: { heading: 'Montserrat', body: 'Inter' } },
  ...extra,
});

/** A dark ground (near-black), a paper ground, and a mid-tone one. */
const DARK = evidence('#0D1017');
const LIGHT = evidence('#F7F4EC');
const MID = evidence('#A89B84');

const RUN = { model: 'claude-test', critique: false } as const;

/** The params of the Nth (default: last) call the app put on the wire. */
const sent = (i = -1): Params => streamMock.mock.calls.at(i)![0] as Params;
const systemText = (p: Params): string => (p.system as Blocks).map((b) => b.text).join('\n');
const exemplarSnippet = (r: BrandRecipe): string => JSON.stringify(r.tokens);

/** A real PNG the size of a homepage capture, so sharp does real work. */
const homepagePng = async (): Promise<Buffer> =>
  sharp({ create: { width: 1366, height: 900, channels: 3, background: '#2b4f8a' } })
    .png()
    .toBuffer();

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  streamMock.mockImplementation(async () => ok(JSON.stringify(dynatosRecipe)));
});
afterEach(() => {
  warn.mockRestore();
  streamMock.mockReset();
  storageRead.mockReset();
});

describe('the homepage screenshot', () => {
  it('rides in the USER message as a downscaled JPEG image block', async () => {
    storageRead.mockResolvedValue(await homepagePng());
    await authorRecipe({ ...DARK, screenshot: { key: 'brand/b1/home.png' } }, RUN);

    expect(storageRead).toHaveBeenCalledWith('brand/b1/home.png');
    const content = sent().messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(Array.isArray(content)).toBe(true);

    // image FIRST, then the instruction that refers to it
    const [image, text] = content as [Anthropic.ImageBlockParam, Anthropic.TextBlockParam];
    expect(image.type).toBe('image');
    const source = image.source as Anthropic.Base64ImageSource;
    expect(source.type).toBe('base64');
    expect(source.media_type).toBe('image/jpeg');
    expect(source.data.length).toBeGreaterThan(0);
    expect(text.type).toBe('text');
    expect(text.text).toContain('NOW AUTHOR THE RECIPE FOR THIS BRAND');
    expect(text.text).toContain("actual homepage");

    // it really was resized + re-encoded, not passed through
    const meta = await sharp(Buffer.from(source.data, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1000);
  });

  it('leaves the cached system prefix byte-identical to the no-screenshot call', async () => {
    storageRead.mockResolvedValue(await homepagePng());
    await authorRecipe({ ...DARK, screenshot: { key: 'brand/b1/home.png' } }, RUN);
    await authorRecipe(DARK, RUN);

    const withShot = sent(0).system as Blocks;
    const without = sent(1).system as Blocks;
    expect(withShot).toEqual(without);
    expect(withShot[0]!.text).toBe(without[0]!.text);
    expect(withShot[0]!.cache_control).toEqual({ type: 'ephemeral' });

    // the image is the most per-brand thing in the call — it must never have
    // leaked into the prefix, or the prefix would never be read twice
    const blocks = sent(0).messages[0]!.content as Anthropic.ContentBlockParam[];
    const data = ((blocks[0] as Anthropic.ImageBlockParam).source as Anthropic.Base64ImageSource).data;
    expect(JSON.stringify(withShot)).not.toContain('"type":"image"');
    expect(JSON.stringify(withShot)).not.toContain(data.slice(0, 64));
  });

  it('sends the pre-screenshot request shape when the kit has no capture', async () => {
    await authorRecipe(DARK, RUN);
    expect(storageRead).not.toHaveBeenCalled();
    const content = sent().messages[0]!.content;
    expect(typeof content).toBe('string');
    expect(String(content)).toContain('NOW AUTHOR THE RECIPE FOR THIS BRAND');
    expect(String(content)).not.toContain('actual homepage');
  });

  it('degrades silently when the stored key cannot be read', async () => {
    storageRead.mockRejectedValue(new Error('ENOENT'));
    const recipe = await authorRecipe({ ...DARK, screenshot: { key: 'gone.png' } }, RUN);
    expect(recipe.tokens.accent).toBe(dynatosRecipe.tokens.accent);
    expect(typeof sent().messages[0]!.content).toBe('string');
  });

  it('degrades silently when the stored bytes are not a decodable image', async () => {
    storageRead.mockResolvedValue(Buffer.from('this is not a png'));
    await expect(
      authorRecipe({ ...DARK, screenshot: { key: 'junk.png' } }, RUN),
    ).resolves.toBeTruthy();
    expect(typeof sent().messages[0]!.content).toBe('string');
  });

  it('skips a screenshot whose encoded size exceeds the ceiling', async () => {
    storageRead.mockResolvedValue(await homepagePng());
    sharpOverride.impl = () => ({
      resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.alloc(1_000_000, 7) }) }),
    });
    try {
      await authorRecipe({ ...DARK, screenshot: { key: 'huge.png' } }, RUN);
      expect(typeof sent().messages[0]!.content).toBe('string');
    } finally {
      sharpOverride.impl = null;
    }
  });
});

describe('exemplar selection', () => {
  it('brackets the brand ground: light → light pairing, dark → dark pairing', () => {
    expect(pairingFor(LIGHT)).toBe('light');
    expect(pairingFor(DARK)).toBe('dark');
    expect(pairingFor(MID)).toBe('mixed');
  });

  it('falls back to the dark pairing when the ground is not a readable hex', () => {
    expect(pairingFor(evidence('rgb(250, 250, 245)'))).toBe('dark');
    expect(pairingFor({ ...DARK, colors: {} })).toBe('dark');
    // …unless the palette carries one
    expect(pairingFor({ ...DARK, colors: { palette: ['#FAF7EE'] } })).toBe('light');
  });

  it('shows a LIGHT brand the light exemplar, leading', async () => {
    await authorRecipe(LIGHT, RUN);
    const sys = systemText(sent());
    expect(sys).toContain(exemplarSnippet(halftonePressRecipe));
    expect(sys).toContain('EXAMPLE A (LIGHT paper ground');
    // paired with a dark one so the range stays open
    expect(sys).toContain(exemplarSnippet(dynatosRecipe));
    expect(sys).not.toContain(exemplarSnippet(detailMastersRecipe));
  });

  it('shows a DARK brand the two dark exemplars', async () => {
    await authorRecipe(DARK, RUN);
    const sys = systemText(sent());
    expect(sys).toContain(exemplarSnippet(dynatosRecipe));
    expect(sys).toContain(exemplarSnippet(detailMastersRecipe));
    expect(sys).not.toContain(exemplarSnippet(halftonePressRecipe));
  });

  it('brackets a MID-tone ground with one dark and one light exemplar', async () => {
    await authorRecipe(MID, RUN);
    const sys = systemText(sent());
    expect(sys).toContain(exemplarSnippet(detailMastersRecipe));
    expect(sys).toContain(exemplarSnippet(halftonePressRecipe));
    expect(sys).not.toContain(exemplarSnippet(dynatosRecipe));
  });

  it('emits only THREE distinct cached prefixes across many brands (each stays warm)', async () => {
    const grounds = ['#000000', '#0D1017', '#231B0D', '#4B3B27', '#A89B84', '#8E8577', '#F7F4EC', '#FFFFFF', '#E9E2D0'];
    for (const g of grounds) await authorRecipe(evidence(g), RUN);
    const prefixes = new Set(streamMock.mock.calls.map((c) => ((c[0] as Params).system as Blocks)[0]!.text));
    expect(prefixes.size).toBe(3);
    // and every prefix is a single cached block, as before
    for (const call of streamMock.mock.calls) {
      const system = (call[0] as Params).system as Blocks;
      expect(system.filter((b) => b.cache_control != null)).toHaveLength(1);
    }
  });
});

describe('the critic patches instead of re-typing', () => {
  /** Draft first, then the critique reply. */
  const conversation = (draft: BrandRecipe, critique: string) => {
    streamMock
      .mockImplementationOnce(async () => ok(JSON.stringify(draft)))
      .mockImplementationOnce(async () => ok(critique));
  };

  it('returns the draft untouched on {"verdict":"pass"} — no merge, no re-validation', async () => {
    conversation(dynatosRecipe, '{"verdict":"pass"}');
    const passed = await authorRecipe(DARK, { model: 'claude-test' });

    streamMock.mockReset();
    streamMock.mockImplementation(async () => ok(JSON.stringify(dynatosRecipe)));
    const draftOnly = await authorRecipe(DARK, RUN);
    // identical in every respect — except that the critique prompt was used, so
    // the reviewed recipe additionally carries that touchpoint's version stamp
    expect(passed).toEqual({
      ...draftOnly,
      promptVersion: { author: PROMPT_VERSION.author, critique: PROMPT_VERSION.critique },
    });
  });

  it('merges nested objects key by key and replaces arrays wholesale', async () => {
    conversation(
      dynatosRecipe,
      JSON.stringify({
        verdict: 'revise',
        patch: {
          tokens: { accent: '#ff8a00' },
          motion: { roles: { stat: { style: 'pop', pace: 'punchy' } } },
          components: [{ className: 'headline', use: 'Only this one survives.' }],
        },
      }),
    );
    const out = await authorRecipe(DARK, { model: 'claude-test' });

    // nested: the patched key changed, its siblings did not
    expect(out.tokens.accent).toBe('#ff8a00');
    expect(out.tokens.ground).toBe(dynatosRecipe.tokens.ground);
    expect(out.tokens.displayFamily).toBe(dynatosRecipe.tokens.displayFamily);
    // deep-nested: one role replaced, the other roles kept
    expect(out.motion!.roles!.stat).toEqual({ style: 'pop', pace: 'punchy' });
    expect(out.motion!.roles!.quote).toEqual(dynatosRecipe.motion!.roles!.quote);
    expect(out.motion!.style).toBe(dynatosRecipe.motion!.style);
    // arrays replace wholesale — no element-wise merge
    expect(out.components).toEqual([{ className: 'headline', use: 'Only this one survives.' }]);
    // everything the patch never mentioned is byte-identical
    expect(out.stylesheet).toBe(dynatosRecipe.stylesheet);
    expect(out.signature).toEqual(dynatosRecipe.signature);
    expect(out.formats).toEqual(dynatosRecipe.formats);
  });

  it('sanitises a stylesheet that arrives inside a patch', async () => {
    conversation(
      dynatosRecipe,
      JSON.stringify({
        verdict: 'revise',
        patch: {
          stylesheet: '@import url(https://evil.test/x.css); .cb-slide .headline{font-size:120px}',
          formats: { '1080x1080': { stylesheet: '@import url(https://evil.test/y.css); .cb-slide{padding:70px}' } },
        },
      }),
    );
    const out = await authorRecipe(DARK, { model: 'claude-test' });
    expect(out.stylesheet).not.toContain('@import');
    expect(out.stylesheet).toContain('font-size:120px');
    expect(out.formats!['1080x1080']!.stylesheet).not.toContain('@import');
  });

  it('still works when the critic replies with a whole legacy recipe', async () => {
    conversation(dynatosRecipe, JSON.stringify(detailMastersRecipe));
    const out = await authorRecipe(DARK, { model: 'claude-test' });
    expect(out.tokens).toEqual(detailMastersRecipe.tokens);
    expect(out.stylesheet).toBe(detailMastersRecipe.stylesheet);
    expect(out.signature).toEqual(detailMastersRecipe.signature);
  });

  it('keeps the draft when the critique reply is unparseable', async () => {
    conversation(dynatosRecipe, 'I would rather write you an essay about this recipe.');
    const out = await authorRecipe(DARK, { model: 'claude-test' });
    expect(out.tokens).toEqual(dynatosRecipe.tokens);
  });

  it('asks for a patch, and quotes the same display-type range as the author prompt', async () => {
    conversation(dynatosRecipe, '{"verdict":"pass"}');
    await authorRecipe(DARK, { model: 'claude-test' });
    const author = systemText(sent(0));
    const critic = systemText(sent(1));

    expect(critic).toContain('{"verdict":"pass"}');
    expect(critic).toContain('ONLY the fields you are changing');
    expect(String(sent(1).messages[0]!.content)).toContain('"verdict":"revise"');

    // ONE shared constant — the two prompts can no longer disagree
    expect(author).toContain('88–130px');
    expect(critic).toContain('88–130px');
    expect(critic).not.toContain('80–120px');
  });
});

describe('the light reference recipe (Halftone Press)', () => {
  it('validates against brandRecipeSchema', () => {
    expect(() => brandRecipeSchema.parse(halftonePressRecipe)).not.toThrow();
  });

  it('needs no contrast repairs — it is legible as authored', () => {
    const { repairs, recipe } = ensureRecipeContrast(halftonePressRecipe);
    expect(repairs).toEqual([]);
    expect(recipe).toBe(halftonePressRecipe);
  });

  it('defines every class it advertises (nothing dropped, nothing unlisted)', () => {
    const { dropped, unlisted, recipe } = validateRecipeConsistency(halftonePressRecipe);
    expect(dropped).toEqual([]);
    expect(recipe.components).toHaveLength(halftonePressRecipe.components.length);
    // `.cb-shot` is styled here because rule 7 of the author prompt demands it,
    // and is app-owned rather than advertised — it is no longer reported
    expect(unlisted).toEqual([]);
  });

  it('sits above the phone-legibility floor on every canvas', () => {
    const sheets = [
      halftonePressRecipe.stylesheet,
      ...Object.values(halftonePressRecipe.formats ?? {}).map((f) => f.stylesheet),
    ];
    for (const css of sheets) expect(typeFloorReport(css)).toEqual([]);
  });

  it('is a genuinely LIGHT, genuinely different third voice', () => {
    expect(relativeLuminance(halftonePressRecipe.tokens.ground)).toBeGreaterThan(0.5);
    for (const dark of [dynatosRecipe, detailMastersRecipe]) {
      expect(relativeLuminance(dark.tokens.ground)).toBeLessThan(0.18);
      expect(halftonePressRecipe.tokens.displayFamily).not.toBe(dark.tokens.displayFamily);
      expect(halftonePressRecipe.signature.name).not.toBe(dark.signature.name);
      expect(halftonePressRecipe.motion!.style).not.toBe(dark.motion!.style);
    }
    // it carries the three things the author prompt demands and the seeded two predate
    expect(halftonePressRecipe.motion!.ambient).toEqual({ style: 'drift', intensity: 'subtle' });
    expect(halftonePressRecipe.signature.emphasisWrap).toEqual({ tag: 'span', className: 'em' });
    expect(halftonePressRecipe.stylesheet).toContain('.cb-slide .cb-shot');
    // a light ground needs multiply, not the overlay blend a dark ground uses
    expect(halftonePressRecipe.stylesheet).toContain('mix-blend-mode:multiply');
    // 8–12 components, per-format overrides for story + square
    expect(halftonePressRecipe.components.length).toBeGreaterThanOrEqual(8);
    expect(halftonePressRecipe.components.length).toBeLessThanOrEqual(12);
    expect(Object.keys(halftonePressRecipe.formats ?? {}).sort()).toEqual(['1080x1080', '1080x1920']);
    // and it stays inside the ~4500-char budget the prompt asks every brand for
    expect(halftonePressRecipe.stylesheet.length).toBeLessThanOrEqual(4500);
  });
});

describe('reference fragments (compose by example)', () => {
  /** Written in Dynatós' real vocabulary — except `quote`, which is not. */
  const FRAGMENTS = {
    statement:
      '<div class="eyebrow">{{eyebrow}}</div><div class="headline">{{headline}}</div><div class="tagline">{{tagline}}</div>',
    cta:
      '<div class="headline">{{headline}}</div><div class="fill"></div><div class="cta">{{cta}}</div><div class="handle">{{handle}}</div>',
    quote: '<div class="panel">{{quote}}</div>',
  };

  it('forces the tool to carry one fragment per slide role', async () => {
    await authorRecipe(DARK, RUN);
    const params = sent();
    const tool = params.tools![0] as Anthropic.Tool;

    expect(params.tool_choice).toEqual({ type: 'tool', name: 'author_recipe' });
    expect(tool.name).toBe('author_recipe');
    expect(tool.input_schema.type).toBe('object');
    expect(tool.input_schema.required).toContain('fragments');
    const fragments = (tool.input_schema.properties as Record<string, { type: string; properties: object }>)
      .fragments!;
    expect(fragments.type).toBe('object');
    expect(Object.keys(fragments.properties).sort()).toEqual(
      ['cover', 'cta', 'feature', 'list', 'quote', 'stat', 'statement'],
    );
  });

  it('states the placeholder convention in the STATIC cached prefix, never per brand', async () => {
    await authorRecipe(DARK, RUN);
    await authorRecipe(LIGHT, RUN);
    const [a, b] = [sent(0), sent(1)];

    // The tool list renders BEFORE system, so it is part of every cached prefix:
    // its bytes must not vary from brand to brand.
    expect(JSON.stringify(a.tools)).toBe(JSON.stringify(b.tools));
    const prefix = (a.system as Blocks)[0]!;
    expect(prefix.cache_control).toEqual({ type: 'ephemeral' });
    expect(prefix.text).toContain('Emit "fragments"');
    expect(prefix.text).toContain('{{row.text}}');
    expect(prefix.text).toContain('NO {{emphasis}} placeholder');
    // and nothing about fragments rides in the per-brand user turn
    expect(String(a.messages[0]!.content)).not.toContain('fragments');
  });

  it('keeps the usable fragments and drops the one naming an undefined class', async () => {
    streamMock.mockImplementation(async () =>
      ok(JSON.stringify({ ...dynatosRecipe, fragments: FRAGMENTS })),
    );
    const recipe = await authorRecipe(DARK, RUN);

    expect(Object.keys(recipe.fragments ?? {}).sort()).toEqual(['cta', 'statement']);
    expect(recipe.fragments!['statement']).toBe(FRAGMENTS.statement);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('dropped the "quote" reference fragment — uses undefined class .panel'),
    );
  });

  it('leaves a recipe the model authored without fragments exactly as it is', async () => {
    const recipe = await authorRecipe(DARK, RUN);
    expect(recipe.fragments).toBeUndefined();
    expect(warn.mock.calls.map((c) => String(c[0])).some((w) => w.includes('reference fragment'))).toBe(false);
  });
});
