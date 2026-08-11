import { describe, expect, it } from 'vitest';
import { draggedSlides } from './learningLoop';

/** The ids of a five-slide deck, as composed. */
const DECK = ['cover', 'statement', 'list', 'stat', 'cta'];

describe('draggedSlides — the drag, not its wake', () => {
  it('records only the slide the user picked up', () => {
    // The stat is dragged from 3 to 1; statement and list each shuffle down one.
    const out = draggedSlides(DECK, ['cover', 'stat', 'statement', 'list', 'cta']);
    expect([...out]).toEqual([['stat', -2]]);
  });

  it('keeps both halves of a swap — which one moved is unknowable', () => {
    const out = draggedSlides(DECK, ['cover', 'list', 'statement', 'stat', 'cta']);
    expect([...out].sort()).toEqual([
      ['list', -1],
      ['statement', 1],
    ]);
  });

  it('reports nothing for a deck nobody reordered', () => {
    expect(draggedSlides(DECK, DECK).size).toBe(0);
  });

  it('signs the move: negative is earlier, positive is later', () => {
    expect(draggedSlides(DECK, ['statement', 'list', 'stat', 'cta', 'cover']).get('cover')).toBe(4);
  });

  it('ignores a slide that was deleted rather than moved', () => {
    const out = draggedSlides(DECK, ['cover', 'statement', 'list', 'cta']);
    expect(out.has('stat')).toBe(false);
    expect([...out]).toEqual([['cta', -1]]);
  });

  it('survives a deck whose slides were all replaced', () => {
    expect(draggedSlides(DECK, ['a', 'b', 'c']).size).toBe(0);
  });
});
