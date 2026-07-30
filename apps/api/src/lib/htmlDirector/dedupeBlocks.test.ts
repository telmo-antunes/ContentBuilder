import { describe, it, expect } from 'vitest';
import { SLOT_ATTR, SLOT_CLASS } from '@contentbuilder/shared';
import { dedupeBlocks, pruneSlideMarkup, stripEmptyInline, topLevelBlocks } from './dedupeBlocks';

/**
 * The real observed failure: project "Prepaid packages — get paid up front",
 * slide 7. The same four sentences arrived twice — once as a `.body` paragraph,
 * once as a `.panel` of `.row`s — so the slide held double the copy its box
 * allows and the two collided. Note the empty `<em></em>` note stubs.
 */
const REAL_DUPLICATED = `<div class="headline sm">Four things that change <span class="it">how you run your shop.</span></div>
<div class="rule"></div>
<div class="body">Cash in the bank before the work begins. Repeat visits secured in advance. Slow weeks funded ahead of time. Clients who are not comparing your price with anyone else.</div>
<div class="fill"></div>
<div class="panel">
  <div class="row"><span class="tick"></span>Cash in the bank before the work begins.<em></em></div>
  <div class="row"><span class="tick"></span>Repeat visits secured in advance.<em></em></div>
  <div class="row"><span class="tick"></span>Slow weeks funded ahead of time.<em></em></div>
  <div class="row"><span class="tick"></span>Clients who are not comparing your price with anyone else.<em></em></div>
</div>`;

describe('topLevelBlocks', () => {
  it('returns whole top-level elements, nesting and all', () => {
    const blocks = topLevelBlocks(REAL_DUPLICATED);
    expect(blocks.map((b) => b.label)).toEqual([
      'div.headline.sm',
      'div.rule',
      'div.body',
      'div.fill',
      'div.panel',
    ]);
  });

  it('scores a panel of rows as more structured than a flat paragraph', () => {
    const blocks = topLevelBlocks(REAL_DUPLICATED);
    const body = blocks.find((b) => b.classes.includes('body'))!;
    const panel = blocks.find((b) => b.classes.includes('panel'))!;
    expect(body.structure).toBe(0);
    expect(panel.structure).toBe(4);
  });

  it('is not confused by void elements', () => {
    const blocks = topLevelBlocks('<div class="headline">One<br>Two</div><div class="rule"></div>');
    expect(blocks.map((b) => b.label)).toEqual(['div.headline', 'div.rule']);
  });
});

describe('dedupeBlocks — Guard A', () => {
  it('drops the duplicated paragraph and keeps the panel (the real case)', () => {
    const out = dedupeBlocks(REAL_DUPLICATED);
    expect(out.html).not.toContain('class="body"');
    expect(out.html).toContain('class="panel"');
    expect(out.html).toContain('Slow weeks funded ahead of time.');
    // the headline, its signature span, the rule and the spacer all survive
    expect(out.html).toContain('<span class="it">how you run your shop.</span>');
    expect(out.html).toContain('<div class="rule"></div>');
    expect(out.html).toContain('<div class="fill"></div>');
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]).toMatchObject({ label: 'div.body', keptLabel: 'div.panel' });
    // no blank line left behind where the paragraph was
    expect(out.html).not.toMatch(/\n\s*\n/);
  });

  it('returns a slide with no duplication byte-identical', () => {
    const clean = `<div class="eyebrow">The long game</div>
<div class="headline">Get paid before you <span class="it">lift a finger.</span></div>
<div class="rule"></div>
<div class="body">Prepaid packages put the money in the bank while the diary fills itself.</div>
<div class="fill"></div>
<div class="cta">See how it works</div>`;
    const out = dedupeBlocks(clean);
    expect(out.html).toBe(clean);
    expect(out.dropped).toEqual([]);
  });

  it('leaves an eyebrow that echoes a short phrase from the headline alone', () => {
    const html = `<div class="eyebrow">Get paid up front</div>
<div class="headline">Get paid up front, before a single wheel is touched.</div>`;
    const out = dedupeBlocks(html);
    expect(out.html).toBe(html);
    expect(out.dropped).toEqual([]);
  });

  it('drops a paragraph whose copy is wholly contained in a panel written above it', () => {
    // Containment the other way round in the document: the structured block
    // comes FIRST, and the paragraph repeats only some of its rows.
    const html = `<div class="panel">
  <div class="row">Cash in the bank before the work begins.</div>
  <div class="row">Repeat visits secured in advance.</div>
  <div class="row">Slow weeks funded ahead of time.</div>
</div>
<div class="body">Cash in the bank before the work begins. Repeat visits secured in advance.</div>`;
    const out = dedupeBlocks(html);
    expect(out.html).not.toContain('class="body"');
    expect(out.html).toContain('Slow weeks funded ahead of time.');
    expect(out.dropped[0]).toMatchObject({ label: 'div.body', keptLabel: 'div.panel' });
  });

  it('keeps the paragraph when IT is the richer / only full expression', () => {
    // The panel restates part of the paragraph, but the paragraph carries copy
    // the panel does not — dropping it would lose words, so nothing goes.
    const html = `<div class="body">Cash in the bank before the work begins. Repeat visits secured in advance. And the slow weeks are funded months ahead.</div>
<div class="panel">
  <div class="row">Repeat visits secured in advance.</div>
</div>`;
    const out = dedupeBlocks(html);
    expect(out.html).toBe(html);
    expect(out.dropped).toEqual([]);
  });

  it('never drops a headline in favour of a body, whichever comes first', () => {
    const line = 'Cash in the bank before the work begins.';
    for (const html of [
      `<div class="headline">${line}</div>\n<div class="body">${line}</div>`,
      `<div class="body">${line}</div>\n<div class="headline">${line}</div>`,
    ]) {
      const out = dedupeBlocks(html);
      expect(out.html).toContain(`<div class="headline">${line}</div>`);
      expect(out.html).not.toContain('class="body"');
    }
  });

  it('leaves quotes, taglines, CTAs and statements alone even when they repeat', () => {
    // Nothing here is a plain prose block, so the guard has no candidate loser.
    const line = 'You do not rise to your goals, you fall to your systems.';
    const html = `<div class="quote">${line}</div>\n<div class="tagline">${line}</div>`;
    expect(dedupeBlocks(html).html).toBe(html);
  });

  it('drops a classless duplicate paragraph too', () => {
    const html = `<div class="panel">
  <div class="row">Repeat visits secured in advance.</div>
  <div class="row">Slow weeks funded ahead of time.</div>
</div>
<p>Repeat visits secured in advance. Slow weeks funded ahead of time.</p>`;
    const out = dedupeBlocks(html);
    expect(out.html).not.toContain('<p>');
    expect(out.dropped[0]).toMatchObject({ label: 'p', keptLabel: 'div.panel' });
  });

  it('collapses two spacers left adjacent by a removal', () => {
    const html = `<div class="headline">Four things that change how you run your shop.</div>
<div class="fill"></div>
<div class="body">Repeat visits secured in advance. Slow weeks funded ahead of time.</div>
<div class="fill"></div>
<div class="panel">
  <div class="row">Repeat visits secured in advance.</div>
  <div class="row">Slow weeks funded ahead of time.</div>
</div>`;
    const out = dedupeBlocks(html);
    expect(out.html.match(/class="fill"/g)).toHaveLength(1);
    expect(out.dropped.map((d) => d.label)).toEqual(['div.body', 'div.fill']);
    expect(out.dropped[1]!.spacer).toBe(true);
  });

  it('leaves spacers that were already adjacent before the removal', () => {
    const html = `<div class="fill"></div>
<div class="fill"></div>
<div class="body">Repeat visits secured in advance. Slow weeks funded ahead of time.</div>
<div class="panel">
  <div class="row">Repeat visits secured in advance.</div>
  <div class="row">Slow weeks funded ahead of time.</div>
</div>`;
    const out = dedupeBlocks(html);
    expect(out.html.match(/class="fill"/g)).toHaveLength(2);
    expect(out.dropped.map((d) => d.label)).toEqual(['div.body']);
  });

  it('matches copy across a trailing full stop and an emphasis span', () => {
    const html = `<div class="panel">
  <div class="row">Repeat visits <span class="it">secured in advance</span></div>
</div>
<div class="body">Repeat visits secured in advance.</div>`;
    expect(dedupeBlocks(html).dropped).toHaveLength(1);
  });
});

