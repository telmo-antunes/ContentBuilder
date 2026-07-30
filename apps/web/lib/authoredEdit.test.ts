import { describe, it, expect } from 'vitest';
import { buildAuthored, type AuthoredEl } from './authoredEdit';

// parseAuthored needs DOMParser (browser) — it's verified in-browser. buildAuthored
// is pure, and is the round-trip-critical half (edited elements → authored HTML).

const text = (over: Partial<AuthoredEl>): AuthoredEl => ({
  key: 'k',
  tag: 'p',
  className: 'body',
  kind: 'text',
  text: '',
  label: 'Body',
  ...over,
});

describe('buildAuthored', () => {
  it('rebuilds a simple text element with its recipe class', () => {
    expect(buildAuthored([text({ tag: 'h1', className: 'headline', text: 'Recovery beats grit' })])).toBe(
      '<h1 class="headline">Recovery beats grit</h1>',
    );
  });

  it('wraps the emphasis phrase in its signature span, keeping the rest as text', () => {
    const out = buildAuthored([
      text({ tag: 'h1', className: 'headline', text: 'Run your shop on autopilot.', emphasis: 'on autopilot.', emphClass: 'it' }),
    ]);
    expect(out).toBe('<h1 class="headline">Run your shop <span class="it">on autopilot.</span></h1>');
  });

  it('defaults the emphasis span class to "em" when none was captured', () => {
    const out = buildAuthored([text({ text: 'fall to your systems', emphasis: 'systems' })]);
    expect(out).toContain('<span class="em">systems</span>');
  });

  it('drops the emphasis wrapping when the phrase is no longer in the text', () => {
    const out = buildAuthored([text({ text: 'edited copy', emphasis: 'old phrase' })]);
    expect(out).toBe('<p class="body">edited copy</p>');
  });

  it('HTML-escapes text and emphasis (no markup injection)', () => {
    const out = buildAuthored([text({ text: 'a <b>bold</b> & "quoted" move' })]);
    expect(out).toBe('<p class="body">a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; move</p>');
  });

  it('re-emits structural elements verbatim and preserves order', () => {
    const els: AuthoredEl[] = [
      { key: 'a', tag: 'div', className: 'logo', kind: 'structural', text: '', raw: '<div class="logo"></div>', label: 'Logo' },
      text({ key: 'b', tag: 'p', className: 'eyebrow', text: 'Mindset' }),
    ];
    expect(buildAuthored(els)).toBe('<div class="logo"></div><p class="eyebrow">Mindset</p>');
    expect(buildAuthored([els[1]!, els[0]!])).toBe('<p class="eyebrow">Mindset</p><div class="logo"></div>');
  });

  it('falls back to a <p> when the tag is not a safe element name', () => {
    expect(buildAuthored([text({ tag: 'script', text: 'x' })])).toBe('<p class="body">x</p>');
  });
});

/**
 * `buildAuthored` is the round-trip-critical half: whatever it emits is what
 * gets sanitised, stored and rendered. `parseAuthored` needs a real DOM and is
 * verified in the browser (no jsdom in this project, and it is not worth a
 * dependency to duplicate a check the app itself performs).
 */
describe('designed line breaks survive a save', () => {
  it('re-emits a newline as <br> instead of welding the words together', () => {
    // The failure this fixes: a headline authored as
    // "…shift the moment<br><span>a pack is sold.</span>" was read back with
    // textContent, which drops <br>, producing "…momenta pack is sold." —
    // shown to the user that way and re-saved without the break.
    const out = buildAuthored([
      text({ tag: 'div', className: 'headline sm', text: 'Three things that shift the moment\na pack is sold.' }),
    ]);
    expect(out).toContain('shift the moment<br>a pack is sold.');
    expect(out).not.toContain('momenta');
  });

  it('keeps the break when an accent phrase is re-applied around it', () => {
    const out = buildAuthored([
      text({
        tag: 'div',
        className: 'headline sm',
        text: 'Three things that shift the moment\na pack is sold.',
        emphasis: 'a pack is sold.',
        emphClass: 'break',
      }),
    ]);
    expect(out).toBe(
      '<div class="headline sm">Three things that shift the moment<br><span class="break">a pack is sold.</span></div>',
    );
  });

  it('still escapes markup in copy that contains a newline', () => {
    const out = buildAuthored([text({ tag: 'p', className: 'body', text: 'a < b\n<script>' })]);
    expect(out).toContain('a &lt; b<br>&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
});

describe('enumerations rebuild into the brand’s own row markup', () => {
  const list = (rows: Array<{ text: string; note?: string }>): AuthoredEl => ({
    key: 'L',
    tag: 'div',
    className: 'panel',
    kind: 'list',
    text: '',
    label: 'Panel',
    rows: rows.map((r, i) => ({ key: `r${i}`, ...r })),
    rowShape: {
      tag: 'div',
      className: 'row',
      marker: '<span class="tick"></span>',
      noteTag: 'em',
      noteClass: '',
    },
  });

  it('emits one row per item, marker and note included', () => {
    const out = buildAuthored([
      list([
        { text: 'Income arrives before any work is done.', note: 'Cash in the bank before the first wash.' },
        { text: 'The client returns — not compares.', note: 'Loyalty without a loyalty programme.' },
      ]),
    ]);
    expect(out.startsWith('<div class="panel">')).toBe(true);
    expect(out.match(/<div class="row">/g)).toHaveLength(2);
    expect(out).toContain('<span class="tick"></span>Income arrives before any work is done.');
    expect(out).toContain('<em>Cash in the bank before the first wash.</em>');
  });

  it('omits the note element for a row that has none', () => {
    const out = buildAuthored([list([{ text: 'Just the item.' }])]);
    expect(out).toContain('Just the item.');
    expect(out).not.toContain('<em>');
  });

  it('drops a row emptied by the editor rather than shipping a blank line', () => {
    const out = buildAuthored([list([{ text: '' }, { text: 'Kept.' }])]);
    expect(out.match(/<div class="row">/g)).toHaveLength(1);
    expect(out).toContain('Kept.');
  });

  it('escapes row copy, and honours a line break inside an item', () => {
    const out = buildAuthored([list([{ text: 'a & b\nsecond', note: '<em>x' }])]);
    expect(out).toContain('a &amp; b<br>second');
    expect(out).toContain('&lt;em&gt;x');
  });

  it('falls back to safe tags if the shape names something unexpected', () => {
    const el = list([{ text: 'x', note: 'y' }]);
    el.rowShape!.tag = 'marquee';
    el.rowShape!.noteTag = 'blink';
    const out = buildAuthored([el]);
    expect(out).toContain('<div class="row">');
    expect(out).toContain('<em>y</em>');
    expect(out).not.toContain('marquee');
  });
});
