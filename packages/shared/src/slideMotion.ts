/**
 * AMBIENT MOTION — the slow opening move that makes a still photograph read as
 * footage rather than a slideshow.
 *
 * This is a second, independent timeline from the REVEAL choreography in
 * recipe.ts. The reveal is short and staggered: each element enters once and is
 * done. Ambient motion is longer and continuous, but it too RESOLVES.
 *
 * TWO RULES, both learned the hard way:
 *
 *  A. IT HAPPENS AT THE TOP, THEN STOPS. The move takes AMBIENT_SECONDS and the
 *     rest of the clip holds. A drift stretched across a ten-second slide is
 *     either invisible (too slow to see) or seasick (never settles); a move
 *     that lands in three and then holds reads as a deliberate camera.
 *
 *  B. IT ALWAYS LANDS ON YOUR FRAMING. A photo is cropped to its box, so any
 *     zoom or pan shows LESS of it — and whatever the move ends on is what the
 *     slide holds for the remaining seconds, and what the still PNG shows.
 *     So the move starts offset and arrives at rest: the tight, travelling
 *     framing is the transient, and the composition you set in the editor is
 *     the destination. Nothing important can be cropped away by motion,
 *     because motion is never where the slide comes to rest.
 *
 *     This is enforced STRUCTURALLY rather than arithmetically: the keyframes
 *     below declare only a `from`. CSS fills the missing `to` with the
 *     element's own underlying value, so "the end" is not a number this module
 *     can get wrong — it is the untransformed element.
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

/**
 * How long the ambient move takes — and the whole of when it happens. It is
 * NOT stretched to the clip: a twenty-second slide gets the same three-second
 * opening and then eighteen seconds of the framing you chose.
 */
export const AMBIENT_SECONDS = 3;

/**
 * How long each slide holds in a video export.
 *
 * Ten seconds is the default because these are Instagram carousels read at
 * arm's length: the reveal takes ~2s, the ambient move lands at 3s, and what's
 * left has to be long enough to actually read the slide before it moves on.
 */
export const VIDEO_SECONDS_DEFAULT = 10;
export const VIDEO_SECONDS_MIN = 3;
export const VIDEO_SECONDS_MAX = 30;

export const clampVideoSeconds = (n: unknown): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return VIDEO_SECONDS_DEFAULT;
  return Math.min(VIDEO_SECONDS_MAX, Math.max(VIDEO_SECONDS_MIN, v));
};

/**
 * Per-photo override. 'auto' lets the brand + the focal point decide.
 *
 * Every one of these is named for where the move STARTS, because they all end
 * in the same place — the framing you set (rule B above). 'zoom' opens out of
 * a close crop on the focal point; the four directions slide in from that side.
 *
 * `in` and `out` used to be separate options, and `in` ended zoomed: it shipped
 * a crop nobody chose. There is no way to push in and still finish on the whole
 * frame — a cover-filled photo has nothing wider to start from — so the two
 * became one honest move.
 */
export const PHOTO_MOVES = ['auto', 'none', 'zoom', 'left', 'right', 'up', 'down'] as const;
export type PhotoMove = (typeof PHOTO_MOVES)[number];

/** Photos stored before the move vocabulary collapsed. */
const LEGACY_MOVES: Record<string, PhotoMove> = { in: 'zoom', out: 'zoom' };

export interface AmbientSpec {
  style: AmbientStyle;
  intensity: AmbientIntensity;
}

/** Recipes authored before ambient existed fall back to this. */
export const DEFAULT_AMBIENT: AmbientSpec = { style: 'parallax', intensity: 'medium' };

/** What `auto` cycles through when a photo has no focal point to aim at. */
const AUTO_CYCLE = ['zoom', 'left', 'zoom', 'right'] as const;

/**
 * Resolve `auto` into a real move.
 *
 * A photo with a focal point has already been told where its subject is, so
 * `auto` opens out FROM it: the clip starts close on the thing you said
 * mattered and widens to the whole frame. Without a focal point there is
 * nothing to aim at, so it cycles by index — a deck where every picture moves
 * the same way reads mechanically.
 */
export function resolveMove(
  /** Accepts the retired `in`/`out` too: stored photos still carry them. */
  move: PhotoMove | 'in' | 'out' | undefined,
  focal?: { x: number; y: number },
  index = 0,
): Exclude<PhotoMove, 'auto'> {
  const m = move ? (LEGACY_MOVES[move] ?? move) : undefined;
  if (m && m !== 'auto') return m as Exclude<PhotoMove, 'auto'>;
  if (focal) return 'zoom';
  return AUTO_CYCLE[index % AUTO_CYCLE.length]!;
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
    zoom: [0, 0],
    left: [-shift, 0],
    right: [shift, 0],
    up: [0, -shift],
    down: [0, shift],
  };
  const [dx, dy] = pan[move] ?? [0, 0];
  // Whatever we pan, we must first zoom past — otherwise the drift walks the
  // edge of the image into frame and shows the box behind it. Charged against
  // the ACTUAL pan, not the configured one: `zoom` never pans, and billing it
  // for coverage it doesn't use inflated the move to 36%.
  const cover = (Math.max(Math.abs(dx), Math.abs(dy)) * 2) / 100;
  const zoom = (useScale ? amp.scale * depth : 0) + cover;
  return { zoom, dx, dy };
}

/**
 * WHERE THE MOVE BEGINS — the transform at t=0, as a CSS value.
 *
 * There is deliberately no companion `ambientEnd`. The end is the element's
 * own untransformed state, which the keyframes get by not mentioning it, so no
 * caller can be told a settled framing that differs from the resting one.
 *
 * This module used to export `ambientEndState` / `settledViewport` /
 * `settledBounds` / `hasSettledShift`, and the editor drew a brass "here is
 * what survives" frame from them, because a push-in really did ship a tighter
 * crop than the one you framed. Motion now lands at rest, so the settled frame
 * IS the frame — the guides described a difference that no longer exists, and
 * went with them.
 */
export function ambientStart(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
): string | null {
  const m = ambientMotion(move, layer, spec);
  if (!m) return null;
  return `scale(${(1 + m.zoom).toFixed(4)}) translate(${m.dx.toFixed(3)}%, ${m.dy.toFixed(3)}%)`;
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
  const from = ambientStart(move, layer, spec);
  if (!from) return '';
  const ox = ((focal?.x ?? 0.5) * 100).toFixed(1);
  const oy = ((focal?.y ?? 0.5) * 100).toFixed(1);
  return [
    // NO `to`. CSS fills the missing endpoint from the element's own style, so
    // the move can only ever finish on the untransformed photo — the framing
    // the editor showed and the still export renders.
    `@keyframes ${keyframeName}{from{transform:${from}}}`,
    // `ease-out`: a move that resolves should decelerate into rest, not coast
    // into it. `both` so the offset applies before the clip's first frame.
    `${selector}{transform-origin:${ox}% ${oy}%;` +
      `animation:${keyframeName} ${AMBIENT_SECONDS}s ease-out both;will-change:transform}`,
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
    // Again only a `from`: the art drifts in and lands on whatever position the
    // recipe authored for it. Pinning both ends used to override the brand's
    // own `background-position` outright, and left it parked off-centre.
    `@keyframes cb-amb-art{from{background-position:calc(50% - ${d}%) calc(50% - ${d}%)}}`,
    // Doubled class to match a recipe's own `.cb-slide.photo` specificity; this
    // sheet is emitted after the recipe's, so source order decides.
    `.${scope} .cb-slide.cb-slide{animation:cb-amb-art ${AMBIENT_SECONDS}s ease-out both}`,
  ].join('\n');
}
