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
