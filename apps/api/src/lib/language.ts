/**
 * WHICH LANGUAGE A DECK IS IN — by its own words, not by a setting nobody set.
 *
 * The promo story's labels ("NOVO POST", "Vê o carrossel completo") were
 * hard-coded in Portuguese, so three English carousels each derived a story in
 * the wrong language and needed a hand patch (FEEDBACK.md, 2026-10-18). There
 * is no language field on a business or a project, and adding one would have
 * left every existing deck unset. The deck's copy already says which language
 * it is in: a handful of function words settle it.
 */
export type DeckLanguage = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it';

const STOPWORDS: Record<DeckLanguage, readonly string[]> = {
  en: ['the', 'and', 'your', 'you', 'with', 'for', 'this', 'that', 'what', 'how', 'before', 'after', 'not'],
  pt: ['o', 'a', 'os', 'as', 'e', 'de', 'do', 'da', 'para', 'com', 'que', 'não', 'seu', 'sua', 'um', 'uma', 'é'],
  es: ['el', 'la', 'los', 'las', 'y', 'de', 'para', 'con', 'que', 'no', 'tu', 'un', 'una', 'es', 'del'],
  fr: ['le', 'la', 'les', 'et', 'de', 'pour', 'avec', 'que', 'pas', 'votre', 'un', 'une', 'est', 'des'],
  de: ['der', 'die', 'das', 'und', 'mit', 'für', 'nicht', 'ihr', 'ihre', 'ein', 'eine', 'ist', 'sie'],
  it: ['il', 'la', 'gli', 'le', 'e', 'di', 'per', 'con', 'che', 'non', 'tuo', 'tua', 'un', 'una', 'è'],
};

/** Visible words of a slide's markup, lower-cased. */
export function wordsOf(html: string): string[] {
  return html
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/**
 * The language the deck's copy is written in. Ties and silence resolve to
 * English, the app's own language.
 */
export function languageOf(htmls: ReadonlyArray<string | undefined | null>): DeckLanguage {
  const words = htmls.flatMap((h) => wordsOf(h ?? ''));
  if (!words.length) return 'en';
  const scores = Object.entries(STOPWORDS).map(([lang, stops]) => {
    const set = new Set(stops);
    return [lang as DeckLanguage, words.filter((w) => set.has(w)).length] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] === 0 || (second && best[1] === second[1])) return 'en';
  return best[0];
}

/** The promo story's two labels, in the deck's language. */
export function promoLabelsFor(lang: DeckLanguage): { eyebrow: string; cta: string } {
  switch (lang) {
    case 'pt':
      return { eyebrow: 'NOVO POST', cta: 'Vê o carrossel completo' };
    case 'es':
      return { eyebrow: 'NUEVO POST', cta: 'Ve el carrusel completo' };
    case 'fr':
      return { eyebrow: 'NOUVEAU POST', cta: 'Voir le carrousel complet' };
    case 'de':
      return { eyebrow: 'NEUER POST', cta: 'Das ganze Karussell ansehen' };
    case 'it':
      return { eyebrow: 'NUOVO POST', cta: 'Guarda il carosello completo' };
    default:
      return { eyebrow: 'NEW POST', cta: 'See the full carousel' };
  }
}
