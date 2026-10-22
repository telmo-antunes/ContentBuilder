/**
 * THE DECK STYLESHEET — the one place a single deck may add to its brand's CSS.
 *
 * The brand recipe fixes the look once; every slide is composed from its
 * classes. That is what keeps a brand coherent, and it is also why every deck
 * used to look like the last one: a deck that needed a two-column compare, a
 * number at poster size or a verdict row had no way to draw it unless the
 * recipe's author had thought of it first.
 *
 * The designer (docs/designer.md) may therefore write a FEW rules for the deck
 * it is designing, under a contract both ends can check:
 *
 *   · every selector is scoped under `.cb-slide` (the renderer re-scopes it
 *     per instance, exactly like the brand's own sheet);
 *   · every new class name starts with `dk-`, so a deck rule can never shadow
 *     the brand's `.headline` or the app's `.cb-shot`;
 *   · colours come from the brand's `--cb-*` tokens — a literal hex is a
 *     brand drift, and is refused;
 *   · nothing loads: no `url(`, no `@import`, no `@font-face`; nothing escapes
 *     the frame: no `position:fixed`, no `!important` on the app's layers.
 *
 * The renderer runs the result through the same legibility floor as the brand
 * sheet, so a deck rule cannot set type below the phone minimum either. The API
 * runs `sanitizeRecipeCss` on it first; this module is the POLICY, shared so
 * the web side can scope it with the same assumptions the API checked.
 */

export const DECK_CSS_MAX_CHARS = 12000;
export const DECK_CLASS_PREFIX = 'dk-';
/** One deck should not need more than this; past it, the recipe is what wants changing. */
export const DECK_CSS_MAX_RULES = 40;

export interface DeckCssFault {
  kind: 'unscoped' | 'class-prefix' | 'literal-colour' | 'loads' | 'escapes' | 'size' | 'syntax';
  detail: string;
}

/** Classes the brand and the app own; a deck rule may TARGET them (to arrange
 *  them inside a `.dk-` device) but may never DEFINE them bare. */
const SCOPE_RE = /\.cb-slide\b/;

/**
 * Split a stylesheet into its top-level rules, honouring one level of at-rule
 * nesting (a `@media` or `@supports` block). A regex is enough here: the sheet
 * is model output a few hundred characters long, and anything this cannot
 * read is refused rather than guessed at.
 */
export function splitDeckRules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) {
        selector = css.slice(start, i).trim();
        start = i + 1;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = css.slice(start, i).trim();
        if (selector.startsWith('@')) {
          // One level of nesting: the rules inside are checked individually.
          for (const inner of splitDeckRules(body)) out.push(inner);
        } else {
          out.push({ selector, body });
        }
        start = i + 1;
      } else if (depth < 0) {
        return out; // unbalanced — the caller reports syntax
      }
    }
  }
  return out;
}

