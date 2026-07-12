import { describe, expect, it } from 'vitest';
import { CONTENT_INTENTS, suggestLayoutForBlocks } from './intents';
import { LAYOUT_TYPES } from './layouts';
import { BLOCK_TYPES } from './blocks';
import type { Block } from './blocks';

const b = (type: Block['type'], text = 'x', items?: string[]): Block =>
  ({ type, text, items }) as Block;

describe('CONTENT_INTENTS', () => {
  it('every plan uses only real layouts and block types', () => {
    for (const intent of CONTENT_INTENTS) {
      expect(intent.slides.length).toBeGreaterThan(0);
      for (const plan of intent.slides) {
        expect(LAYOUT_TYPES).toContain(plan.layoutType);
        for (const t of plan.blocks) expect(BLOCK_TYPES).toContain(t);
      }
    }
  });

  it('intent keys are unique', () => {
    const keys = CONTENT_INTENTS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('suggestLayoutForBlocks', () => {
  it('suggests Checklist for a list, Quote for a quote, CTA for a closer', () => {
    expect(suggestLayoutForBlocks([b('title'), b('list', '', ['a'])], 'TextOnly', false)?.layoutType).toBe('Checklist');
    expect(suggestLayoutForBlocks([b('quote')], 'TextOnly', false)?.layoutType).toBe('Quote');
    expect(suggestLayoutForBlocks([b('title'), b('cta')], 'TextOnly', false)?.layoutType).toBe('CTA');
  });

  it('suggests image layouts only when an image exists', () => {
    expect(suggestLayoutForBlocks([b('title', 'Short')], 'TextOnly', true)?.layoutType).toBe('BackgroundImage');
    expect(suggestLayoutForBlocks([b('title'), b('paragraph')], 'TextOnly', true)?.layoutType).toBe('SplitImageText');
  });

  it('suggests Statement for one short line', () => {
    expect(suggestLayoutForBlocks([b('title', 'Detailing.')], 'TextOnly', false)?.layoutType).toBe('Statement');
  });

  it('stays quiet when the layout already fits, on free canvas, or with no content', () => {
    expect(suggestLayoutForBlocks([b('title'), b('list', '', ['a'])], 'Checklist', false)).toBeNull();
    expect(suggestLayoutForBlocks([b('list', '', ['a'])], 'FreePosition', false)).toBeNull();
    expect(suggestLayoutForBlocks([b('title', '')], 'TextOnly', false)).toBeNull();
  });
});
