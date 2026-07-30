import { describe, expect, it } from 'vitest';
import {
  AMBIENT_AMPLITUDE,
  AMBIENT_DEPTH,
  AMBIENT_SECONDS,
  DEFAULT_AMBIENT,
  ambientArtCss,
  ambientEndState,
  ambientPhotoCss,
  ambientTransforms,
  hasSettledShift,
  resolveMove,
  settledBounds,
  settledViewport,
} from './slideMotion';

/** Pull the scale factor out of a `scale(N) translate(...)` transform. */
const scaleOf = (t: string) => Number(t.match(/scale\(([\d.]+)\)/)![1]);
const translateOf = (t: string) =>
  (t.match(/translate\(([-\d.]+)%, ([-\d.]+)%\)/) ?? []).slice(1).map(Number);

describe('resolveMove', () => {
  it('pushes in toward a focal point, because that is where the subject is', () => {
    expect(resolveMove('auto', { x: 0.2, y: 0.3 })).toBe('in');
    expect(resolveMove(undefined, { x: 0.5, y: 0.5 })).toBe('in');
  });

  it('alternates without a focal point, so a deck does not move identically throughout', () => {
    expect(resolveMove('auto', undefined, 0)).toBe('in');
    expect(resolveMove('auto', undefined, 1)).toBe('out');
  });

  it('lets an explicit choice win', () => {
    expect(resolveMove('left', { x: 0.2, y: 0.3 })).toBe('left');
    expect(resolveMove('none')).toBe('none');
  });
});

describe('parallax depth', () => {
  it('moves nearer layers further than distant ones', () => {
    const s = (layer: 'art' | 'background' | 'slot' | 'free') =>
      scaleOf(ambientTransforms('in', layer, DEFAULT_AMBIENT)!.to);
    // This ordering IS the parallax effect — if it ever flattens, depth is gone.
    expect(s('background')).toBeLessThan(s('slot'));
    expect(s('slot')).toBeLessThan(s('free'));
  });

  it('scales with intensity', () => {
    const at = (intensity: 'subtle' | 'medium' | 'strong') =>
      scaleOf(ambientTransforms('in', 'slot', { style: 'parallax', intensity })!.to);
    expect(at('subtle')).toBeLessThan(at('medium'));
    expect(at('medium')).toBeLessThan(at('strong'));
  });
});

describe('ambientTransforms', () => {
  it('returns nothing when the photo or the brand opts out', () => {
    expect(ambientTransforms('none', 'slot', DEFAULT_AMBIENT)).toBeNull();
    expect(ambientTransforms('in', 'slot', { style: 'none', intensity: 'subtle' })).toBeNull();
  });

  it('always zooms past whatever it pans, so the edge never walks into frame', () => {
    const t = ambientTransforms('left', 'free', { style: 'parallax', intensity: 'strong' })!;
    const [dx] = translateOf(t.to);
    // The zoom has to cover the pan on both sides of centre.
    expect(scaleOf(t.to) - 1).toBeGreaterThan((Math.abs(dx!) * 2) / 100);
  });

  it('push is zoom-only and drift is pan-only', () => {
    const push = ambientTransforms('left', 'slot', { style: 'push', intensity: 'medium' })!;
    expect(translateOf(push.to)).toEqual([0, 0]);
    const drift = ambientTransforms('left', 'slot', { style: 'drift', intensity: 'medium' })!;
    expect(translateOf(drift.to)[0]).toBeLessThan(0);
    const parallax = ambientTransforms('left', 'slot', { style: 'parallax', intensity: 'medium' })!;
    // Drift still zooms enough to cover its own pan, just not beyond it.
    expect(scaleOf(drift.to)).toBeLessThan(scaleOf(parallax.to));
  });

  it('runs `out` backwards — starting close and relaxing', () => {
    const t = ambientTransforms('out', 'slot', DEFAULT_AMBIENT)!;
    expect(scaleOf(t.from)).toBeGreaterThan(scaleOf(t.to));
    expect(scaleOf(t.to)).toBe(1);
  });
});

