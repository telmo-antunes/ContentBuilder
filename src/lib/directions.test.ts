import { describe, expect, it } from 'vitest';
import { emptyWorkspace, workspaceSchema } from './schema';
import { activeDirections, duplicateDirection, generationContext } from './directions';
import { generationMessage, decodeDeck } from './ai';
import { changeSlide, commitDeck, travel } from './history';

const entries = [
  { id: 'first', slide: 1, text: '  Keep “Every word.”\nPurple type, freely composed.  ' },
  { id: 'third', slide: 3, text: 'A diagram with no headline.' },
];
const input = { ...emptyWorkspace, slideDirectionsEnabled: true, slideDirections: entries };
const modelOutput = JSON.stringify({ title: 'Directed', slides: [{ html: 'first' }, { html: 'free' }, { html: 'third' }] });

describe('optional per-slide instructions', () => {
  it('passes sparse directions unchanged, with no fixed total slide count', () => {
    const messages = generationMessage(input);
    const text = messages.filter(b => b.type === 'text').map(b => b.text).join('\n');
    expect(text).toContain(JSON.stringify(entries.map(({ slide, text }) => ({ slide, instructions: text }))));
    expect(text).toContain('Do not treat this list as a fixed total slide count');
    const result = decodeDeck(modelOutput, input);
    expect(result.originBrief).toBe('');
    expect(result.originSlideDirections).toEqual(entries.map(({ slide, text }) => ({ slide, text })));
  });
  it('ignores blank and disabled directions while retaining the editable draft', () => {
    expect(activeDirections({ ...input, slideDirectionsEnabled: false })).toEqual([]);
    expect(activeDirections({ ...input, slideDirections: [...entries, { id: 'blank', slide: 2, text: ' \n ' }] })).toHaveLength(2);
    expect(JSON.stringify(generationMessage({ ...input, slideDirectionsEnabled: false }))).not.toContain('Purple type');
    const legacy = workspaceSchema.parse({ width: 600, height: 750, brief: 'Old draft', brand: null, deck: null });
    expect(legacy.slideDirectionsEnabled).toBe(false); expect(legacy.slideDirections).toEqual([]);
  });
  it('does not silently accept a generated deck missing an explicitly directed slide', () => {
    expect(() => decodeDeck('{"title":"Too short","slides":[{"html":"one"}]}', input)).toThrow('omitted a slide');
    expect(duplicateDirection([...activeDirections(input), { slide: 3, text: 'Conflicting field' }])).toBe(3);
  });
  it('keeps the saved directions for revisions and applies edited directions only on opt-in', () => {
    const deck = decodeDeck(modelOutput, input);
    const revision = { ...input, deck, instruction: 'Change only the text color', slideIndex: 0,
      slideDirections: [{ id: 'new', slide: 1, text: 'An unrelated new idea' }] };
    expect(generationContext(revision).directions).toEqual(deck.originSlideDirections);
    expect(JSON.stringify(generationMessage(revision))).not.toContain('An unrelated new idea');
    expect(generationContext({ ...revision, useUpdatedBrief: true }).directions[0].text).toBe('An unrelated new idea');
    const revised = decodeDeck('{"title":"ignore","slides":[{"html":"changed first"}]}', revision);
    expect(revised.originSlideDirections).toEqual(deck.originSlideDirections);
    expect(revised.slides[1]).toBe(deck.slides[1]);
    expect(generationContext({ ...revision, deck: { ...deck, originSlideDirections: undefined } }).directions).toEqual([]);
  });
  it('keeps instructions associated with slides during manual moves, duplication, deletion and undo', () => {
    const deck = decodeDeck(modelOutput, input);
    const moved = changeSlide(deck, 2, 'earlier').deck;
    expect(moved.originSlideDirections).toEqual([{ slide: 1, text: entries[0].text }, { slide: 2, text: entries[1].text }]);
    const doubled = changeSlide(moved, 1, 'duplicate').deck;
    expect(doubled.originSlideDirections?.map(item => item.slide)).toEqual([1, 2, 3]);
    expect(changeSlide(doubled, 1, 'delete').deck.originSlideDirections).toEqual(moved.originSlideDirections);
    const history = commitDeck({ ...input, deck }, moved, 'Move slide');
    expect(travel(history, 'undo').deck?.originSlideDirections).toEqual(deck.originSlideDirections);
  });
});
