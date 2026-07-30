/**
 * AMBIENT MOTION — the slow, continuous drift that makes a still photograph
 * read as footage rather than a slideshow.
 *
 * This is a second, independent timeline from the REVEAL choreography in
 * recipe.ts. The reveal is short and staggered: each element enters once and is
 * done. Ambient motion runs for the whole clip and never lands.
 *
 * The layers move at DIFFERENT SPEEDS, which is what sells depth — far things
 * barely move, near things move most:
 *
 *   recipe's own background art   0.35x   (a drifting god-ray / grain)
 *   the user's background photo   0.55x
 *   a photo in a slot             1.00x
 *   a floating overlay            1.50x   (nearest the viewer)
 *
 * Two hard constraints shape the implementation:
 *
 *  1. THE TEXT MUST NOT MOVE. So the recipe's art is drifted with
 *     `background-position` (which only moves background layers, never
 *     children), and every photo layer is a separate element that can carry its
 *     own transform.
 *
 *  2. IT MUST SURVIVE FRAME CAPTURE. The video exporter steps a paused CSS
 *     timeline, so this has to be plain declarative CSS on that timeline — the
 *     same reason the count-up stat is a registered custom property rather than
 *     a JS counter.
 */

/** How far each layer moves, relative to the brand's chosen amplitude. */
export const AMBIENT_DEPTH = {
  art: 0.35,
  background: 0.55,
  slot: 1,
  free: 1.5,
} as const;

export type AmbientLayer = keyof typeof AMBIENT_DEPTH;

export const AMBIENT_STYLES = ['parallax', 'push', 'drift', 'none'] as const;
export type AmbientStyle = (typeof AMBIENT_STYLES)[number];

export const AMBIENT_INTENSITIES = ['subtle', 'medium', 'strong'] as const;
export type AmbientIntensity = (typeof AMBIENT_INTENSITIES)[number];

/**
 * Amplitude per intensity. `scale` is the extra zoom over the whole clip;
 * `shift` is the lateral drift as a percentage of the layer's own box.
 *
 * CALIBRATION. These began far too timid, on the theory that ambient motion
 * you NOTICE is too strong. Measured, the old `subtle` moved a background
 * photo 3.5% over seven seconds — 0.75 px/second in a preview, well below what
 * an eye can detect. It was not subtle, it was invisible, and the feature read
 * as broken.
 *
 * The bar is a documentary slow zoom: unmistakably alive when you look, never
 * demanding when you don't. Roughly 9–24% over seven seconds, which is what
 * archive footage has always used.
 */
export const AMBIENT_AMPLITUDE: Record<AmbientIntensity, { scale: number; shift: number }> = {
  subtle: { scale: 0.09, shift: 2.6 },
  medium: { scale: 0.15, shift: 4.4 },
  strong: { scale: 0.24, shift: 7 },
};

/** How long one ambient move takes. Also the floor for a clip's length. */
export const AMBIENT_SECONDS = 7;

/** Per-photo override. 'auto' lets the brand + the focal point decide. */
export const PHOTO_MOVES = ['auto', 'none', 'in', 'out', 'left', 'right', 'up', 'down'] as const;
export type PhotoMove = (typeof PHOTO_MOVES)[number];

export interface AmbientSpec {
  style: AmbientStyle;
  intensity: AmbientIntensity;
}

/** Recipes authored before ambient existed fall back to this. */
export const DEFAULT_AMBIENT: AmbientSpec = { style: 'parallax', intensity: 'medium' };

/**
 * Resolve `auto` into a real move.
 *
 * A photo with a focal point has already been told where its subject is, so
 * `auto` pushes IN toward it: the frame closes on the thing you said mattered.
 * Without a focal point there is nothing to aim at, so it alternates by index —
 * a deck where every picture pushes in the same way reads mechanically.
 */
export function resolveMove(move: PhotoMove | undefined, focal?: { x: number; y: number }, index = 0): Exclude<PhotoMove, 'auto'> {
  if (move && move !== 'auto') return move;
  if (focal) return 'in';
  return index % 2 === 0 ? 'in' : 'out';
}