describe('ambientEndState', () => {
  it('reports the state the layer HOLDS at, which is what the export ships', () => {
    // `animation: … both` sticks at the keyframes' `to`, and the exporter seeks
    // every cb-amb-* animation to its end for the hold frames.
    const e = ambientEndState('in', 'slot', DEFAULT_AMBIENT);
    expect(e.scale).toBeCloseTo(1 + AMBIENT_AMPLITUDE.medium.scale * AMBIENT_DEPTH.slot, 10);
    expect(e).toMatchObject({ dx: 0, dy: 0 });
  });

  it('is the identity for a still layer and for `out`, which relaxes back to rest', () => {
    expect(ambientEndState('none', 'slot', DEFAULT_AMBIENT)).toEqual({ scale: 1, dx: 0, dy: 0 });
    expect(ambientEndState('in', 'slot', { style: 'none', intensity: 'strong' })).toEqual({ scale: 1, dx: 0, dy: 0 });
    expect(ambientEndState('out', 'free', DEFAULT_AMBIENT)).toEqual({ scale: 1, dx: 0, dy: 0 });
  });

  it('agrees with the transform the renderer actually emits', () => {
    const e = ambientEndState('left', 'free', { style: 'parallax', intensity: 'strong' });
    const t = ambientTransforms('left', 'free', { style: 'parallax', intensity: 'strong' })!;
    expect(scaleOf(t.to)).toBeCloseTo(e.scale, 4);
    expect(translateOf(t.to)[0]! / 100).toBeCloseTo(e.dx, 4);
  });

  it('pans as a FRACTION of the box, not the percentage the CSS carries', () => {
    const e = ambientEndState('down', 'slot', { style: 'drift', intensity: 'medium' });
    expect(e.dy).toBeCloseTo(AMBIENT_AMPLITUDE.medium.shift * AMBIENT_DEPTH.slot / 100, 10);
  });
});

