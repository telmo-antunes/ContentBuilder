/**
 * Recover the COPY PARTS from an already-composed slide.
 *
 * Compose stores only the authored markup, not the parts it was built from — so
 * regenerating one slide used to be impossible: your options were re-composing
 * the entire deck (losing every other slide) or editing by hand. Reading the
 * parts back out of the markup makes a single slide re-composable.
 *
 * Pure string work (no DOM) so it runs on the server, and it only ever reads the
 * recipe's own component classes.
 */
import type { ComposeParts } from './prompt';

/** class name in the markup → the compose part it carries. */
const CLASS_TO_PART: Record<string, keyof ComposeParts> = {
  eyebrow: 'eyebrow',
  headline: 'headline',
  tagline: 'tagline',
  body: 'body',
  quote: 'quote',
  attr: 'attribution',
  stat: 'stat',
  cta: 'cta',
  handle: 'handle',
};

/** Collapse markup to its visible text. */
function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the copy parts from authored slide markup. The emphasis phrase (the
 * brand's signature accent) is read out of its span so a re-compose keeps it.
 */
export function partsFromAuthored(html: string): ComposeParts {
  const parts: ComposeParts = {};
  const el = /<([a-z][a-z0-9]*)\b[^>]*\bclass="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(el)) {
    const classes = (m[2] ?? '').split(/\s+/);
    const inner = m[3] ?? '';
    for (const c of classes) {
      const part = CLASS_TO_PART[c];
      if (!part || parts[part]) continue;
      const text = textOf(inner);
      if (!text) continue;
      (parts as Record<string, string>)[part] = text;
      // The accent phrase lives in a nested span — keep it so the signature survives.
      if (part === 'headline') {
        const span = inner.match(/<span\b[^>]*class="[^"]*\b(?:em|it)\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const emphasis = span ? textOf(span[1] ?? '') : '';
        if (emphasis) parts.emphasis = emphasis;
      }
    }
  }
  return parts;
}
