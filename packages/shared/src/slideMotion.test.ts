import { describe, expect, it } from 'vitest';
import {
  AMBIENT_SECONDS,
  DEFAULT_AMBIENT,
  ambientArtCss,
  ambientPhotoCss,
  ambientTransforms,
  resolveMove,
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
