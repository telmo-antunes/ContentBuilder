import { describe, expect, it } from 'vitest';
import { copyWidthCss, copyWidthOf, narrowerCopy, widerCopy } from './copyWidth';

const body = (cls = 'body') => `<div class="headline">A line.</div><p class="${cls}">The caption underneath it.</p>`;

describe('the per-slide measure', () => {
  it('steps out from the brand’s own width and back again', () => {
    const start = body();
    expect(copyWidthOf(start)).toBeUndefined();

    const wide = widerCopy(start);
    expect(wide.changed).toBe(true);
    expect(copyWidthOf(wide.html)).toBe('cb-w-wide');

    const full = widerCopy(wide.html);
    expect(copyWidthOf(full.html)).toBe('cb-w-full');

    // …and back down, one step at a time, to the brand's own and past it.
    expect(copyWidthOf(narrowerCopy(full.html).html)).toBe('cb-w-wide');
    expect(copyWidthOf(narrowerCopy(narrowerCopy(full.html).html).html)).toBeUndefined();
    const narrow = narrowerCopy(narrowerCopy(narrowerCopy(full.html).html).html);
    expect(copyWidthOf(narrow.html)).toBe('cb-w-narrow');
  });

  it('stops at both ends rather than pretending it changed something', () => {
    const full = widerCopy(widerCopy(body()).html).html;
    expect(widerCopy(full).changed).toBe(false);
    const narrow = narrowerCopy(body()).html;
    expect(narrowerCopy(narrow).changed).toBe(false);
  });

  it('never carries two width classes at once', () => {
    const twice = widerCopy(widerCopy(body()).html).html;
    expect(twice.match(/cb-w-/g)).toHaveLength(1);
  });

  /**
   * The bug the headline buttons shipped twice: a regex that assumes a class is
   * first, or adjacent to another, does nothing on a brand that writes its
   * markup differently.
   */
  it('finds the block wherever its class sits in the list, and keeps the others', () => {
    const out = widerCopy('<p class="lead body muted">x</p>').html;
    expect(out).toBe('<p class="lead body muted cb-w-wide">x</p>');
    expect(widerCopy("<p class='body'>x</p>").html).toBe("<p class='body cb-w-wide'>x</p>");
  });

  it('moves every prose block on the slide, and nothing else', () => {
    const out = widerCopy(
      '<div class="eyebrow">E</div><p class="body">B</p><div class="tagline">T</div><div class="panel"><div class="row">R</div></div>',
    ).html;
    expect(out).toContain('class="body cb-w-wide"');
    expect(out).toContain('class="tagline cb-w-wide"');
    expect(out).toContain('class="eyebrow"');
    expect(out).toContain('class="row"');
  });

  it('leaves a slide with no prose alone', () => {
    const rows = '<div class="headline">A</div><div class="panel"><div class="row">one</div></div>';
    expect(widerCopy(rows).changed).toBe(false);
    expect(narrowerCopy(rows).changed).toBe(false);
  });

  it('outranks the brand’s own max-width by doubling the class', () => {
    const css = copyWidthCss();
    // `.cb-slide .body` is (0,2,0); the doubled class is (0,4,0) and wins
    // whatever order the sheets land in.
    expect(css).toContain('.cb-slide .cb-w-wide.cb-w-wide{ max-width:30ch; }');
    expect(css).toContain('.cb-slide .cb-w-full.cb-w-full{ max-width:none; }');
    expect(css).toContain('.cb-slide .cb-w-narrow.cb-w-narrow{ max-width:16ch; }');
  });
});
