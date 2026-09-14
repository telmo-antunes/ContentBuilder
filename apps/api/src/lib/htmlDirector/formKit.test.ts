import { describe, expect, it } from 'vitest';
import { fragmentVariantsFor } from '@contentbuilder/shared';
import { ensureSevenForms } from './formKit';
import { detailMastersRecipe, dynatosRecipe } from './recipes';

describe('ensureSevenForms', () => {
  it('leaves a recipe that already carries every form untouched', () => {
    const out = ensureSevenForms(detailMastersRecipe);
    expect(out.added).toEqual([]);
    expect(out.recipe).toBe(detailMastersRecipe);
  });

  it('adds the missing list forms to a brand with the furniture, in its own classes and with borrowed CSS', () => {
    // Dynatós minus its constructed exhibits: keep the marker panel and the numbered poster only.
    const bare = {
      ...dynatosRecipe,
      fragments: { ...dynatosRecipe.fragments, list: fragmentVariantsFor(dynatosRecipe, 'list').slice(0, 2) },
      components: dynatosRecipe.components.filter((c) => !['figures', 'figure', 'steps', 'step', 'compare', 'ledger', 'line', 'checks'].includes(c.className)),
      stylesheet: dynatosRecipe.stylesheet.replace(/\.cb-slide \.(figures|figure|steps|step|compare|ledger|line|checks)\b[^\n]*\n/g, ''),
    };
    const out = ensureSevenForms(bare);
    expect(out.added).toEqual(['exhibit', 'steps', 'compare', 'ledger', 'checks']);
    expect(fragmentVariantsFor(out.recipe, 'list')).toHaveLength(7);
    expect(out.recipe.components.some((c) => c.className === 'ledger')).toBe(true);
    expect(out.recipe.stylesheet).toContain('.cb-slide .ledger');
    // The brand's own furniture is used as it stands: Dynatós has a .rule, so the checklist keeps one.
    expect(fragmentVariantsFor(out.recipe, 'list').at(-1)).toContain('class="rule"');
  });

  it('drops the optional rule and the .sm modifier for a brand that never defined them', () => {
    const noRule = {
      ...dynatosRecipe,
      fragments: { ...dynatosRecipe.fragments, list: fragmentVariantsFor(dynatosRecipe, 'list').slice(0, 1) },
      components: dynatosRecipe.components.filter((c) => !['rule', 'checks'].includes(c.className)),
      stylesheet: dynatosRecipe.stylesheet.replace(/\.cb-slide \.rule\b[^\n]*\n/g, '').replace(/\.cb-slide \.checks\b[^\n]*\n/g, '').replace(/\.headline\.sm\b[^\n]*\n/g, ''),
    };
    const out = ensureSevenForms(noRule);
    const checklist = fragmentVariantsFor(out.recipe, 'list').find((f) => /\bchecks\b/.test(f));
    expect(checklist).toBeDefined();
    expect(checklist).not.toContain('class="rule"');
  });

  it('skips a form whose furniture the brand does not have, and says which class', () => {
    const noPanel = {
      ...dynatosRecipe,
      fragments: { ...dynatosRecipe.fragments, list: [fragmentVariantsFor(dynatosRecipe, 'list')[0]!] },
      components: dynatosRecipe.components.filter((c) => c.className !== 'panel'),
      stylesheet: dynatosRecipe.stylesheet.replace(/\.cb-slide \.panel\b[^\n]*\n/g, ''),
    };
    const out = ensureSevenForms(noPanel);
    expect(out.skipped.map((s) => s.form)).toContain('numbered');
    expect(out.skipped.find((s) => s.form === 'numbered')?.missing).toEqual(['panel']);
  });
});