/** Every class name a selector mentions. */
function classesIn(selector: string): string[] {
  const out: string[] = [];
  const re = /\.([a-zA-Z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) out.push(m[1]!);
  return out;
}

const APP_CLASSES = new Set(['cb-slide', 'cb-shot', 'cb-bg-layer', 'cb-bg-photo', 'cb-free-layer', 'cb-free-img', 'cb-motion']);

/**
 * The contract, checked. Empty means the sheet may be stored and injected.
 * `brandClasses` are the recipe's own component classes — a deck rule may
 * target them inside a `.dk-` device but may not redefine them on their own.
 */
export function deckCssFaults(css: string, brandClasses: ReadonlySet<string> = new Set()): DeckCssFault[] {
  const faults: DeckCssFault[] = [];
  if (!css.trim()) return faults;
  if (css.length > DECK_CSS_MAX_CHARS) faults.push({ kind: 'size', detail: `${css.length} chars; the limit is ${DECK_CSS_MAX_CHARS}` });
  const opens = (css.match(/{/g) ?? []).length;
  const closes = (css.match(/}/g) ?? []).length;
  if (opens !== closes) faults.push({ kind: 'syntax', detail: `${opens} "{" against ${closes} "}"` });
  if (/@import|@font-face|url\s*\(/i.test(css)) faults.push({ kind: 'loads', detail: 'a deck sheet may not load anything (@import, @font-face, url())' });
  if (/position\s*:\s*fixed/i.test(css)) faults.push({ kind: 'escapes', detail: 'position: fixed escapes the frame' });
  const rules = splitDeckRules(css);
  if (rules.length > DECK_CSS_MAX_RULES) faults.push({ kind: 'size', detail: `${rules.length} rules; the limit is ${DECK_CSS_MAX_RULES}` });
  for (const { selector, body } of rules) {
    for (const sel of selector.split(',')) {
      const s = sel.trim();
      if (!s) continue;
      if (!SCOPE_RE.test(s)) {
        faults.push({ kind: 'unscoped', detail: `"${s}" is not under .cb-slide` });
        continue;
      }
      const classes = classesIn(s).filter((c) => !APP_CLASSES.has(c));
      const deckClasses = classes.filter((c) => c.startsWith(DECK_CLASS_PREFIX));
      const others = classes.filter((c) => !c.startsWith(DECK_CLASS_PREFIX));
      // A rule with no deck class of its own is redefining the brand (or the
      // app) — `.cb-slide .headline{…}` would change every slide of every deck
      // that shares the recipe. A rule like `.cb-slide .dk-compare .headline`
      // only reaches inside the device, which is the point.
      if (!deckClasses.length && others.length) {
        faults.push({ kind: 'class-prefix', detail: `"${s}" restyles ${others.map((c) => `.${c}`).join(', ')} without a .${DECK_CLASS_PREFIX}… device of its own` });
      }
      if (!deckClasses.length && !others.length) {
        faults.push({ kind: 'class-prefix', detail: `"${s}" names no .${DECK_CLASS_PREFIX}… class` });
      }
      for (const c of others) {
        if (brandClasses.size && !brandClasses.has(c)) {
          faults.push({ kind: 'class-prefix', detail: `"${s}" names .${c}, which neither the brand nor this deck defines` });
        }
      }
    }
    // Colours must be the brand's tokens. A hex, rgb() or named colour on a
    // colour property is the one way a deck can drift off-brand silently.
    const colourProps = /(?:^|;)\s*(?:color|background|background-color|border(?:-[a-z]+)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow)\s*:\s*([^;]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = colourProps.exec(body)) !== null) {
      const value = m[1]!;
      const stripped = value.replace(/var\(\s*--cb-[\w-]+\s*(?:,[^)]*)?\)/gi, '').replace(/color-mix\([^)]*\)/gi, '');
      if (/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|red|blue|green|gray|grey|gold|silver|orange|yellow|purple|pink)\b/i.test(stripped)) {
        faults.push({ kind: 'literal-colour', detail: `"${value.trim().slice(0, 60)}" is not a brand token` });
      }
    }
  }
  return faults;
}

/**
 * Keep the rules that pass the contract and drop the ones that do not — a
 * deck whose compare device is fine and whose one stray rule recoloured the
 * headline keeps the device and loses the recolour. Returns what was dropped
 * so the decision can be noted on the project.
 */
export function cleanDeckCss(css: string, brandClasses: ReadonlySet<string> = new Set()): { css: string; dropped: string[] } {
  if (!css.trim()) return { css: '', dropped: [] };
  const opens = (css.match(/{/g) ?? []).length;
  const closes = (css.match(/}/g) ?? []).length;
  if (opens !== closes || /@import|@font-face|url\s*\(/i.test(css)) {
    return { css: '', dropped: ['the whole sheet (unbalanced braces or something that loads)'] };
  }
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const rule of splitDeckRules(css).slice(0, DECK_CSS_MAX_RULES)) {
    const text = `${rule.selector}{${rule.body}}`;
    const faults = deckCssFaults(text, brandClasses);
    if (faults.length) dropped.push(`${rule.selector} — ${faults.map((f) => f.detail).join('; ')}`);
    else kept.push(text);
  }
  return { css: kept.join('\n'), dropped };
}

/**
 * Scope a deck sheet to one render instance, the way the renderer scopes the
 * brand's sheet. The sheet was validated to be `.cb-slide`-rooted, so the
 * same substitution is exact.
 */
export function scopeDeckCss(css: string, scope: string): string {
  if (!css) return '';
  return css.replace(/\.cb-slide/g, `.${scope} .cb-slide`);
}
