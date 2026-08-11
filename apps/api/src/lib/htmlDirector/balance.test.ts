import { describe, expect, it } from 'vitest';
import { balanceVertical } from './balance';
import { topLevelBlocks } from './dedupeBlocks';

const classesOf = (html: string) => topLevelBlocks(html).map((b) => b.classes.join('.') || b.tag);

describe('balanceVertical', () => {
  it('moves a stranded trailing spacer up behind the eyebrow', () => {
    // The exact shape a `feature` fragment leaves behind once its photo slot is
    // dropped: everything piled under the top edge, the slack below the copy.
    const out = balanceVertical(
      `<div class="eyebrow">Signs of wear</div>
<div class="headline sm">Two things change</div>
<div class="rule"></div>
<div class="body">Beads flatten before they stop sheeting.</div>
<div class="fill"></div>`,
    );
    expect(out.moved).toBe('anchored');
    expect(classesOf(out.html)).toEqual(['eyebrow', 'fill', 'headline.sm', 'rule', 'body']);
  });

  it('pins the whole brand mark, not just the last of it', () => {
    const out = balanceVertical(
      `<div class="logo-row"><div class="monogram"></div></div>
<div class="eyebrow">Your next step</div>
<div class="headline">Book an assessment</div>
<div class="fill"></div>`,
    );
    expect(classesOf(out.html)).toEqual(['logo-row', 'eyebrow', 'fill', 'headline']);
  });

  it('leaves a deliberate mid-composition anchor exactly where it is', () => {
    const html = `<div class="eyebrow">A</div>
<div class="fill"></div>
<div class="headline">B</div>
<div class="body">C</div>`;
    expect(balanceVertical(html)).toEqual({ html });
  });

  it('leaves a centring pair alone', () => {
    const html = `<div class="fill"></div>
<div class="quote">A pulled line</div>
<div class="attr">Someone</div>
<div class="fill"></div>`;
    expect(balanceVertical(html)).toEqual({ html });
  });

  it('does nothing when there is no top-edge label to pin', () => {
    // No logo, no eyebrow: the copy already starts at the top, and a leading
    // spacer would only swap a void at the bottom for one at the top.
    const html = `<div class="headline">A statement</div>
<div class="rule"></div>
<div class="body">And its support.</div>
<div class="fill"></div>`;
    expect(balanceVertical(html)).toEqual({ html });
  });

  it('does nothing to a slide with no spacer at all', () => {
    const html = `<div class="eyebrow">A</div>\n<div class="headline">B</div>\n<div class="body">C</div>`;
    expect(balanceVertical(html)).toEqual({ html });
  });

  it('does nothing to a crowded slide — there is no slack to move', () => {
    const html = `<div class="logo-row"><div class="monogram"></div></div>
<div class="eyebrow">A</div>
<div class="headline">B</div>
<div class="rule"></div>
<div class="body">C</div>
<div class="panel"><div class="row">1</div></div>
<div class="fill"></div>`;
    expect(balanceVertical(html)).toEqual({ html });
  });

  it('does nothing when the slide is only labels and a spacer', () => {
    const html = `<div class="eyebrow">A</div>\n<div class="logo-row">B</div>\n<div class="fill"></div>`;
    expect(balanceVertical(html)).toEqual({ html });
  });

  it('collapses several trailing spacers into the one anchor', () => {
    const out = balanceVertical(
      `<div class="eyebrow">A</div>
<div class="headline">B</div>
<div class="body">C</div>
<div class="fill"></div>
<div class="fill"></div>`,
    );
    expect(classesOf(out.html)).toEqual(['eyebrow', 'fill', 'headline', 'body']);
  });

  it('keeps the markup byte-identical when it changes nothing', () => {
    const html = `<div class="eyebrow">A</div>\n<div class="fill"></div>\n<div class="headline">B</div>`;
    const out = balanceVertical(html);
    expect(out.html).toBe(html);
    expect(out.moved).toBeUndefined();
  });
});

describe('balanceVertical — the dangling tail', () => {
  it('drops a rule that separates nothing', () => {
    const out = balanceVertical(
      `<div class="eyebrow">Free diagnostic</div>
<div class="fill"></div>
<div class="headline sm">Read the water, not the calendar</div>
<div class="rule"></div>`,
    );
    expect(out.moved).toBe('trimmed');
    expect(classesOf(out.html)).toEqual(['eyebrow', 'fill', 'headline.sm']);
  });

  it('keeps a rule that is actually separating something', () => {
    const html = `<div class="headline">A</div>\n<div class="rule"></div>\n<div class="body">B</div>`;
    expect(balanceVertical(html)).toEqual({ html });
  });

  it('trims the tail and then re-anchors what the trim stranded', () => {
    const out = balanceVertical(
      `<div class="eyebrow">A</div>
<div class="headline">B</div>
<div class="body">C</div>
<div class="rule"></div>
<div class="fill"></div>`,
    );
    expect(out.moved).toBe('anchored+trimmed');
    expect(classesOf(out.html)).toEqual(['eyebrow', 'fill', 'headline', 'body']);
  });
});
