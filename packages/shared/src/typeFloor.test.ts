import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_FLOOR_PX,
  TYPE_FLOOR_PX,
  enforceTypeFloor,
  pxForPt,
  typeFloorReport, enforceMeasureFloor, MEASURE_FLOOR_CH } from './typeFloor';

const sizeOf = (css: string, cls: string) =>
  Number(css.match(new RegExp(`\\.${cls}\\{[^}]*font-size:\\s*([\\d.]+)px`))![1]);

describe('the phone conversion', () => {
  it('turns a target point size into canvas pixels', () => {
    // 16pt on a phone is 44px on a 1080 canvas — the ratio that made a 30px
    // body (11pt) look reasonable to author and unreadable to read.
    expect(pxForPt(16)).toBe(44);
    expect(pxForPt(12.4)).toBe(ABSOLUTE_FLOOR_PX);
  });
});

describe('enforceTypeFloor', () => {
  it('raises the sizes that were actually shipping too small', () => {
    // These are the real values measured off the seeded brands.
    const css = '.cb-slide .body{font-size:33px}.cb-slide .cta{font-size:32px}.cb-slide .eyebrow{font-size:25px}';
    const out = enforceTypeFloor(css);
    expect(sizeOf(out, 'body')).toBe(TYPE_FLOOR_PX.body);
    expect(sizeOf(out, 'cta')).toBe(TYPE_FLOOR_PX.cta);
    expect(sizeOf(out, 'eyebrow')).toBe(TYPE_FLOOR_PX.eyebrow);
  });

  it('leaves type that was already big enough completely alone', () => {
    const css = '.cb-slide .headline{font-size:112px}.cb-slide .stat{font-size:200px}';
    expect(enforceTypeFloor(css)).toBe(css);
  });

  it('never SHRINKS anything — it is a floor, not a size', () => {
    const css = '.cb-slide .body{font-size:72px}';
    expect(sizeOf(enforceTypeFloor(css), 'body')).toBe(72);
  });

  it('catches a class the vocabulary never defined', () => {
    // A brand can invent `.kicker`; the absolute floor still applies.
    const out = enforceTypeFloor('.cb-slide .kicker{font-size:18px}');
    expect(Number(out.match(/font-size:\s*([\d.]+)px/)![1])).toBe(ABSOLUTE_FLOOR_PX);
  });

  it('matches the class as a whole word', () => {
    // `.attr` must not claim `.attribution`, or the wrong floor is applied.
    const out = enforceTypeFloor('.cb-slide .attribution{font-size:20px}');
    expect(Number(out.match(/font-size:\s*([\d.]+)px/)![1])).toBe(ABSOLUTE_FLOOR_PX);
  });

  it('picks the role floor over the absolute one', () => {
    expect(TYPE_FLOOR_PX.body).toBeGreaterThan(ABSOLUTE_FLOOR_PX);
    expect(sizeOf(enforceTypeFloor('.cb-slide .body{font-size:20px}'), 'body')).toBe(TYPE_FLOOR_PX.body);
  });

  it('leaves relative units alone rather than guessing what they resolve to', () => {
    const css = '.cb-slide .body em{font-size:0.8em}.cb-slide .x{font-size:clamp(20px,3vw,40px)}';
    expect(enforceTypeFloor(css)).toBe(css);
  });

  it('preserves the rest of a rule it does touch', () => {
    const out = enforceTypeFloor('.cb-slide .body{color:red;font-size:30px;line-height:1.4}');
    expect(out).toContain('color:red');
    expect(out).toContain('line-height:1.4');
  });

  it('handles an empty or absent stylesheet', () => {
    expect(enforceTypeFloor('')).toBe('');
  });

  it('keeps the call to action from being among the smallest things on a slide', () => {
    // The original failure: .cta at 32px = 11.6pt, smaller than the body copy
    // it was meant to convert.
    const out = enforceTypeFloor('.cb-slide .body{font-size:44px}.cb-slide .cta{font-size:32px}');
    expect(sizeOf(out, 'cta')).toBeGreaterThanOrEqual(sizeOf(out, 'body'));
  });
});

describe('typeFloorReport', () => {
  it('says what would change, without changing it', () => {
    const r = typeFloorReport('.cb-slide .body{font-size:33px}.cb-slide .headline{font-size:112px}');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ role: 'body', from: 33, to: TYPE_FLOOR_PX.body });
  });
});

describe('enforceMeasureFloor', () => {
  /**
   * The real value that shipped: a third of every slide's width unused, copy
   * wrapping at ~31 characters.
   */
  it('opens up a cramped reading measure', () => {
    const out = enforceMeasureFloor('.cb-slide .body{ font-size:38px; max-width:26ch }');
    expect(out).toContain(`max-width:${MEASURE_FLOOR_CH}ch`);
  });

  it('leaves a generous measure exactly as authored', () => {
    const css = '.cb-slide .body{ max-width:48ch }';
    expect(enforceMeasureFloor(css)).toBe(css);
  });

  /**
   * A display line held to a narrow column is a legitimate design decision.
   * Widening it would be overruling the brand on something it got right.
   */
  it.each(['tagline', 'headline', 'quote', 'stat'])('never touches display copy: %s', (cls) => {
    const css = `.cb-slide .${cls}{ max-width:22ch }`;
    expect(enforceMeasureFloor(css)).toBe(css);
  });

  it('floors list rows, which are read the same way prose is', () => {
    const out = enforceMeasureFloor('.cb-slide .row{ max-width:20ch }');
    expect(out).toContain(`max-width:${MEASURE_FLOOR_CH}ch`);
  });

  it('ignores a measure expressed in anything but ch', () => {
    const css = '.cb-slide .body{ max-width:400px }';
    expect(enforceMeasureFloor(css)).toBe(css);
  });

  it('leaves every other declaration in the rule untouched', () => {
    const out = enforceMeasureFloor('.cb-slide .body{ color:red; max-width:26ch; line-height:1.58 }');
    expect(out).toContain('color:red');
    expect(out).toContain('line-height:1.58');
  });

  it('is a no-op on css that declares no measure', () => {
    const css = '.cb-slide .body{ font-size:38px }';
    expect(enforceMeasureFloor(css)).toBe(css);
  });
});
