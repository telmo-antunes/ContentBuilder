/**
 * THE LEGIBILITY FLOOR — the smallest type this app will ever render.
 *
 * Every canvas is 1080px wide, and every post is read on a phone. In the
 * Instagram feed on a typical handset the image spans about 393pt, so the
 * canvas is shown at roughly a THIRD of its authored size:
 *
 *     on-phone pt  =  canvas px / 2.75
 *
 * That ratio is what makes authored-in-pixels type scales so easy to get
 * wrong. A 30px body reads as a comfortable paragraph in a design tool and
 * arrives on the phone at 11pt — below the size at which people read at all.
 * For reference: iOS body text is 17pt, Instagram's own caption is ~14pt, and
 * under ~11pt text stops being read and becomes texture.
 *
 * The recipe author was told "body 30–34px, eyebrows 24–27px", and every brand
 * obediently sat inside that range — so the message, the attribution and the
 * CALL TO ACTION all shipped below the readable floor while the headlines
 * (80–120px) were fine. Prompts carry taste; code carries safety. This is the
 * safety: a deterministic pass that raises anything undersized, so no recipe —
 * already authored, or authored by some future model that drifts — can put
 * unreadable type on a slide.
 */
import { STORY_UI_RESERVE } from './formats';

/** Feed scale: 1080px canvas shown ~393pt wide on a typical phone. */
export const PHONE_SCALE = 1080 / 393;

/** Canvas px for a target on-phone point size. */
export const pxForPt = (pt: number): number => Math.round(pt * PHONE_SCALE);

/**
 * Nothing on a slide may be smaller than this, whatever class it uses.
 * 12.4pt on a phone — roughly a caption, and the point below which body copy
 * stops being read.
 */
export const ABSOLUTE_FLOOR_PX = pxForPt(12.4);

/**
 * Per-role minimums, in canvas px, keyed by the component class the recipe
 * vocabulary uses. Roles are matched against a rule's selector, longest name
 * first, so `.headline` doesn't accidentally claim a `.sub-headline`.
 *
 * These are FLOORS, not sizes — a brand that wants a 200px stat keeps it. They
 * only bite where a recipe went smaller than a phone can read.
 */
export const TYPE_FLOOR_PX: Record<string, number> = {
  // The message itself. 16pt — comfortable reading on a handset.
  body: pxForPt(16),
  // The one element whose job is to make someone act; it should never be
  // among the smallest things on the slide, which is exactly what it was.
  cta: pxForPt(17),
  panel: pxForPt(15),
  tagline: pxForPt(16),
  // Supporting marks: small by design, but still meant to be READ.
  eyebrow: pxForPt(12.4),
  handle: pxForPt(12.4),
  attr: pxForPt(13),
  wordmark: pxForPt(13),
  // Display type — already comfortable in practice; these stop a regression.
  quote: pxForPt(24),
  headline: pxForPt(26),
  stat: pxForPt(40),
};

/** Component classes, longest first, so the most specific name wins a selector. */
const ROLES = Object.keys(TYPE_FLOOR_PX).sort((a, b) => b.length - a.length);

/** The floor that applies to a rule, from the first component class it names. */
function floorFor(selector: string): number {
  for (const role of ROLES) {
    // Word-boundary on the class name so `.attr` doesn't match `.attribution`.
    if (new RegExp(`\\.${role}(?![a-zA-Z0-9_-])`).test(selector)) return TYPE_FLOOR_PX[role]!;
  }
  return ABSOLUTE_FLOOR_PX;
}

/**
 * Raise every undersized `font-size` in an authored stylesheet.
 *
 * Only touches absolute `px` sizes: `em`/`rem`/`%`/`clamp()` are relative to
 * something this pass can't see, and silently rewriting them would break a
 * brand's intended relationships rather than fix its legibility.
 *
 * Returns the CSS unchanged when nothing was below the floor, so the common
 * case costs nothing and a brand that was authored correctly is untouched.
 */
