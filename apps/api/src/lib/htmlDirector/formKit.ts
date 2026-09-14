/**
 * THE FORM KIT — every authored brand gets the seven forms, in its own furniture.
 *
 * The author prompt asks for the forms and the exemplars show them, and a
 * model still ships a brand with two list treatments and no one-liner. The
 * audit's fix was a script that attached the reference recipe by hand; a
 * third brand would have needed the same visit. So the forms are guaranteed
 * HERE, after authoring: any list form the author left out is added as a
 * variant built from the reference fragment, using the brand's own classes
 * where it has them (eyebrow, headline, body, panel, row, rule, fill) and
 * borrowing the reference's CSS only for the construction the brand never
 * wrote (.steps/.step, .compare, .ledger/.line, .checks, .figures/.figure) —
 * written against the --cb-* tokens, so it takes the brand's colours.
 *
 * A form is skipped, and said so, when the brand lacks a class the form's
 * skeleton needs and the reference cannot supply it (a brand whose list is
 * `.items` rather than `.panel` keeps its own vocabulary).
 */
import type { BrandRecipe } from '@contentbuilder/shared';
import { fragmentVariantsFor } from '@contentbuilder/shared';
import { detailMastersRecipe } from './recipes';

interface Form {
  key: string;
  role: 'list' | 'statement' | 'feature';
  /** How to recognise the form in an existing variant. */
  present: (fragment: string) => boolean;
  /** The reference fragment for the form. */
  template: string;
  /** Classes the brand must already define (brand furniture). */
  needs: string[];
  /** Classes the kit may add, with CSS, when the brand lacks them. */
  supplies: string[];
}

const ref = (role: string, pick: (f: string) => boolean): string => {
  const hit = fragmentVariantsFor(detailMastersRecipe, role).find(pick);
  if (!hit) throw new Error(`form kit: the reference recipe has no ${role} fragment matching the form`);
  return hit;
};

export const FORMS: Form[] = [
  { key: 'numbered', role: 'list', present: (f) => /\bnumbered\b/.test(f), template: ref('list', (f) => /\bnumbered\b/.test(f)), needs: ['eyebrow', 'headline', 'body', 'panel', 'row', 'fill'], supplies: [] },
  { key: 'exhibit', role: 'list', present: (f) => /class="figures"/.test(f), template: ref('list', (f) => /class="figures"/.test(f)), needs: ['eyebrow', 'headline', 'fill'], supplies: ['figures', 'figure'] },
  { key: 'steps', role: 'list', present: (f) => /class="steps"/.test(f), template: ref('list', (f) => /class="steps"/.test(f)), needs: ['eyebrow', 'headline', 'body', 'fill'], supplies: ['steps', 'step'] },
  { key: 'compare', role: 'list', present: (f) => /class="compare"/.test(f), template: ref('list', (f) => /class="compare"/.test(f)), needs: ['eyebrow', 'headline', 'row', 'fill'], supplies: ['compare'] },
  { key: 'ledger', role: 'list', present: (f) => /class="ledger"/.test(f), template: ref('list', (f) => /class="ledger"/.test(f)), needs: ['eyebrow', 'headline', 'fill'], supplies: ['ledger', 'line'] },
  { key: 'checks', role: 'list', present: (f) => /\bchecks\b/.test(f), template: ref('list', (f) => /\bchecks\b/.test(f)), needs: ['eyebrow', 'headline', 'panel', 'row', 'fill'], supplies: ['checks'] },
  { key: 'one-liner', role: 'statement', present: (f) => /\{\{tagline\}\}/.test(f) && !/\{\{body\}\}/.test(f), template: ref('statement', (f) => /\{\{tagline\}\}/.test(f) && !/\{\{body\}\}/.test(f)), needs: ['eyebrow', 'headline', 'tagline', 'fill'], supplies: [] },
  { key: 'product-proof', role: 'feature', present: (f) => /cb-shot wide/.test(f), template: ref('feature', (f) => /cb-shot wide/.test(f)), needs: ['eyebrow', 'headline', 'body', 'fill'], supplies: [] },
];

/** The reference stylesheet's rules for one class, verbatim. */
function referenceRulesFor(className: string): string {
  const css = detailMastersRecipe.stylesheet;
  const out: string[] = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selector = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (new RegExp(`\\.${className}(?![\\w-])`).test(selector)) out.push(`${selector}{${m[2]!.trim()}}`);
  }
  return out.join('\n');
}

const definedClasses = (recipe: BrandRecipe): Set<string> => {
  const set = new Set(recipe.components.map((c) => c.className));
  for (const m of recipe.stylesheet.matchAll(/\.([a-zA-Z][\w-]*)/g)) set.add(m[1]!);
  return set;
};

/** Optional `.rule` and `.sm` are dropped from a template rather than blocking a form. */
function adapt(template: string, have: Set<string>): string {
  let out = template;
  if (!have.has('rule')) out = out.replace(/<div class="rule"><\/div>\n?/g, '');
  if (!have.has('sm')) out = out.replace(/class="headline sm"/g, 'class="headline"');
  return out;
}

export function ensureSevenForms(recipe: BrandRecipe): { recipe: BrandRecipe; added: string[]; skipped: Array<{ form: string; missing: string[] }> } {
  const have = definedClasses(recipe);
  const fragments: Record<string, string | string[]> = { ...(recipe.fragments ?? {}) };
  const components = [...recipe.components];
  let stylesheet = recipe.stylesheet;
  let layersComponents = recipe.layers?.components;
  const added: string[] = [];
  const skipped: Array<{ form: string; missing: string[] }> = [];

  for (const form of FORMS) {
    const variants = fragmentVariantsFor({ ...recipe, fragments } as BrandRecipe, form.role);
    // A role with no fragment at all is the carry/fill machinery's job, not this kit's.
    if (!variants.length) continue;
    if (variants.some(form.present)) continue;
    const missing = form.needs.filter((c) => !have.has(c));
    if (missing.length) {
      skipped.push({ form: form.key, missing });
      continue;
    }
    for (const c of form.supplies) {
      if (have.has(c)) continue;
      const css = referenceRulesFor(c);
      if (!css) continue;
      stylesheet = `${stylesheet}\n${css}`;
      if (layersComponents !== undefined) layersComponents = `${layersComponents}\n${css}`;
      const use = detailMastersRecipe.components.find((x) => x.className === c)?.use ?? `(form kit) ${c}`;
      components.push({ className: c, use });
      have.add(c);
    }
    fragments[form.role] = [...variants, adapt(form.template, have)];
    added.push(form.key);
  }

  if (!added.length) return { recipe, added, skipped };
  return {
    recipe: {
      ...recipe,
      fragments,
      components,
      stylesheet,
      ...(recipe.layers && layersComponents !== undefined ? { layers: { ...recipe.layers, components: layersComponents } } : {}),
    },
    added,
    skipped,
  };
}