describe('settledViewport', () => {
  it('is the whole box when nothing moves', () => {
    expect(settledViewport('none', 'slot', DEFAULT_AMBIENT)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(settledViewport('in', 'slot', { style: 'none', intensity: 'medium' })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('is the whole box for `out`, which ENDS at rest — the tight frame is its start', () => {
    expect(settledViewport('out', 'free', { style: 'parallax', intensity: 'strong' })).toEqual({
      x: 0, y: 0, w: 1, h: 1,
    });
  });

  it('eats the edges of a push-in by exactly 1 − 1/s', () => {
    // parallax/medium on a slot: zoom 0.15, no pan → s = 1.15 about the centre.
    const r = settledViewport('in', 'slot', DEFAULT_AMBIENT);
    expect(r.w).toBeCloseTo(1 / 1.15, 6);
    expect(r.h).toBeCloseTo(1 / 1.15, 6);
    expect(r.x).toBeCloseTo(0.5 * (1 - 1 / 1.15), 6);
    expect(r.y).toBeCloseTo(0.5 * (1 - 1 / 1.15), 6);
  });

  it('closes on the focal point, not the middle of the frame', () => {
    const r = settledViewport('in', 'slot', DEFAULT_AMBIENT, { x: 0.2, y: 0.8 });
    expect(r.x).toBeCloseTo(0.2 * (1 - 1 / 1.15), 6);
    expect(r.y).toBeCloseTo(0.8 * (1 - 1 / 1.15), 6);
    expect(r.w).toBeCloseTo(1 / 1.15, 6);
    // A subject at 20%/80% stays inside the surviving window; the far edges go.
    expect(r.x).toBeLessThan(0.2);
    expect(r.x + r.w).toBeGreaterThan(0.2);
  });

  it('shows the far side of a pan — the layer moves left, so the right survives', () => {
    // parallax/medium on a slot: shift 4.4%, cover 8.8% → s = 1.238, dx = −0.044.
    const r = settledViewport('left', 'slot', DEFAULT_AMBIENT);
    expect(r.w).toBeCloseTo(1 / 1.238, 6);
    expect(r.x).toBeCloseTo(0.5 * (1 - 1 / 1.238) + 0.044, 6);
    expect(r.x + r.w).toBeLessThanOrEqual(1);   // the cover zoom holds the edge out
    expect(r.x).toBeGreaterThan(0.5 * (1 - 1 / 1.238)); // pushed right of centre
    expect(r.y).toBeCloseTo(0.5 * (1 - 1 / 1.238), 6);  // nothing vertical moved
  });

  it('never reports photo that is not there, even with the origin on an edge', () => {
    const r = settledViewport('left', 'free', { style: 'parallax', intensity: 'strong' }, { x: 1, y: 1 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });

  it('gets tighter the nearer the layer, exactly as the parallax does', () => {
    const w = (layer: 'background' | 'slot' | 'free') =>
      settledViewport('in', layer, DEFAULT_AMBIENT).w;
    expect(w('background')).toBeGreaterThan(w('slot'));
    expect(w('slot')).toBeGreaterThan(w('free'));
  });
});

describe('settledBounds', () => {
  it('grows the box symmetrically about a centred focal point', () => {
    // parallax/medium on a free overlay: depth 1.5 → s = 1.225.
    const b = settledBounds('in', 'free', DEFAULT_AMBIENT);
    expect(b.w).toBeCloseTo(1.225, 6);
    expect(b.x).toBeCloseTo(-(1.225 - 1) / 2, 6);
    expect(b.y).toBeCloseTo(-(1.225 - 1) / 2, 6);
  });

  it('pins the corner the focal point sits on', () => {
    const b = settledBounds('in', 'free', DEFAULT_AMBIENT, { x: 0, y: 0 });
    expect(b.x).toBeCloseTo(0, 10);
    expect(b.y).toBeCloseTo(0, 10);
  });

  it('is the exact inverse of settledViewport — the visible window maps to the box', () => {
    const focal = { x: 0.3, y: 0.65 };
    const v = settledViewport('up', 'slot', { style: 'parallax', intensity: 'strong' }, focal);
    const { scale: s, dx, dy } = ambientEndState('up', 'slot', { style: 'parallax', intensity: 'strong' });
    const fwd = (p: number, o: number, d: number) => o + s * (p - o + d);
    expect(fwd(v.x, focal.x, dx)).toBeCloseTo(0, 6);
    expect(fwd(v.x + v.w, focal.x, dx)).toBeCloseTo(1, 6);
    expect(fwd(v.y, focal.y, dy)).toBeCloseTo(0, 6);
    expect(fwd(v.y + v.h, focal.y, dy)).toBeCloseTo(1, 6);
  });

  it('leaves the box alone when there is nothing to settle into', () => {
    expect(settledBounds('none', 'free', DEFAULT_AMBIENT)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(settledBounds('out', 'free', DEFAULT_AMBIENT)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('hasSettledShift', () => {
  it('is true only when the ending framing differs from the resting one', () => {
    expect(hasSettledShift('in', 'slot', DEFAULT_AMBIENT)).toBe(true);
    expect(hasSettledShift('right', 'background', DEFAULT_AMBIENT)).toBe(true);
    expect(hasSettledShift('out', 'slot', DEFAULT_AMBIENT)).toBe(false);
    expect(hasSettledShift('none', 'slot', DEFAULT_AMBIENT)).toBe(false);
    expect(hasSettledShift('in', 'slot', { style: 'none', intensity: 'medium' })).toBe(false);
  });
});

describe('ambientPhotoCss', () => {
  it('closes on the focal point rather than the middle of the frame', () => {
    const css = ambientPhotoCss('.s .p', 'cb-amb-x', 'in', 'slot', DEFAULT_AMBIENT, { x: 0.2, y: 0.8 });
    expect(css).toContain('transform-origin:20.0% 80.0%');
    expect(css).toContain('@keyframes cb-amb-x');
    expect(css).toContain(`${AMBIENT_SECONDS}s`);
  });

  it('emits nothing for a still photo', () => {
    expect(ambientPhotoCss('.s .p', 'k', 'none', 'slot', DEFAULT_AMBIENT)).toBe('');
  });

  it('names its keyframes cb-amb-*, which is what the exporter holds instead of cancelling', () => {
    // The video capture cancels every animation for the hold frame EXCEPT these
    // — otherwise a push-in would snap back to its start for the last 1.4s.
    const css = ambientPhotoCss('.s .p', 'cb-amb-bg', 'in', 'background', DEFAULT_AMBIENT);
    expect(css).toMatch(/@keyframes cb-amb-/);
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

  it('is scoped to the render instance so slides on one page do not collide', () => {
    expect(ambientArtCss('cbs1', DEFAULT_AMBIENT)).toContain('.cbs1 .cb-slide');
  });

  it('stays silent for a brand that opted out', () => {
    expect(ambientArtCss('cbs1', { style: 'none', intensity: 'subtle' })).toBe('');
  });
});
