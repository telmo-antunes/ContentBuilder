import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, workspaceSchema } from './schema';
import { changeSlide, commitDeck, travel } from './history';
import { readRecovery, writeRecovery } from './recovery';
import { cached, remember } from './cache';
const deck = { width: 600, height: 750, title: 'Draft', originBrief: 'Original', slides: [{ html: 'one' }, { html: 'two' }] };

describe('editing and recovery', () => {
  it('persists redo and the generating brief, and drops redo after a new edit', () => {
    const edited = commitDeck({ ...emptyWorkspace, deck }, { ...deck, title: 'Revised' }, 'Change title');
    const undone = workspaceSchema.parse(travel(edited, 'undo'));
    expect(undone.deck).toEqual(deck);
    const redone = travel(undone, 'redo'); expect(redone.deck?.title).toBe('Revised'); expect(redone.deck?.originBrief).toBe('Original');
    expect(commitDeck(undone, deck, 'Other change').redo).toBeNull();
  });
  it('reorders, duplicates and removes slides without rewriting their documents', () => {
    const moved = changeSlide(deck, 1, 'earlier'); expect(moved.deck.slides).toEqual([deck.slides[1], deck.slides[0]]);
    const duplicated = changeSlide(deck, 0, 'duplicate'); expect(duplicated.deck.slides[1]).toBe(deck.slides[0]);
    expect(changeSlide(duplicated.deck, 1, 'delete').deck.slides).toEqual(deck.slides);
    const single = { ...deck, slides: [deck.slides[0]] }; expect(changeSlide(single, 0, 'delete').deck.slides).toHaveLength(1);
  });
  it('recovers revision text, target and version and ignores damaged browser storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    writeRecovery(storage, 'tab', { ...emptyWorkspace, deck, revisionText: 'Move lower', revisionTarget: 1 }, 'version-1');
    expect(readRecovery(storage, 'tab')).toMatchObject({ version: 'version-1', workspace: { revisionText: 'Move lower', revisionTarget: 1 } });
    values.set('tab', 'broken'); expect(readRecovery(storage, 'tab')).toBeNull();
  });
  it('expires cached results and enforces the byte budget', () => {
    vi.useFakeTimers();
    try {
      remember('test-expiry', 'value', 5, 100); expect(cached('test-expiry')).toBe('value');
      vi.advanceTimersByTime(101); expect(cached('test-expiry')).toBeUndefined();
      remember('large-a', 1, 40 * 1024 * 1024); remember('large-b', 2, 40 * 1024 * 1024);
      expect(cached('large-a')).toBeUndefined(); expect(cached('large-b')).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});