/**
 * The NUMBERS behind one layer's ambient move, before they become CSS.
 *
 * `zoom` is the extra scale at the far end of the move; `dx`/`dy` are the pan
 * in CSS `translate` percentages of the layer's own box. Everything that needs
 * to reason about ambient geometry — the stylesheet, the settled-frame guides
 * in the editor — comes through here, so there is exactly one place where the
 * amplitude and the cover allowance are decided.
 */
function ambientMotion(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
): { zoom: number; dx: number; dy: number } | null {
  if (move === 'none' || spec.style === 'none') return null;
  const depth = AMBIENT_DEPTH[layer];
  const amp = AMBIENT_AMPLITUDE[spec.intensity];
  // `push` is zoom-only; `drift` is pan-only; `parallax` does both.
  const useScale = spec.style !== 'drift';
  const usePan = spec.style !== 'push';
  const shift = usePan ? amp.shift * depth : 0;
  const pan: Record<string, [number, number]> = {
    in: [0, 0],
    out: [0, 0],
    left: [-shift, 0],
    right: [shift, 0],
    up: [0, -shift],
    down: [0, shift],
  };
  const [dx, dy] = pan[move] ?? [0, 0];
  // Whatever we pan, we must first zoom past — otherwise the drift walks the
  // edge of the image into frame and shows the box behind it. Charged against
  // the ACTUAL pan, not the configured one: `in` and `out` never pan, and
  // billing them for coverage they don't use inflated a push-in to 36%.
  const cover = (Math.max(Math.abs(dx), Math.abs(dy)) * 2) / 100;
  const zoom = (useScale ? amp.scale * depth : 0) + cover;
  return { zoom, dx, dy };
}

/** The from/to transform pair for one layer's ambient move. */
export function ambientTransforms(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
): { from: string; to: string } | null {
  const m = ambientMotion(move, layer, spec);
  if (!m) return null;
  const at = (s: number, x: number, y: number) =>
    `scale(${(1 + s).toFixed(4)}) translate(${x.toFixed(3)}%, ${y.toFixed(3)}%)`;
  // `out` starts zoomed and relaxes; everything else closes in.
  return move === 'out'
    ? { from: at(m.zoom, m.dx, m.dy), to: at(0, 0, 0) }
    : { from: at(0, 0, 0), to: at(m.zoom, m.dx, m.dy) };
}

/** A rectangle in a layer's own box, as fractions [0..1] of its width/height. */
export interface MotionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a layer's transform LANDS — the state it holds once the move is over.
 *
 * `ambientPhotoCss` emits `animation: … both`, so the layer sticks at the
 * keyframes' `to` state, and the video exporter deliberately seeks every
 * `cb-amb-*` animation to its end for the hold frames. This is therefore the
 * framing that actually ships, and the one the editor should be showing.
 *
 * `dx`/`dy` are FRACTIONS of the layer's box (the emitted percentage ÷ 100).
 * A still layer — and every `out`, which relaxes back to rest — reports the
 * identity, so callers can treat "no motion" and "settles at rest" alike.
 */
