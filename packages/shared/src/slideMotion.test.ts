import { describe, expect, it } from 'vitest';
import {
  AMBIENT_AMPLITUDE,
  AMBIENT_DEPTH,
  AMBIENT_SECONDS,
  DEFAULT_AMBIENT,
  PHOTO_MOVES,
  ambientArtCss,
  ambientPhotoCss,
  ambientStart,
  resolveMove,
} from './slideMotion';

/** Pull the scale factor out of a `scale(N) translate(...)` transform. */
const scaleOf = (t: string) => Number(t.match(/scale\(([\d.]+)\)/)![1]);
const translateOf = (t: string) =>
  (t.match(/translate\(([-\d.]+)%, ([-\d.]+)%\)/) ?? []).slice(1).map(Number);

describe('resolveMove', () => {
  it('opens out FROM a focal point, because that is where the subject is', () => {
    expect(resolveMove('auto', { x: 0.2, y: 0.3 })).toBe('zoom');
    expect(resolveMove(undefined, { x: 0.5, y: 0.5 })).toBe('zoom');
  });

  it('cycles without a focal point, so a deck does not move identically throughout', () => {
    const cycle = [0, 1, 2, 3].map((i) => resolveMove('auto', undefined, i));
    expect(new Set(cycle).size).toBeGreaterThan(1);
  });

  it('lets an explicit choice win', () => {
    expect(resolveMove('left', { x: 0.2, y: 0.3 })).toBe('left');
    expect(resolveMove('none')).toBe('none');
  });

  it('reads photos stored under the retired `in`/`out` vocabulary', () => {
    // Both used to exist and `in` ended zoomed. They are one settle now, and a
    // stored photo must not fall through to `auto` and change move on reload.
    expect(resolveMove('in', undefined, 1)).toBe('zoom');
    expect(resolveMove('out', undefined, 1)).toBe('zoom');
  });
});

describe('parallax depth', () => {
  it('moves nearer layers further than distant ones', () => {
    const s = (layer: 'art' | 'background' | 'slot' | 'free') =>
      scaleOf(ambientStart('zoom', layer, DEFAULT_AMBIENT)!);
    // This ordering IS the parallax effect — if it ever flattens, depth is gone.
    expect(s('background')).toBeLessThan(s('slot'));
    expect(s('slot')).toBeLessThan(s('free'));
  });

  it('scales with intensity', () => {
    const at = (intensity: 'subtle' | 'medium' | 'strong') =>
      scaleOf(ambientStart('zoom', 'slot', { style: 'parallax', intensity })!);
    expect(at('subtle')).toBeLessThan(at('medium'));
    expect(at('medium')).toBeLessThan(at('strong'));
  });
});

describe('ambientStart', () => {
  it('returns nothing when the photo or the brand opts out', () => {
    expect(ambientStart('none', 'slot', DEFAULT_AMBIENT)).toBeNull();
    expect(ambientStart('zoom', 'slot', { style: 'none', intensity: 'subtle' })).toBeNull();
  });

  it('always zooms past whatever it pans, so the edge never walks into frame', () => {
    const t = ambientStart('left', 'free', { style: 'parallax', intensity: 'strong' })!;
    const [dx] = translateOf(t);
    // The zoom has to cover the pan on both sides of centre.
    expect(scaleOf(t) - 1).toBeGreaterThan((Math.abs(dx!) * 2) / 100);
  });

  it('push is zoom-only and drift is pan-only', () => {
    const push = ambientStart('left', 'slot', { style: 'push', intensity: 'medium' })!;
    expect(translateOf(push)).toEqual([0, 0]);
    const drift = ambientStart('left', 'slot', { style: 'drift', intensity: 'medium' })!;
    expect(translateOf(drift)[0]).toBeLessThan(0);
    const parallax = ambientStart('left', 'slot', { style: 'parallax', intensity: 'medium' })!;
    // Drift still zooms enough to cover its own pan, just not beyond it.
    expect(scaleOf(drift)).toBeLessThan(scaleOf(parallax));
  });

  it('starts tighter than rest for every move there is — so none of them can end tighter', () => {
    for (const move of PHOTO_MOVES) {
      if (move === 'auto' || move === 'none') continue;
      expect(scaleOf(ambientStart(move, 'slot', DEFAULT_AMBIENT)!)).toBeGreaterThan(1);
    }
  });
});

