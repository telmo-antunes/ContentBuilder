import type { Deck } from './schema';

/** Everything to paste into Instagram, in posting order. */
export function captionText(deck: Deck): string {
  const caption = deck.caption;
  if (!caption) return '';
  const alt = deck.slides.map((slide, i) => slide.alt ? `${i + 1}. ${slide.alt}` : '').filter(Boolean);
  return [caption.text, caption.hashtags, caption.firstComment && `First comment:\n${caption.firstComment}`, alt.length && `Alt text:\n${alt.join('\n')}`].filter(Boolean).join('\n\n') + '\n';
}