export function enforceTypeFloor(css: string): string {
  if (!css) return css;
  return css.replace(/([^{}]*)\{([^}]*)\}/g, (whole, selector: string, body: string) => {
    if (!/font-size/i.test(body)) return whole;
    const floor = floorFor(selector);
    const fixed = body.replace(
      /(font-size\s*:\s*)([\d.]+)px/gi,
      (decl, head: string, size: string) => (Number(size) < floor ? `${head}${floor}px` : decl),
    );
    return fixed === body ? whole : `${selector}{${fixed}}`;
  });
}

/**
 * The base size every slide inherits.
 *
 * No recipe sets a `font-size` on `.cb-slide`, so unclassed text inherited the
 * PAGE's size — 15px, which is 5.5pt on a phone. The floor pass can only raise
 * rules that declare a size; this covers everything that declares none. Emitted
 * before the authored CSS, and any component class out-specifies it.
 */
export function typeBaseCss(): string {
  return `.cb-slide{font-size:${ABSOLUTE_FLOOR_PX}px}`;
}

/**
 * What a pass WOULD change, for reporting rather than rewriting — used to tell
 * someone their brand was authored below the floor and by how much.
 */
export function typeFloorReport(css: string): Array<{ role: string; from: number; to: number }> {
  const out: Array<{ role: string; from: number; to: number }> = [];
  for (const m of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    const selector = m[1] ?? '';
    const floor = floorFor(selector);
    for (const f of (m[2] ?? '').matchAll(/font-size\s*:\s*([\d.]+)px/gi)) {
      const from = Number(f[1]);
      if (from < floor) {
        const role = ROLES.find((r) => new RegExp(`\\.${r}(?![a-zA-Z0-9_-])`).test(selector)) ?? 'other';
        out.push({ role, from, to: floor });
      }
    }
  }
  return out;
}

// ── The measure ──────────────────────────────────────────────────────────────

/**
 * THE NARROWEST A COLUMN OF READING TEXT MAY BE, in `ch`.
 *
 * Typographic guidance puts a comfortable measure at 45–75 characters. `ch` is
 * the advance of "0", which in the sans faces these brands use runs ~0.6em
 * against an average character's ~0.5em — so a cap of N`ch` fits roughly
 * N × 1.2 real characters, and 34ch lands at about 41.
 *
 * WHY THIS EXISTS. A recipe capped `.body` at 26ch. On a 1080px canvas with
 * 88px gutters that is 593px of a 904px measure: **a third of every slide's
 * width went unused**, and the copy wrapped at ~31 characters. It reads as text
 * that has been squeezed into a column nobody asked for, and it is invisible
 * until you notice the right margin is nowhere near the text.
 *
 * Deliberately a FLOOR, not a value. A brand that authored a generous measure
 * keeps it; only one that authored a cramped one is opened up.
 */
export const MEASURE_FLOOR_CH = 34;

/**
 * Classes whose max-width is a READING measure rather than a design decision.
 *
 * Display copy is excluded on purpose: a `.tagline` or a `.headline` held to a
 * narrow column is a legitimate and common choice, and widening it would be
 * overruling the brand on something it got right. Only continuous prose — the
 * text someone actually reads left-to-right, line after line — is floored.
 */
const MEASURED_CLASSES = ['body', 'row'];

const measuresReadingText = (selector: string): boolean =>
  MEASURED_CLASSES.some((c) => new RegExp(`\\.${c}(?![a-zA-Z0-9_-])`).test(selector));

/**
 * Raise a cramped reading measure, at render.
 *
 * Sibling of `enforceTypeFloor` and for the same reason: it repairs every brand
 * already in the database on the next paint, with no re-authoring and no AI
 * spend, and it keeps holding if a future recipe drifts narrow again.
 */
export function enforceMeasureFloor(css: string): string {
  if (!css) return css;
  return css.replace(/([^{}]*)\{([^}]*)\}/g, (whole, selector: string, body: string) => {
    if (!/max-width/i.test(body) || !measuresReadingText(selector)) return whole;
    const fixed = body.replace(
      /(max-width\s*:\s*)([\d.]+)ch/gi,
      (decl, head: string, n: string) =>
        Number(n) < MEASURE_FLOOR_CH ? `${head}${MEASURE_FLOOR_CH}ch` : decl,
    );
    return fixed === body ? whole : `${selector}{${fixed}}`;
  });
}