export function ambientEndState(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
): { scale: number; dx: number; dy: number } {
  const m = ambientMotion(move, layer, spec);
  if (!m || move === 'out') return { scale: 1, dx: 0, dy: 0 };
  return { scale: 1 + m.zoom, dx: m.dx / 100, dy: m.dy / 100 };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * THE GEOMETRY, once. CSS composes `transform: scale(s) translate(d)` about
 * `transform-origin: o` right-to-left, so a point `p` of the element lands at
 *
 *     p' = o + s · (p − o + d)
 *
 * with `p`, `p'`, `o` and `d` all as fractions of the element's own box. Both
 * helpers below are that one line, read in opposite directions.
 */
const forward = (p: number, o: number, s: number, d: number) => o + s * (p - o + d);

/**
 * The part of the photo still on screen when the move has settled, in the
 * layer's own [0..1] coordinates.
 *
 * Inverting `p' = o + s·(p − o + d)` for the window `p' ∈ [0,1]`:
 *
 *     left = o · (1 − 1/s) − d      width = 1/s
 *
 * A push-in eats the edges, so what you frame at rest is NOT what ships — this
 * is what the editor draws so you can see the difference before you export.
 * Clamped to the box: with the origin hard against an edge the zoom can drag
 * the layer off its own frame, and there is no photo out there to show.
 */
export function settledViewport(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
  focal?: { x: number; y: number },
): MotionRect {
  const { scale: s, dx, dy } = ambientEndState(move, layer, spec);
  if (s === 1 && dx === 0 && dy === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const axis = (o: number, d: number) => {
    const lo = clamp01(o * (1 - 1 / s) - d);
    const hi = clamp01(o * (1 - 1 / s) - d + 1 / s);
    return { lo, len: Math.max(0, hi - lo) };
  };
  const h = axis(focal?.x ?? 0.5, dx);
  const v = axis(focal?.y ?? 0.5, dy);
  return { x: h.lo, y: v.lo, w: h.len, h: v.len };
}

/**
 * Where the layer's own BOX ends up once the move has settled — the forward
 * reading of the same mapping, in the box's own [0..1] coordinates.
 *
 * Deliberately unclamped: the whole point for a floating photo is that it
 * grows past the frame you dragged, and a guide that stopped at the edge would
 * hide exactly the overhang the user needs to see.
 */
export function settledBounds(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
  focal?: { x: number; y: number },
): MotionRect {
  const { scale: s, dx, dy } = ambientEndState(move, layer, spec);
  const ox = focal?.x ?? 0.5;
  const oy = focal?.y ?? 0.5;
  return { x: forward(0, ox, s, dx), y: forward(0, oy, s, dy), w: s, h: s };
}

/** Whether the settled framing differs from what you see at rest at all. */
export function hasSettledShift(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
): boolean {
  const { scale, dx, dy } = ambientEndState(move, layer, spec);
  return scale !== 1 || dx !== 0 || dy !== 0;
}

/**
 * The ambient CSS for one photo layer, scoped to a render instance.
 *
 * `transform-origin` follows the focal point, so a push-in closes on the
 * subject rather than on the middle of the frame.
 */
export function ambientPhotoCss(
  selector: string,
  keyframeName: string,
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
  focal?: { x: number; y: number },
): string {
  const t = ambientTransforms(move, layer, spec);
  if (!t) return '';
  const ox = ((focal?.x ?? 0.5) * 100).toFixed(1);
  const oy = ((focal?.y ?? 0.5) * 100).toFixed(1);
  return [
    `@keyframes ${keyframeName}{from{transform:${t.from}}to{transform:${t.to}}}`,
    // `alternate` so a long hold never jumps: the move eases out and comes back
    // rather than cutting from fully-zoomed to the start.
    `${selector}{transform-origin:${ox}% ${oy}%;` +
      `animation:${keyframeName} ${AMBIENT_SECONDS}s ease-in-out both;will-change:transform}`,
  ].join('\n');
}

/**
 * The drift for the recipe's OWN authored background art.
 *
 * Deliberately `background-position` rather than a transform: the art is
 * painted on `.cb-slide`, which also holds every text element, so a transform
 * would drag the whole composition with it. Moving the background position
 * moves only the painted layers.
 */
export function ambientArtCss(scope: string, spec: AmbientSpec): string {
  if (spec.style === 'none') return '';
  const amp = AMBIENT_AMPLITUDE[spec.intensity];
  const d = (amp.shift * AMBIENT_DEPTH.art).toFixed(2);
  return [
    `@keyframes cb-amb-art{from{background-position:calc(50% - ${d}%) calc(50% - ${d}%)}` +
      `to{background-position:calc(50% + ${d}%) calc(50% + ${d}%)}}`,
    // Doubled class to match a recipe's own `.cb-slide.photo` specificity; this
    // sheet is emitted after the recipe's, so source order decides.
    `.${scope} .cb-slide.cb-slide{animation:cb-amb-art ${AMBIENT_SECONDS}s ease-in-out both}`,
  ].join('\n');
}
