import { describe, expect, it } from 'vitest';
import {
  isStepDurations, isStepList, parseStepList, presenceAt, restStep, sceneSteps, sceneTotalMs, springStep,
  SCENE_EXIT_MS,
} from './scenes';

describe('scene markup', () => {
  it('reads the durations a fragment declares, and null for a plain slide', () => {
    expect(sceneSteps('<div data-cb-steps="2.8 2.4 2.6"><p>x</p></div>')).toEqual([2.8, 2.4, 2.6]);
    expect(sceneSteps('<div class="headline">x</div>')).toBeNull();
    expect(sceneTotalMs([2.8, 2.4, 2.6])).toBe(7800);
    expect(restStep([2.8, 2.4, 2.6])).toBe(2);
  });

  it('validates the way the sanitiser needs — both values end up in selectors', () => {
    expect(isStepList('0 1')).toBe(true);
    expect(isStepList('11')).toBe(true);
    expect(isStepList('0,1')).toBe(false);
    expect(isStepList('12')).toBe(false);
    expect(isStepList('a')).toBe(false);
    expect(parseStepList('1 0 1')).toEqual([0, 1]);
    expect(isStepDurations('2.8 2.4')).toBe(true);
    expect(isStepDurations('0.1')).toBe(false);     // too short to read
    expect(isStepDurations('30')).toBe(false);      // not a slide any more
    expect(isStepDurations('1 '.repeat(13).trim())).toBe(false);
  });
});

describe('presence is a pure function of time', () => {
  const d = [1, 1, 1]; // three one-second steps

  it('an element in step 0 is there from the start and gone 120 ms after step 1 begins', () => {
    expect(presenceAt(0, d, [0]).opacity).toBe(0);
    expect(presenceAt(600, d, [0]).opacity).toBeGreaterThan(0.95);
    expect(presenceAt(1000, d, [0]).opacity).toBeGreaterThan(0.95); // the boundary frame still shows it
    expect(presenceAt(1000 + SCENE_EXIT_MS, d, [0]).opacity).toBe(0);
  });

  it('contiguous steps merge — no leave-and-return at the boundary', () => {
    const o = presenceAt(1000 + 30, d, [0, 1]).opacity;
    expect(o).toBeGreaterThan(0.95);
  });

  it('the last step holds past the end, which is the settled frame', () => {
    expect(presenceAt(2900, d, [2]).opacity).toBeGreaterThan(0.95);
    expect(presenceAt(99999, d, [2]).opacity).toBeGreaterThan(0.95);
    expect(presenceAt(99999, d, [1]).opacity).toBe(0);
  });

  it('is deterministic: asking out of order gives the same answers', () => {
    const a = presenceAt(1500, d, [1]), b = presenceAt(200, d, [1]), c = presenceAt(1500, d, [1]);
    expect(a).toEqual(c);
    expect(b.opacity).toBe(0);
  });

  it('the spring overshoots by at most 3%, as the brief requires', () => {
    let max = 0;
    for (let x = 0; x < 2; x += 0.005) max = Math.max(max, springStep(x, 0.45, 0.86));
    expect(max).toBeLessThan(1.03);
  });
});
