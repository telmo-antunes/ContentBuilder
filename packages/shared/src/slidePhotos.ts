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
 * The shapes a slot can take, and how much of the canvas HEIGHT each may spend.
 *
 * The height budget is deliberately expressed as a fraction of the canvas
 * rather than a fixed size, because the same recipe composes 4:5, 1:1 and 9:16.
 */
export const SLOT_SHAPES = {
  '': { ratio: 4 / 3, budget: 0.34 },
  // `wide` is budgeted to span the full text column on a 4:5 canvas.
  wide: { ratio: 16 / 9, budget: 0.38 },
  // `tall` is the expensive one — nearly half the slide. The composer is told
  // so, because at 52% it reliably pushed a headline + rule + body off-canvas.
  tall: { ratio: 3 / 4, budget: 0.46 },
  square: { ratio: 1, budget: 0.38 },
} as const;

/**
 * The app's image-layer CSS for one canvas, injected with every recipe
 * stylesheet.
 *
 * This is structural capability, not brand taste — which is why it isn't
 * authored per brand. It still reads brand-ish, because every value it picks
 * comes from the recipe's own `--cb-*` tokens (radius, ink, body face).
 *
 * WHY THE CAP IS ON THE WIDTH. A slot needs a height limit or it runs off the
 * canvas — at full column width a 3:4 slot computes to ~1200px, taller than a
 * 4:5 slide's whole content box. But capping the HEIGHT of a `width:100%`
 * element with an `aspect-ratio` doesn't shrink it, it RESHAPES it: the width
 * stays, the height clamps, and the ratio becomes whatever is left over. That
 * turned every shape into a lie — `tall` (3:4 portrait) rendered at 1.34:1,
 * i.e. landscape.
 *
 * So the budget is converted into a `max-width` (budget x ratio). The width
 * binds first, `aspect-ratio` derives the height from the width that survived,
 * and the shape always holds. `max-height` stays as a belt-and-braces that
 * should never actually bind.
 *
 * Per-slot appearance (filled vs. empty) is NOT here: the renderer emits one
 * rule per slot from what it knows, which avoids a `:not([filled])` selector
 * that would out-specify the fill rule and keep the dashed box on top of the
 * user's photo.
 */
export function slideMediaCss(canvasHeight = 1350, align?: string): string {
  const shape = (cls: string, ratio: number, budget: number) => {
    const maxH = Math.round(canvasHeight * budget);
    const maxW = Math.round(maxH * ratio);
    const sel = `.cb-slide .${SLOT_CLASS}${cls ? '.' + cls : ''}`;
    return `${sel}{aspect-ratio:${ratio === 1 ? '1/1' : cls === 'wide' ? '16/9' : cls === 'tall' ? '3/4' : '4/3'};` +
      `max-width:${maxW}px;max-height:${maxH}px}`;
  };
  return [
    // ── in-flow slots ────────────────────────────────────────────────────
    // `flex: 0 0 auto` — a flex shrink would compress the height and break the
    // ratio just as surely as a height cap does. The composer is told a slot
    // costs real vertical space, and the overflow guard catches the rest.
    `.cb-slide .${SLOT_CLASS}{position:relative;display:block;width:100%;margin:0;` +
      `flex:0 0 auto;overflow:hidden;border-radius:var(--cb-radius,0px);` +
      `background-color:color-mix(in srgb, var(--cb-ink) 8%, transparent);` +
      `background-position:50% 50%;background-size:cover;background-repeat:no-repeat;}`,
    // Centre-aligned brands centre their pictures too; flush brands don't.
    align === 'center' ? `.cb-slide .${SLOT_CLASS}{margin-inline:auto}` : '',
    align === 'flush-right' ? `.cb-slide .${SLOT_CLASS}{margin-inline-start:auto}` : '',
    shape('', SLOT_SHAPES[''].ratio, SLOT_SHAPES[''].budget),
    shape('wide', SLOT_SHAPES.wide.ratio, SLOT_SHAPES.wide.budget),
    shape('tall', SLOT_SHAPES.tall.ratio, SLOT_SHAPES.tall.budget),
    shape('square', SLOT_SHAPES.square.ratio, SLOT_SHAPES.square.budget),
    // ── free overlays ────────────────────────────────────────────────────
    // Two layers, so an overlay can sit above the type or be sent behind it.
    `.cb-free-layer{position:absolute;inset:0;pointer-events:none}`,
    `.cb-free-layer.over{z-index:6}`,
    `.cb-free-layer.under{z-index:0}`,
    `.cb-free-img{position:absolute;display:block;border-radius:var(--cb-radius,0px)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The rule that paints a user photo into one authored slot.
 *
 * `focal` decides which part of the picture survives the crop — without it
 * every photo is centred, which is fine for a car bonnet and decapitating for
 * a person.
 */
export function filledSlotCss(
  scope: string,
  slot: string,
  url: string,
  fit: 'cover' | 'contain',
  focal?: { x: number; y: number },
): string {
  const pos = `${((focal?.x ?? 0.5) * 100).toFixed(1)}% ${((focal?.y ?? 0.5) * 100).toFixed(1)}%`;
  // The photo lives on ::before rather than on the element, so ambient motion
  // can TRANSFORM it inside the slot's overflow clip. Painting it on the
  // element itself would mean transforming the box (moving the hole, not the
  // picture), and background-position/size can't express a smooth push-in.
  // It also leaves ::after free for the recipe's own scrim or grain.
  return (
    `.${scope} .cb-slide [${SLOT_ATTR}="${slot}"]::before{` +
    `content:"";position:absolute;inset:0;` +
    `background-image:url("${url}");background-size:${fit};background-position:${pos};` +
    `background-repeat:no-repeat;}`
  );
}

/**
 * The user's background photo, as its own full-bleed layer.
 *
 * It used to be handed to the recipe as `var(--cb-photo)` for the recipe's own
 * `.photo` rule to paint — except no recipe ever consumed it (the author prompt
 * never mentioned it), so setting a background photo rendered NOTHING. It is an
 * app-owned layer now, which both fixes that and makes it transformable.
 *
 * The scrim is app-owned too, and derived from the brand's own ground colour:
 * legibility over a photograph can't be left to whatever the recipe happened to
 * author, because the photo is user-supplied and could be any brightness.
 */
export function backgroundPhotoCss(
  scope: string,
  url: string,
  fit: 'cover' | 'contain',
  focal?: { x: number; y: number },
): string {
  const pos = `${((focal?.x ?? 0.5) * 100).toFixed(1)}% ${((focal?.y ?? 0.5) * 100).toFixed(1)}%`;
  return [
    `.${scope} .cb-bg-layer{position:absolute;inset:0;overflow:hidden;z-index:0}`,
    `.${scope} .cb-bg-photo{position:absolute;inset:0;` +
      `background-image:url("${url}");background-size:${fit};background-position:${pos};` +
      `background-repeat:no-repeat}`,
    `.${scope} .cb-bg-layer::after{content:"";position:absolute;inset:0;` +
      `background:linear-gradient(180deg, color-mix(in srgb, var(--cb-ground) 25%, transparent) 0%, ` +
      `color-mix(in srgb, var(--cb-ground) 30%, transparent) 45%, ` +
      `color-mix(in srgb, var(--cb-ground) 88%, transparent) 100%)}`,
    // The recipe's own slide background is opaque by design; with a photo behind
    // it, it would simply hide it. The composition sits above both either way.
    `.${scope} .cb-slide.cb-slide{background-image:none;background-color:transparent}`,
  ].join('\n');
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
