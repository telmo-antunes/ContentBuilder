import { describe, expect, it } from 'vitest';
import { NBSP, bindDisplayBreaks, bindLineBreaks } from './lineBreaks';

/** Readable assertions — a literal NBSP is invisible in source. */
const show = (s: string) => s.replaceAll(NBSP, '_');

describe('bindLineBreaks', () => {
  /** The two headlines that actually shipped with bad breaks. */
  it('stops a line ending on a preposition', () => {
    // "Have it looked at by / someone who does / this for a living."
    const out = show(bindLineBreaks('Have it looked at by someone who does this for a living.'));
    expect(out).toContain('at_by_someone');
    expect(out).toContain('for_a_living.');
  });

  it('stops a line ending on an article or determiner', () => {
    expect(show(bindLineBreaks('These are what actually shorten a coating’s life.')))
      .toContain('a_coating’s');
  });

  /**
   * The widow that also made a list row 65% taller than its neighbours:
   * "Bird droppings and tree sap left on / paint".
   */
  it('binds a short final word to the one before it', () => {
    expect(show(bindLineBreaks('Bird droppings and tree sap left on paint')))
      .toContain('on_paint');
  });

  it('leaves a long final word free to break', () => {
    const out = show(bindLineBreaks('Reapplying too soon wastes considerable investment'));
    expect(out).not.toContain('wastes_considerable');
  });

  it('never creates an unbreakable run wider than a line', () => {
    const out = bindLineBreaks('Understanding the extraordinarily comprehensive documentation', 24);
    for (const run of out.split(' ')) expect(run.length).toBeLessThanOrEqual(24);
  });

  it('leaves a single word alone', () => {
    expect(bindLineBreaks('Healthy')).toBe('Healthy');
    expect(bindLineBreaks('')).toBe('');
  });

  it('changes only spaces — every character else survives', () => {
    const src = 'Tight beads: healthy. Flat, clinging beads: book an inspection.';
    expect(bindLineBreaks(src).replaceAll(NBSP, ' ')).toBe(src);
  });
});

describe('bindDisplayBreaks', () => {
  it('binds a headline', () => {
    const out = bindDisplayBreaks('<div class="headline">Have it looked at by someone</div>');
    expect(show(out)).toContain('at_by_someone');
  });

  /**
   * Body copy has far more break points, a widow costs less there, and gluing
   * inside long prose is the fastest way to force the overflow this avoids.
   */
  it('leaves body copy alone', () => {
    const body = '<div class="body">Contamination sits on top of the coating.</div>';
    expect(bindDisplayBreaks(body)).toBe(body);
  });

  it('keeps the emphasis wrap exactly where it was', () => {
    const src = '<div class="headline">Read the <span class="it">water, not the calendar</span>.</div>';
    const out = bindDisplayBreaks(src);
    expect(out).toContain('<span class="it">');
    expect(out.replaceAll(NBSP, ' ')).toBe(src);
  });

  it('binds every display element on a slide, and nothing else', () => {
    const src =
      '<div class="eyebrow">Rule of thumb</div>' +
      '<div class="headline">Book an inspection</div>' +
      '<div class="cta">Find a detailer</div>';
    const out = show(bindDisplayBreaks(src));
    expect(out).toContain('an_inspection');
    expect(out).toContain('a_detailer');
    expect(out).toContain('>Rule of thumb<'); // eyebrow is not display copy
  });
});