describe('stripEmptyInline — Guard B', () => {
  it('removes empty and whitespace-only inline stubs', () => {
    const out = stripEmptyInline('<div class="row">Done<em></em><b> </b><span>&nbsp;</span></div>');
    expect(out.html).toBe('<div class="row">Done</div>');
    expect(out.stripped).toBe(3);
  });

  it('collapses a nested stub in one pass set', () => {
    const out = stripEmptyInline('<div class="row">Done<span><em></em></span></div>');
    expect(out.html).toBe('<div class="row">Done</div>');
    expect(out.stripped).toBe(2);
  });

  it('keeps decorative elements that are empty BY DESIGN', () => {
    // Everything legitimately empty in the reference recipes carries a class or
    // a slot attribute: the tick glyph, the rule, the spacer, the monogram, the
    // logo, and the photo slot the user fills.
    const html =
      `<div class="logo"></div><div class="monogram"></div><div class="rule"></div><div class="fill"></div>` +
      `<div class="row"><span class="tick"></span>Cash in the bank.</div>` +
      `<figure class="${SLOT_CLASS} tall" ${SLOT_ATTR}="hero"></figure>`;
    const out = stripEmptyInline(html);
    expect(out.html).toBe(html);
    expect(out.stripped).toBe(0);
  });

  it('keeps inline elements that carry a class or any attribute', () => {
    const html = '<div class="quote">Rise<span class="em"></span><em data-x="1"></em></div>';
    expect(stripEmptyInline(html).html).toBe(html);
  });

  it('keeps inline elements that have content', () => {
    const html = '<div class="wordmark"><b>detail</b><i>masters</i></div>';
    expect(stripEmptyInline(html).html).toBe(html);
  });
});

describe('pruneSlideMarkup — both guards', () => {
  it('cleans the real slide: paragraph dropped, panel kept, note stubs stripped', () => {
    const out = pruneSlideMarkup(REAL_DUPLICATED);
    expect(out.html).not.toContain('class="body"');
    expect(out.html).not.toContain('<em></em>');
    expect(out.html).toContain('<span class="tick"></span>Cash in the bank before the work begins.</div>');
    expect(out.dropped.map((d) => d.label)).toEqual(['div.body']);
    expect(out.strippedInline).toBe(4);
  });

  it('is a no-op on a clean slide and on an empty fragment', () => {
    const clean = `<div class="eyebrow">The long game</div>
<div class="headline">Small habits, <span class="it">unshakable results.</span></div>
<figure class="${SLOT_CLASS}" ${SLOT_ATTR}="hero"></figure>`;
    expect(pruneSlideMarkup(clean)).toEqual({ html: clean, dropped: [], strippedInline: 0 });
    expect(pruneSlideMarkup('')).toEqual({ html: '', dropped: [], strippedInline: 0 });
  });
});
