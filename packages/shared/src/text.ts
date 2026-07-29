/**
 * Length limits for the free-text brand evidence, and a clamp that respects
 * words.
 *
 * These values are shared on purpose. The brand VOICE was capped in three
 * different places that had drifted apart — a hard `slice(0, 240)` where the
 * vision model's answer was read, `.max(400)` on the route that accepts an
 * edit, and no limit at all on the stored document. The slice won, silently,
 * and it cut mid-word: one real kit ended
 *
 *     "…positioning itself as the invisible backbone—sophisticated without
 *      being pre"
 *
 * That string is not a harmless display truncation. It is fed to the caption
 * writer as "Brand voice (match it exactly)" and to the recipe author as the
 * VOICE evidence it designs the brand's whole system from — so half a sentence
 * about how a business talks was shaping every post it will ever publish.
 */

/** How much room the brand's voice description gets. */
export const VOICE_MAX = 600;
/** The one-line visual style descriptor. */
export const STYLE_DESCRIPTOR_MAX = 320;

/**
 * Trim text to a budget without cutting a word in half.
 *
 * Prefers to end on a sentence, falls back to the last whole word, and marks
 * the result with an ellipsis so a clipped value is visibly incomplete rather
 * than passing as a finished thought. Whitespace is normalised first, since
 * model output arrives with stray newlines that waste the budget.
 */
export function clampText(raw: string, max: number): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  // A sentence boundary is the best place to stop — but only if it leaves most
  // of the budget used, otherwise we'd throw away the majority of the answer.
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence >= max * 0.6) return cut.slice(0, sentence + 1).trim();
  const word = cut.lastIndexOf(' ');
  const body = word > 0 ? cut.slice(0, word) : cut;
  return body.replace(/[\s,;:—–-]+$/, '') + '…';
}