/**
 * THE GUARANTEE. Motion may take a photo away from the framing the user set and
 * bring it back — never leave it somewhere else, because whatever it ends on is
 * what the rest of the clip holds and what the still PNG shows. It is enforced
 * by writing no `to` keyframe at all, so CSS fills the endpoint from the
 * element's own untransformed style. These tests pin that ABSENCE: the moment a
 * `to` appears, the guarantee becomes arithmetic that can be wrong.
 */
describe('ambientPhotoCss', () => {
  it('declares only a `from`, so the move can only end on the untransformed photo', () => {
    const css = ambientPhotoCss('.s .p', 'cb-amb-x', 'zoom', 'slot', DEFAULT_AMBIENT, { x: 0.2, y: 0.8 });
    expect(css).toMatch(/@keyframes cb-amb-x\{from\{transform:[^}]+\}\}/);
    expect(css).not.toContain('to{');
  });

  it('anchors the move on the focal point, so it opens out from the subject', () => {
    const css = ambientPhotoCss('.s .p', 'cb-amb-x', 'zoom', 'slot', DEFAULT_AMBIENT, { x: 0.2, y: 0.8 });
    expect(css).toContain('transform-origin:20.0% 80.0%');
  });

  it('runs for the opening seconds only, however long the clip is', () => {
    const css = ambientPhotoCss('.s .p', 'cb-amb-x', 'zoom', 'slot', DEFAULT_AMBIENT);
    expect(css).toContain(`${AMBIENT_SECONDS}s`);
    expect(AMBIENT_SECONDS).toBeLessThanOrEqual(3);
    // No clip-length parameter to pass: a longer video holds longer, it does
    // not drift longer.
    expect(ambientPhotoCss.length).toBeLessThanOrEqual(6);
  });

  it('emits nothing at all for a still photo', () => {
    expect(ambientPhotoCss('.s .p', 'k', 'none', 'slot', DEFAULT_AMBIENT)).toBe('');
  });

  it('moves a background photo less than a slot photo', () => {
    const at = (css: string) => Number(css.match(/scale\(([\d.]+)\)/)![1]);
    const bg = at(ambientPhotoCss('.s .p', 'cb-amb-bg', 'zoom', 'background', DEFAULT_AMBIENT));
    const slot = at(ambientPhotoCss('.s .p', 'cb-amb-s', 'zoom', 'slot', DEFAULT_AMBIENT));
    expect(bg).toBeLessThan(slot);
    expect(bg - 1).toBeCloseTo(AMBIENT_AMPLITUDE.medium.scale * AMBIENT_DEPTH.background, 4);
  });
});

describe('ambientArtCss', () => {
  it('drifts the recipe art with background-position, NEVER a transform', () => {
    // The art is painted on `.cb-slide`, which also holds every word on the
    // slide. A transform here would drag the whole composition with it.
    const css = ambientArtCss('cbs1', DEFAULT_AMBIENT);
    expect(css).toContain('background-position');
    expect(css).not.toContain('transform');
  });

  it('lets the art land on the position the recipe authored, by not naming an end', () => {
    expect(ambientArtCss('cbs1', DEFAULT_AMBIENT)).not.toContain('to{');
  });

  it('is scoped to the render instance so slides on one page do not collide', () => {
    expect(ambientArtCss('cbs1', DEFAULT_AMBIENT)).toContain('.cbs1 .cb-slide');
  });

  it('stays silent for a brand that opted out', () => {
    expect(ambientArtCss('cbs1', { style: 'none', intensity: 'subtle' })).toBe('');
  });
});
