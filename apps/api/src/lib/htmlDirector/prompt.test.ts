import { describe, expect, it } from 'vitest';
import { buildComposeMessages } from './prompt';
import { detailMastersRecipe } from './recipes';

const slidePrompt = buildComposeMessages;

describe('the arrangement reaches the composer', () => {
  const input = (over: Record<string, unknown> = {}) =>
    ({ role: 'statement', parts: { headline: 'A line' }, format: '1080x1350', index: 0, ...over }) as never;

  it('names the composition, where the space goes and the headline cap', () => {
    const { user } = slidePrompt(detailMastersRecipe, input({ archetype: 'list' }));
    expect(user).toContain('arrangement: list');
    // The policy token `bottom` says nothing to a writer; the words do.
    expect(user).toContain('pack it from the top');
    expect(user).toContain('may run to 2 lines');
  });

  it('translates each policy into an instruction, not a token', () => {
    expect(slidePrompt(detailMastersRecipe, input({ archetype: 'banner' })).user).toContain('anchor the slide low');
    expect(slidePrompt(detailMastersRecipe, input({ archetype: 'pull' })).user).toContain('optically centred');
    expect(slidePrompt(detailMastersRecipe, input({ archetype: 'split' })).user).toContain('own band');
  });

  it('says nothing at all when no arrangement was decided', () => {
    // A caller composing one slide on its own — the Studio's variants, a test —
    // has no deck to have a rhythm with, and inventing one would be a lie.
    expect(slidePrompt(detailMastersRecipe, input()).user).not.toContain('arrangement:');
  });

  it('ignores an archetype key it does not recognise', () => {
    expect(slidePrompt(detailMastersRecipe, input({ archetype: 'nonsense' })).user).not.toContain('arrangement:');
  });
})

// ── Prompt caching ───────────────────────────────────────────────────────────

describe('the composer prompt is cached in two scopes', () => {
  const input = (over: Record<string, unknown> = {}) =>
    ({ role: 'statement', parts: { headline: 'A line' }, format: '1080x1350', index: 0, ...over }) as never;
  const built = slidePrompt(detailMastersRecipe, input({ role: 'statement' }));
  const blocks = built.system as Array<{ text: string; cache_control?: unknown }>;

  it('sends the instructions and the brand spec as two cached prefix layers', () => {
    // Two entries: one shared by every brand, one shared by this deck's slides.
    // Collapsing to a single breakpoint would scope the shared half per-brand
    // and throw away most of the hit rate.
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0]!.text).toContain('You compose one slide');
    expect(blocks[1]!.text).toContain('COMPONENT CLASSES');
  });

  it('keeps everything per-slide OUT of the cached prefix', () => {
    const prefix = blocks.map((b) => b.text).join('\n');
    // The copy, the role and the arrangement all vary slide to slide; any of
    // them in the prefix would invalidate the cache on every single slide.
    // (The instructions legitimately REFER to the composition pattern — what
    // must not be in the prefix is the resolved per-slide block itself.)
    expect(prefix).not.toContain('COMPOSITION PATTERN to follow:');
    expect(prefix).not.toContain('copy parts');
    expect(built.user).toContain('COMPOSITION PATTERN to follow:');
  });

  it('is byte-identical across slides of the same deck — the thing that makes it cache', () => {
    const other = slidePrompt(detailMastersRecipe, input({ role: 'cta', index: 6 }));
    expect((other.system as Array<{ text: string }>).map((b) => b.text)).toEqual(blocks.map((b) => b.text));
  });
});
