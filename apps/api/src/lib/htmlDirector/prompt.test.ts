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
