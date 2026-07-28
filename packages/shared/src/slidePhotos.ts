/**
 * PER-SLIDE PHOTOGRAPHY — the user's own image layer, sitting alongside the
 * brand recipe's designed art.
 *
 * A slide carries as many photos as you like, each with a PLACEMENT:
 *
 *   · 'slot'       — fills a placeholder the composer authored, and is bounded
 *                    by the section that placeholder sits in. This is the
 *                    "replace the placeholder with my upload" path: the AI
 *                    decides a slide wants imagery and leaves a visible, empty,
 *                    correctly-proportioned hole for it.
 *   · 'background' — full-bleed behind the whole composition (at most one).
 *   · 'free'       — absolutely positioned anywhere on the canvas, dragged and
 *                    resized by hand. Escapes the composition entirely.
 *
 * Slots live in the authored markup (so the recipe styles them and they flow
 * with the design); background and free photos are app-owned layers the
 * renderer paints around the markup. Nothing here mutates authored HTML — the
 * fill happens through scoped CSS keyed on the slot's `data-cb-slot` name.
 */

/** Marks an authored element as an image slot the user can fill. */
export const SLOT_ATTR = 'data-cb-slot';
/** The class that styles a slot (app-owned, brand-tuned through `--cb-*`). */
export const SLOT_CLASS = 'cb-shot';

/** Slot names are author-supplied, so they're constrained to a safe alphabet. */
export const SLOT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function isSlotName(name: string): boolean {
  return SLOT_NAME_RE.test(name);
}

/**
 * The slot names an authored fragment declares, in document order, de-duped.
 *
 * Deliberately a regex rather than a DOM parse: this runs on the server (to
 * validate what the composer produced) as well as in the browser (to drive the
 * editor's slot list), and the fragment is already sanitised by the time
 * anyone asks.
 */
export function authoredSlots(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`${SLOT_ATTR}\\s*=\\s*"([^"]*)"`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = (m[1] ?? '').toLowerCase();
    if (!isSlotName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The app's image-layer CSS, injected with every recipe stylesheet.
 *
 * This is structural capability, not brand taste — which is why it isn't
 * authored per brand. It still reads brand-ish, because every value it picks
 * comes from the recipe's own `--cb-*` tokens (radius, ink, body face).
 *
 * Per-slot appearance (filled vs. empty) is NOT here: the renderer emits one
 * rule per slot from what it knows, which avoids a `:not([filled])` selector
 * that would out-specify the fill rule and keep the dashed box on top of the
 * user's photo.
 */
export function slideMediaCss(): string {
  return [
    // ── in-flow slots ────────────────────────────────────────────────────
    // The slide is a flex COLUMN, so a slot must behave like a good citizen of
    // it: `flex: 0 1 auto` + `min-height: 0` let it yield rather than push the
    // copy off the canvas, and each shape carries a cap because at full width
    // an uncapped ratio is taller than the whole content box (a 3/4 slot across
    // a 1080 canvas computes to ~1200px — more than a 4:5 slide even has).
    `.cb-slide .${SLOT_CLASS}{position:relative;display:block;width:100%;margin:0;` +
      `flex:0 1 auto;min-height:0;overflow:hidden;border-radius:var(--cb-radius,0px);` +
      `background-color:color-mix(in srgb, var(--cb-ink) 8%, transparent);` +
      `background-position:50% 50%;background-size:cover;background-repeat:no-repeat;` +
      `aspect-ratio:4/3;max-height:40%;}`,
    `.cb-slide .${SLOT_CLASS}.wide{aspect-ratio:16/9;max-height:32%}`,
    `.cb-slide .${SLOT_CLASS}.tall{aspect-ratio:3/4;max-height:50%}`,
    `.cb-slide .${SLOT_CLASS}.square{aspect-ratio:1/1;max-height:44%}`,
    // ── free overlays ────────────────────────────────────────────────────
    // Two layers, so an overlay can sit above the type or be sent behind it.
    `.cb-free-layer{position:absolute;inset:0;pointer-events:none}`,
    `.cb-free-layer.over{z-index:6}`,
    `.cb-free-layer.under{z-index:0}`,
    `.cb-free-img{position:absolute;display:block;border-radius:var(--cb-radius,0px)}`,
  ].join('\n');
}

/** The rule that paints a user photo into one authored slot. */
export function filledSlotCss(scope: string, slot: string, url: string, fit: 'cover' | 'contain'): string {
  return (
    `.${scope} .cb-slide [${SLOT_ATTR}="${slot}"]{` +
    `background-image:url("${url}");background-size:${fit};}`
  );
}

/**
 * The rule that marks an UNFILLED slot as something to click.
 *
 * Only ever emitted while editing: a placeholder the user never filled must
 * not reach a PNG or an MP4 as a dashed "Add photo" box. On export the slot
 * keeps its quiet tint of brand ink, which reads as an intentional panel.
 */
export function emptySlotCss(scope: string, slot: string): string {
  const sel = `.${scope} .cb-slide [${SLOT_ATTR}="${slot}"]`;
  return [
    `${sel}{border:2px dashed color-mix(in srgb, var(--cb-ink) 32%, transparent);` +
      `background-color:color-mix(in srgb, var(--cb-ink) 5%, transparent);}`,
    `${sel}::after{content:"Add photo";position:absolute;inset:0;display:flex;` +
      `align-items:center;justify-content:center;font-family:var(--cb-body);font-size:30px;` +
      `letter-spacing:0.06em;text-transform:uppercase;` +
      `color:color-mix(in srgb, var(--cb-ink) 42%, transparent);}`,
  ].join('\n');
}
