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
 * These are deliberately small. Ambient motion that you NOTICE is ambient
 * motion that is too strong — the effect should register as the image being
 * alive, not as the image moving.
 */
export const AMBIENT_AMPLITUDE: Record<AmbientIntensity, { scale: number; shift: number }> = {
  subtle: { scale: 0.04, shift: 1.2 },
  medium: { scale: 0.075, shift: 2.2 },
  strong: { scale: 0.115, shift: 3.4 },
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

export const DEFAULT_AMBIENT: AmbientSpec = { style: 'parallax', intensity: 'subtle' };

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

/** The from/to transform pair for one layer's ambient move. */
export function ambientTransforms(
  move: Exclude<PhotoMove, 'auto'>,
  layer: AmbientLayer,
  spec: AmbientSpec,
): { from: string; to: string } | null {
  if (move === 'none' || spec.style === 'none') return null;
  const depth = AMBIENT_DEPTH[layer];
  const amp = AMBIENT_AMPLITUDE[spec.intensity];
  // `push` is zoom-only; `drift` is pan-only; `parallax` does both.
  const useScale = spec.style !== 'drift';
  const usePan = spec.style !== 'push';
  const shift = usePan ? amp.shift * depth : 0;
  // Whatever we pan, we must first zoom past — otherwise the drift walks the
  // edge of the image into frame and shows the box behind it.
  const zoom = (useScale ? amp.scale * depth : 0) + (shift * 2) / 100;
  const pan: Record<string, [number, number]> = {
    in: [0, 0],
    out: [0, 0],
    left: [-shift, 0],
    right: [shift, 0],
    up: [0, -shift],
    down: [0, shift],
  };
  const [dx, dy] = pan[move] ?? [0, 0];
  const at = (s: number, x: number, y: number) =>
    `scale(${(1 + s).toFixed(4)}) translate(${x.toFixed(3)}%, ${y.toFixed(3)}%)`;
  // `out` starts zoomed and relaxes; everything else closes in.
  return move === 'out'
    ? { from: at(zoom, dx, dy), to: at(0, 0, 0) }
    : { from: at(0, 0, 0), to: at(zoom, dx, dy) };
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
