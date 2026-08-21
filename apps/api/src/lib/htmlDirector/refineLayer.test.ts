import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { brandRecipeSchema, recipeStylesheetFor, type BrandRecipe } from '@contentbuilder/shared';

/**
 * The design-tier call is the only thing a refinement needs from outside, so it
 * is stubbed at the same seam compose.test.ts uses: the stub returns whatever
 * the model is pretending to have written, and everything else — the layered vs
 * flat branch, fence/prose extraction, sanitising, the caps, and the
 * deterministic gates — runs for real.
 */
const reply = vi.fn<(params: Anthropic.MessageCreateParamsNonStreaming) => string>(() => '');
const aiCalls: Anthropic.MessageCreateParamsNonStreaming[] = [];

vi.mock('../ai', () => ({
  aiMessageLarge: async (
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> => {
    aiCalls.push(params);
    return { content: [{ type: 'text', text: reply(params) }] } as unknown as Anthropic.Message;
  },
  textOf: (resp: Anthropic.Message): string => {
    const part = resp.content.find((c) => c.type === 'text');
    return part && 'text' in part ? part.text : '';
  },
  cachedSystem: (staticPart: string) => [
    { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
  ],
  modelFor: async () => 'test-design-model',
}));

const { refineRecipeLayer, extractCss, REFINE_INSTRUCTION_MAX } = await import('./refineLayer');

const BG = '.cb-slide { background: radial-gradient(var(--cb-accent), var(--cb-ground)); }';
const TYPE = '.cb-slide .headline { font-size: 104px; font-family: var(--cb-display); }';
const COMPONENTS = '.cb-slide .cta { border-radius: var(--cb-radius); }\n.cb-slide .fill { flex: 1; }';

/** A valid recipe; `layers` is opt-in so both paths can be exercised. */
function makeRecipe(over: Record<string, unknown> = {}): BrandRecipe {
  return brandRecipeSchema.parse({
    version: 2,
    tokens: {
      ground: '#0B0F1A',
      ink: '#F8FAFC',
      accent: '#F5C044',
      displayFamily: 'Playfair Display',
      bodyFamily: 'Inter',
      radius: 16,
    },
    signature: { name: 'Gold rule', description: 'A hairline rule under every headline' },
    stylesheet: [BG, TYPE, COMPONENTS].join('\n'),
    components: [
      { className: 'headline', use: 'The hook' },
      { className: 'cta', use: 'The button' },
    ],
    ...over,
  });
}

const layered = () => makeRecipe({ layers: { background: BG, type: TYPE, components: COMPONENTS } });

const userOf = (c: Anthropic.MessageCreateParamsNonStreaming): string => {
  const m = c.messages[0];
  return typeof m?.content === 'string' ? m.content : '';
};

beforeEach(() => {
  aiCalls.length = 0;
  reply.mockReset();
});

describe('refineRecipeLayer — the layered path', () => {
  const NEW_BG = '.cb-slide { background: #0B0F1A; }';

  it('replaces only the target layer and leaves the others byte-identical', async () => {
    reply.mockReturnValue(NEW_BG);
    const before = layered();
    const { recipe, diff } = await refineRecipeLayer(before, 'background', 'calm the background down');

    expect(recipe.layers?.background).toBe(NEW_BG);
    expect(recipe.layers?.type).toBe(TYPE); // byte-identical
    expect(recipe.layers?.components).toBe(COMPONENTS); // byte-identical
    expect(diff).toMatchObject({ layer: 'background', mode: 'layer', charsAfter: NEW_BG.length });
    expect(diff.charsBefore).toBe(BG.length);
  });

  it('recomposes the stylesheet exactly as the renderer composes layers', async () => {
    reply.mockReturnValue(NEW_BG);
    const { recipe } = await refineRecipeLayer(layered(), 'background', 'flat ground, no gradient');

    // The stored blob equals the layer composition (background → type →
    // components), so the render contract and the consistency gate agree.
    expect(recipe.stylesheet).toBe([NEW_BG, TYPE, COMPONENTS].join('\n'));
    const css = recipeStylesheetFor(recipe, '1080x1350');
    expect(css).toContain(NEW_BG);
    expect(css.indexOf(NEW_BG)).toBeLessThan(css.indexOf('font-size: 104px'));
    // The old layer is gone. Asserted against the layer ITSELF, not against
    // "radial-gradient" — the app's own surface layer legitimately uses that
    // function, so the generic proxy started reporting a replacement that had
    // in fact happened.
    expect(css).not.toContain(BG);
  });

  it('targets the type layer without disturbing background or components', async () => {
    const NEW_TYPE = '.cb-slide .headline { font-size: 122px; letter-spacing: -0.03em; }';
    reply.mockReturnValue(NEW_TYPE);
    const { recipe, diff } = await refineRecipeLayer(layered(), 'type', 'headlines a touch bigger');
    expect(recipe.layers).toEqual({ background: BG, type: NEW_TYPE, components: COMPONENTS });
    expect(diff.mode).toBe('layer');
  });

  it('sends the tokens, the instruction, the target layer and the full sheet', async () => {
    reply.mockReturnValue(NEW_BG);
    await refineRecipeLayer(layered(), 'background', 'less busy please');
    const user = userOf(aiCalls[0]!);
    expect(user).toContain('#0B0F1A'); // tokens
    expect(user).toContain('Playfair Display');
    expect(user).toContain('LAYER TO CHANGE: background');
    expect(user).toContain('INSTRUCTION: less busy please');
    expect(user).toContain('THIS RECIPE IS LAYERED');
    expect(user).toContain(TYPE); // the full sheet, as context
    expect(user).toContain(COMPONENTS);
    expect(user).toContain('Gold rule'); // the signature must survive
    expect(aiCalls[0]!.model).toBe('test-design-model'); // the design tier
  });
});

describe('refineRecipeLayer — the flat (no layers) path', () => {
  const NEW_SHEET = `${BG.replace('radial-gradient(var(--cb-accent), var(--cb-ground))', 'var(--cb-ground)')}\n${TYPE}\n${COMPONENTS}`;

  it('rewrites the whole stylesheet and says so in the diff', async () => {
    reply.mockReturnValue(NEW_SHEET);
    const before = makeRecipe();
    const { recipe, diff } = await refineRecipeLayer(before, 'background', 'calmer ground');

    expect(recipe.layers).toBeUndefined(); // no fake split is invented
    expect(recipe.stylesheet).toBe(NEW_SHEET);
    expect(diff).toMatchObject({ layer: 'background', mode: 'sheet' });
    expect(diff.charsBefore).toBe(before.stylesheet.length);
    expect(diff.charsAfter).toBe(NEW_SHEET.length);
    expect(recipeStylesheetFor(recipe, '1080x1350')).toContain('background: var(--cb-ground)');
  });

  it('tells the model there is no split and to return the whole sheet', async () => {
    reply.mockReturnValue(NEW_SHEET);
    await refineRecipeLayer(makeRecipe(), 'components', 'softer corners');
    const user = userOf(aiCalls[0]!);
    expect(user).toContain('NO LAYER SPLIT');
    expect(user).toContain('Output only the full replacement stylesheet.');
    expect(user).not.toContain('THIS RECIPE IS LAYERED');
  });
});

describe('refineRecipeLayer — parsing what the model actually sends', () => {
  it('unwraps a fenced, prose-wrapped reply', async () => {
    reply.mockReturnValue(
      ['Sure — here is the calmer background layer:', '', '```css', BG, '```', '', 'Let me know!'].join('\n'),
    );
    const { recipe } = await refineRecipeLayer(layered(), 'background', 'calmer');
    expect(recipe.layers?.background).toBe(BG);
  });

  it('drops a bare preamble with no fence', async () => {
    reply.mockReturnValue(`Here you go:\n${BG}\nThat should read quieter.`);
    const { recipe } = await refineRecipeLayer(layered(), 'background', 'quieter');
    expect(recipe.layers?.background).toBe(BG);
  });

  it('strips what the CSS sanitiser strips', async () => {
    reply.mockReturnValue(`@import url(http://evil.test/x.css);\n${BG}`);
    const { recipe } = await refineRecipeLayer(layered(), 'background', 'anything');
    expect(recipe.layers?.background).not.toContain('@import');
  });

  it('throws when the reply carries no CSS at all', async () => {
    reply.mockReturnValue('I cannot help with that.');
    await expect(refineRecipeLayer(layered(), 'background', 'x')).rejects.toThrow(/no CSS/i);
  });

  it('refuses an empty instruction without spending a call', async () => {
    await expect(refineRecipeLayer(layered(), 'background', '   ')).rejects.toThrow(/instruction/i);
    expect(aiCalls).toHaveLength(0);
  });

  it('clamps a long instruction to one sentence-sized ask', async () => {
    reply.mockReturnValue(BG);
    await refineRecipeLayer(layered(), 'background', 'make it calmer '.repeat(40));
    const line = userOf(aiCalls[0]!).split('\n').find((l) => l.startsWith('INSTRUCTION: '))!;
    expect(line.length - 'INSTRUCTION: '.length).toBeLessThanOrEqual(REFINE_INSTRUCTION_MAX);
  });
});

describe('refineRecipeLayer — the deterministic gates', () => {
  it('repairs a recipe whose ink fails contrast on its ground', async () => {
    reply.mockReturnValue(BG);
    const dim = makeRecipe({
      tokens: {
        ground: '#0B0F1A',
        ink: '#1A2030', // ~1.1:1 — unreadable
        accent: '#F5C044',
        displayFamily: 'Inter',
        bodyFamily: 'Inter',
        radius: 16,
      },
      layers: { background: BG, type: TYPE, components: COMPONENTS },
    });
    const { recipe, diff } = await refineRecipeLayer(dim, 'background', 'calmer');
    expect(recipe.tokens.ink).not.toBe('#1A2030');
    expect(diff.repairs.join(' ')).toMatch(/ink/);
  });

  it('drops a component class the refined CSS no longer defines', async () => {
    // The new components layer forgets .cta, so advertising it would put an
    // unstyled button on every slide.
    reply.mockReturnValue('.cb-slide .fill { flex: 1; }');
    const { recipe, diff } = await refineRecipeLayer(layered(), 'components', 'strip the button');
    expect(diff.dropped).toContain('cta');
    expect(recipe.components.map((c) => c.className)).toEqual(['headline']);
  });
});

describe('extractCss', () => {
  it('keeps an @media prelude that opens on the same line', () => {
    expect(extractCss('Here:\n@media (max-width: 640px) { .cb-slide { padding: 40px; } }')).toBe(
      '@media (max-width: 640px) { .cb-slide { padding: 40px; } }',
    );
  });

  it('returns nothing for prose without a rule', () => {
    expect(extractCss('No CSS here.')).toBe('');
  });
});
