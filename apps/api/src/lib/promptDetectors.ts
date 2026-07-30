/**
 * THE DETECTORS — proof that a newer prompt would actually change something.
 *
 * Without these, prompt versioning is a number that is always out of date and a
 * badge that is always lit. Each one inspects a real artifact and reports in the
 * language of the result: not "you are on v2" but "your call to action is 32px,
 * which is 11.6pt on a phone".
 *
 * Every detector here reuses machinery that already exists for repairing these
 * problems at author or render time — `typeFloorReport`, `ensureListSkeleton`,
 * `lintAuthored`. That is deliberate: the thing that flags a brand and the thing
 * that fixes it must never be able to disagree.
 */
import {
  PHONE_SCALE,
  authoredSlots,
  ensureListSkeleton,
  typeFloorReport,
  type BrandRecipe,
  type DetectorId,
} from '@contentbuilder/shared';
import { lintAuthored } from './htmlDirector/lintAuthored';

/** The CSS a recipe actually renders from. */
function recipeCss(recipe: BrandRecipe): string {
  const l = recipe.layers;
  return l && (l.background || l.type || l.components)
    ? [l.background, l.type, l.components].filter(Boolean).join('\n')
    : (recipe.stylesheet ?? '');
}

const pt = (px: number) => (px / PHONE_SCALE).toFixed(1);

/** Detectors that inspect a BRAND's recipe. */
export function brandDetector(recipe: BrandRecipe | undefined, d: DetectorId): string[] {
  if (!recipe) return [];
  switch (d) {
    case 'typeFloor': {
      // Name the worst offenders in phone points — the unit that matters.
      const report = typeFloorReport(recipeCss(recipe));
      return report
        .slice(0, 4)
        .map((r) => `${r.role} is ${r.from}px (${pt(r.from)}pt on a phone) — would become ${r.to}px (${pt(r.to)}pt)`);
    }
    case 'listSkeleton': {
      const { repairs } = ensureListSkeleton(recipe);
      return repairs.length
        ? [`list rows are laid out by the brand in a way that collapses at legible type sizes (${repairs.join(', ')})`]
        : [];
    }
    case 'noListVocabulary': {
      const has = recipe.components.some((c) => /row|item|list/i.test(c.className));
      return has ? [] : ['this brand has no list vocabulary, so “three things” can only be written as a paragraph'];
    }
    case 'noAmbientMotion':
      return recipe.motion?.ambient
        ? []
        : ['no ambient motion is authored, so photographs sit still in video exports'];
    default:
      return [];
  }
}

/** Detectors that inspect a POST's slides. */
export function postDetector(
  slides: Array<{ authored?: { html?: string } }>,
  recipe: BrandRecipe | undefined,
  d: DetectorId,
): string[] {
  const withHtml = slides.filter((s) => s.authored?.html);
  switch (d) {
    case 'secretList': {
      const hasList = Boolean(recipe?.components.some((c) => /row|item|list/i.test(c.className)));
      if (!hasList) return [];
      const hits = withHtml.filter(
        (s) =>
          lintAuthored(s.authored!.html!, { hasListVocabulary: true }).findings.some(
            (f) => f.kind === 'paragraph-is-a-list',
          ),
      ).length;
      return hits
        ? [`${hits} slide${hits === 1 ? '' : 's'} write an enumeration as a paragraph — newer copy turns those into rows`]
        : [];
    }
    case 'noImageSlots': {
      // A deck composed before slots existed has no placeholder anywhere, so
      // there is nowhere to put your own photograph without starting over.
      if (!withHtml.length) return [];
      const any = withHtml.some((s) => authoredSlots(s.authored!.html!).length > 0);
      return any ? [] : ['no slide leaves a space for a photograph — recomposing would offer you places to add your own'];
    }
    case 'noListVocabulary': {
      const hasList = Boolean(recipe?.components.some((c) => /row|item|list/i.test(c.className)));
      if (hasList) return [];
      return withHtml.length ? ['composed before the brand had a list vocabulary'] : [];
    }
    default:
      return [];
  }
}