/**
 * Instagram paints its own UI over the top and bottom of a story, so a 9:16
 * canvas has to hold its type clear of both bands.
 *
 * The render chrome has always known this — `safeAreaFor('story')` reserves
 * `STORY_UI_RESERVE` — but an AUTHORED slide never used those insets: its safe
 * area is whatever `.cb-slide` padding the recipe's own `formats['1080x1920']`
 * stylesheet happens to set. The exemplar reserves 210/240 and is fine; a brand
 * the model authors later has nothing stopping it from setting 88px and putting
 * the headline under Instagram's own header.
 */

/** `padding: a b c d` → the top and bottom components, in px. */
function paddingEdges(value: string): { top: number; bottom: number } | null {
  const parts = value.trim().split(/\s+/);
  if (!parts.length || parts.length > 4) return null;
  const px = (p: string | undefined): number | null => {
    if (p === undefined) return null;
    const m = /^([\d.]+)px$/.exec(p.trim());
    return m ? Number(m[1]) : null;
  };
  const top = px(parts[0]);
  // 1 value → all sides; 2 or 3 → the third (or the first) is the bottom.
  const bottom = parts.length >= 3 ? px(parts[2]) : top;
  if (top === null || bottom === null) return null;
  return { top, bottom };
}

/**
 * Raise a story slide's top and bottom padding to at least
 * {@link STORY_UI_RESERVE}, leaving a recipe that already reserves more alone.
 *
 * Applied at RENDER, like the type and measure floors beside it: every brand
 * already in the database is corrected on the next paint, with no re-authoring
 * and no AI spend, and it keeps holding if a future model drifts back to a
 * tight story padding.
 */
export function enforceStoryReserve(css: string, format: string): string {
  if (!css || format !== '1080x1920') return css;
  return css.replace(/([^{}]*)\{([^}]*)\}/g, (whole, selector: string, body: string) => {
    if (!/\.cb-slide\s*$/.test(selector.trim())) return whole;
    const fixed = body.replace(/(^|;)(\s*padding\s*:\s*)([^;}]+)/gi, (decl, lead: string, head: string, value: string) => {
      const edges = paddingEdges(value);
      if (!edges) return decl;
      if (edges.top >= STORY_UI_RESERVE && edges.bottom >= STORY_UI_RESERVE) return decl;
      const parts = value.trim().split(/\s+/);
      const top = Math.max(edges.top, STORY_UI_RESERVE);
      const bottom = Math.max(edges.bottom, STORY_UI_RESERVE);
      // Keep the horizontal values the brand chose; only the UI bands are ours.
      const sides = parts.length >= 2 ? parts[1]! : `${edges.top}px`;
      const left = parts.length === 4 ? ` ${parts[3]}` : '';
      return `${lead}${head}${top}px ${sides} ${bottom}px${left}`;
    });
    return fixed === body ? whole : `${selector}{${fixed}}`;
  });
}

/**
 * How far a descender reaches below the baseline, as a share of the font size.
 *
 * A `ç`, a `g` or a `?` paints outside its line box, and a display serif set
 * with a line-height under 1 has a line box SHORTER than its own ink. So a
 * headline whose box merely abuts the next element still renders its cedilla on
 * top of that element: `Quer um guia para começar?` sat directly on the gold CTA
 * chip, and `oferecer um extra` overlapped a cover thumbnail's top border the
 * same way. Both were the display serif at its largest size with a descender on
 * the last line.
 *
 * 0.16em is comfortably past a typical serif's descender depth (~0.21em of the
 * em box, most of which the line box already covers) without opening a visible
 * gap where none is needed.
 */
export const DESCENDER_CLEARANCE_EM = 0.16;

/** The surfaces a headline lands ON when it lands on something. */
const CLEARANCE_NEIGHBOURS = ['cta', 'cb-shot', 'panel'] as const;

