import { describe, expect, it } from 'vitest';
import { RECIPE_STRUCTURAL_CLASSES } from '@contentbuilder/shared';
import { SPEC_ROW_MAX, isSpecSlide, markSpecList } from './specs';

const specs = [{ text: 'Pressure: 85 to 130 bar' }, { text: 'Water flow: 6 to 9 L/min' }, { text: '25° and 40° nozzles' }];

describe('isSpecSlide', () => {
  it('is an item slide with two to five short plain rows', () => {
    expect(isSpecSlide('feature', specs)).toBe(true);
    expect(isSpecSlide('feature', specs.slice(0, 1))).toBe(false);
    expect(isSpecSlide('feature', [...specs, ...specs])).toBe(false);
  });

  it('keeps the old rule for anything that is a list, not a spec', () => {
    expect(isSpecSlide('list', specs)).toBe(false);
    expect(isSpecSlide('feature', [...specs, { text: 'A tank', note: 'for a day of jobs' }])).toBe(false);
    expect(isSpecSlide('feature', [...specs, { text: 'Rinse first', state: 'do' }])).toBe(false);
    expect(isSpecSlide('feature', [...specs, { text: 'x'.repeat(SPEC_ROW_MAX + 1) }])).toBe(false);
    expect(isSpecSlide('feature', undefined)).toBe(false);
  });
});

describe('markSpecList', () => {
  it('adds the class to the element holding the rows', () => {
    const html = '<h2 class="headline">Vacuum</h2>\n<div class="panel checks"><div class="row">Wet and dry pickup</div><div class="row">A fine-dust filter</div></div>';
    expect(markSpecList(html)).toContain('<div class="panel checks specs"><div class="row">');
    expect(markSpecList(html).match(/specs/g)).toHaveLength(1);
  });

  it('leaves markup alone that already has it, or has no rows', () => {
    const marked = '<div class="panel specs"><div class="row do">A</div></div>';
    expect(markSpecList(marked)).toBe(marked);
    expect(markSpecList('<div class="body">No list here.</div>')).toBe('<div class="body">No list here.</div>');
  });

  it('skips a self-closed element and classes an unclassed container', () => {
    expect(markSpecList('<ul><br/><li class="row">A</li></ul>')).toBe('<ul class="specs"><br/><li class="row">A</li></ul>');
  });

  it('is a class the composer may use on any brand', () => {
    expect(RECIPE_STRUCTURAL_CLASSES.has('specs')).toBe(true);
  });
});
