import { describe, expect, it } from 'vitest';
import { authoredShape, partsFromAuthored, rewriteAuthoredCopy } from './reparse';

/** A real composed list slide, with a detail on every row. */
const LIST = `<div class="eyebrow">What cuts life short</div>
<div class="headline sm">Five habits that wear a <span class="it">coating fast</span></div>
<div class="fill"></div>
<div class="panel">
  <div class="row">Brush car washes<span class="sm">Abrade the coating and clear coat.</span></div>
  <div class="row">Washing in direct sun<span class="sm">Or letting the car air-dry.</span></div>
  <div class="row">Bird drops and sap left to sit</div>
</div>
<div class="handle">detailmasters.pro</div>`;

describe('authoredShape', () => {
  it('reports what the arrangement can carry, and how many rows there is room for', () => {
    expect(authoredShape(LIST)).toEqual({ parts: ['eyebrow', 'headline', 'handle'], rows: 3 });
  });

  it('is empty for markup with no copy in it', () => {
    expect(authoredShape('<div class="fill"></div>')).toEqual({ parts: [], rows: 0 });
  });
});

describe('rewriteAuthoredCopy', () => {
  it('replaces the words and leaves every element, class and spacer where it was', () => {
    const out = rewriteAuthoredCopy(LIST, {
      eyebrow: 'What kills coatings',
      headline: 'Five habits that end a coating early',
      rows: [
        { text: 'Automatic brush washes', note: 'They grind grit into the clear coat.' },
        { text: 'Washing in full sun', note: 'Or leaving it to air-dry.' },
        { text: 'Sap and droppings left to dwell' },
      ],
    });
    expect(out.html).toContain('<div class="eyebrow">What kills coatings</div>');
    expect(out.html).toContain('Five habits that end a coating early');
    expect(out.html).toContain('<div class="fill"></div>');
    expect(out.html).toContain('class="headline sm"');
    expect(out.html).toContain('Automatic brush washes');
    expect(out.html).toContain('They grind grit into the clear coat.');
    // the row that had no detail still has none
    expect(out.html).toContain('<div class="row">Sap and droppings left to dwell</div>');
    // …and the same number of rows as before
    expect(out.html.match(/class="row"/g)).toHaveLength(3);
  });

  it('drops a row element it has nothing left to put in', () => {
    const out = rewriteAuthoredCopy(LIST, { rows: [{ text: 'Only one thing now' }] });
    expect(out.html.match(/class="row"/g)).toHaveLength(1);
    expect(out.html).toContain('Only one thing now');
  });

  it('ignores a surplus item rather than inventing markup for it', () => {
    const out = rewriteAuthoredCopy(LIST, {
      rows: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }, { text: 'Four' }],
    });
    expect(out.html.match(/class="row"/g)).toHaveLength(3);
    expect(out.html).not.toContain('Four');
  });

  it('leaves the handle alone — it is the brand’s, not the copywriter’s', () => {
    const out = rewriteAuthoredCopy(LIST, { handle: 'a whole sentence about something' });
    expect(out.html).toContain('detailmasters.pro');
  });

  it('escapes the new copy, so a rewrite cannot smuggle markup in', () => {
    const out = rewriteAuthoredCopy('<div class="headline">old</div>', {
      headline: '<img src=x onerror=alert(1)> & "quoted"',
    });
    expect(out.html).toBe(
      '<div class="headline">&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;</div>',
    );
  });

  it('round-trips: what it wrote is what reads back out', () => {
    const next = { eyebrow: 'A kicker', headline: 'A whole new line', rows: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }] };
    const out = rewriteAuthoredCopy(LIST, next);
    const back = partsFromAuthored(out.html);
    expect(back.eyebrow).toBe('A kicker');
    expect(back.headline).toBe('A whole new line');
  });
});