/** The largest `.headline` padding-bottom the brand set, in em, if any. */
function headlinePadBottomEm(css: string): number {
  let max = 0;
  for (const m of css.matchAll(/\.headline[^{}]*\{([^}]*)\}/g)) {
    const body = m[1] ?? '';
    const pb = /(?:^|;)\s*padding-bottom\s*:\s*([\d.]+)em/i.exec(body);
    if (pb) max = Math.max(max, Number(pb[1]));
  }
  return max;
}

/**
 * Guarantee ink clearance under a headline that sits directly above a raised
 * surface.
 *
 * The collision GATE already catches this — `MIN_CLEARANCE` measures the gap
 * between painted boxes precisely because a descender paints outside its own —
 * but catching it only ever produced a hand-fix. This is the floor that stops
 * it happening, applied at RENDER beside the type, measure and story-reserve
 * floors, so every brand already in the database is corrected on the next paint.
 *
 * Scoped to the adjacency the failures actually had: a headline immediately
 * followed by a CTA, a photo slot or a panel. A headline followed by prose is
 * left alone, because normal leading already clears it and widening every
 * headline's bottom would change the vertical rhythm of every brand.
 */
export function enforceDescenderClearance(css: string): string {
  if (!css) return css;
  // Never SHRINK a brand that already reserves more than the floor.
  const em = Math.max(DESCENDER_CLEARANCE_EM, headlinePadBottomEm(css));
  const selector = CLEARANCE_NEIGHBOURS.map((n) => `.cb-slide .headline:has(+ .${n})`).join(',');
  // `em` resolves against the HEADLINE's own font size, which is the whole
  // point: the clearance a descender needs scales with the type that draws it.
  return `${css}\n${selector}{padding-bottom:${em}em}`;
}

/**
 * The air a brand lockup needs under it, in px on the 1080 canvas.
 *
 * Measured across all 79 stored slides. The tightest ink-to-ink gap on a slide
 * sits at a median of 32px and never below 14px — EXCEPT on eight slides that
 * all read 5px, all on the same pair (`logo-row → eyebrow`) and the same brands.
 * That is a sixfold outlier against the next tightest pair, not a design choice:
 * neither `.logo-row` nor `.eyebrow` declares any vertical margin, so they sit
 * flush and the only thing separating them is the eyebrow's own leading. Every
 * other block in those recipes carries a margin; the eyebrow was simply missed.
 *
 * 24px sits inside the brand's own rhythm without reaching the ~32px it uses
 * between body blocks — a lockup and its kicker belong closer together than two
 * paragraphs do.
 */
export const LOCKUP_GAP_PX = 24;

/** Does the CSS declare a vertical margin-top for this class anywhere? */
function declaresMarginTop(css: string, cls: string): boolean {
  const rules = css.matchAll(new RegExp(`\\.${cls}(?![\\w-])[^{}]*\\{([^}]*)\\}`, 'g'));
  for (const m of rules) {
    if (/(?:^|;)\s*margin(-top)?\s*:/i.test(m[1] ?? '')) return true;
  }
  return false;
}

/**
 * Put air under the brand lockup when the recipe forgot to.
 *
 * Applied at RENDER beside the type, measure, story-reserve and descender
 * floors, so every brand already in the database is corrected on the next paint.
 *
 * Deliberately narrow in two ways. It only touches what directly FOLLOWS a
 * `.logo-row` — the one adjacency the corpus showed failing — and only classes
 * the recipe gives no margin of their own, so a brand that chose its spacing
 * keeps it. A brand with no lockup is untouched entirely.
 */
export function enforceLockupGap(css: string): string {
  if (!css || !/\.logo-row(?![\w-])/.test(css)) return css;
  // Which classes could follow the lockup, and which of those the brand has
  // already spaced deliberately.
  const candidates = new Set<string>();
  for (const m of css.matchAll(/\.cb-slide\s+\.([\w-]+)\s*\{/g)) {
    const cls = m[1];
    if (cls && cls !== 'logo-row' && !declaresMarginTop(css, cls)) candidates.add(cls);
  }
  if (!candidates.size) return css;
  const selector = [...candidates]
    .sort()
    .map((c) => `.cb-slide .logo-row + .${c}`)
    .join(',');
  return `${css}\n${selector}{margin-top:${LOCKUP_GAP_PX}px}`;
}
