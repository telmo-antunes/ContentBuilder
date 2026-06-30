import { describe, it, expect } from 'vitest';
import {
  LAYOUT_TYPES,
  SELECTABLE_LAYOUT_TYPES,
  isFreeLayout,
  layoutWantsImage,
  isLayoutType,
} from './layouts';

describe('layouts', () => {
  it('exposes FreePosition as a layout but keeps it out of the manual picker', () => {
    expect(LAYOUT_TYPES).toContain('FreePosition');
    expect(SELECTABLE_LAYOUT_TYPES).not.toContain('FreePosition');
    // every selectable layout is still a real layout
    for (const l of SELECTABLE_LAYOUT_TYPES) expect(LAYOUT_TYPES).toContain(l);
  });

  it('identifies the free layout', () => {
    expect(isFreeLayout('FreePosition')).toBe(true);
    expect(isFreeLayout('Cover')).toBe(false);
  });

  it('knows which layouts are built around an image', () => {
    expect(layoutWantsImage('SplitImageText')).toBe(true);
    expect(layoutWantsImage('CenteredHero')).toBe(true);
    expect(layoutWantsImage('BackgroundImage')).toBe(true);
    expect(layoutWantsImage('TextOnly')).toBe(false);
    expect(layoutWantsImage('FreePosition')).toBe(false);
  });

  it('guards layout strings', () => {
    expect(isLayoutType('Cover')).toBe(true);
    expect(isLayoutType('NotALayout')).toBe(false);
  });
});
