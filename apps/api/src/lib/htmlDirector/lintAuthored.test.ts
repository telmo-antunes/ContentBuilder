import { describe, expect, it } from 'vitest';
import { lintAuthored } from './lintAuthored';

/** The exact row markup that shipped a phantom gap instead of a bullet. */
const REAL_ROW =
  '<div class="row"><span class="tick"></span>Income arrives before any work is done.<em>Cash in the bank.</em></div>';

describe('list markers are left to the render layer', () => {
  it('does not touch an empty marker — the row supplies its own bullet', () => {
    // Filling it here would be a second owner for the same decision, and the
    // composer's contract treats these spans as decorative.
    expect(lintAuthored(REAL_ROW).html).toBe(REAL_ROW);
  });

  it('leaves every name a marker goes by alone', () => {
    for (const cls of ['tick', 'bullet', 'dot', 'num', 'check', 'arrow', 'row-marker', 'list-dash']) {
      const src = `<div class="row"><span class="${cls}"></span>x</div>`;
      expect(lintAuthored(src).html).toBe(src);
    }
  });
});

describe('elements that are meant to be empty', () => {
  it('keeps spacers, rules, art and image slots', () => {
    for (const cls of ['fill', 'rule', 'divider', 'monogram', 'scrim', 'cb-shot']) {
      const src = `<div class="${cls}"></div>`;
      expect(lintAuthored(src).html).toBe(src);
    }
  });

  it('drops an invisible leftover that is neither a marker nor a spacer', () => {
    const { html, findings } = lintAuthored('<p class="body"></p><p class="body">Real copy.</p>');
    expect(html).toBe('<p class="body">Real copy.</p>');
    expect(findings.map((f) => f.kind)).toContain('empty-element-dropped');
  });

  it('never touches an element that has content', () => {
    const src = '<p class="body">Kept.</p><div class="headline">Also kept.</div>';
    expect(lintAuthored(src).html).toBe(src);
  });
});

describe('a paragraph that is secretly a list', () => {
  const secretList =
    '<div class="body">Cash in the bank before the work begins. Repeat visits secured in advance. ' +
    'Slow weeks funded ahead of time.</div>';

  it('flags it when the brand HAS a list vocabulary to use instead', () => {
    const { findings } = lintAuthored(secretList, { hasListVocabulary: true });
    expect(findings.map((f) => f.kind)).toContain('paragraph-is-a-list');
  });

  it('reports without rewriting — splitting copy is the parse step’s job', () => {
    const { html } = lintAuthored(secretList, { hasListVocabulary: true });
    expect(html).toBe(secretList);
  });

  it('stays quiet for a brand with no list classes', () => {
    expect(lintAuthored(secretList).findings).toHaveLength(0);
  });

  it('stays quiet for a normal one-sentence body', () => {
    const one = '<div class="body">Coating seals in whatever is already there.</div>';
    expect(lintAuthored(one, { hasListVocabulary: true }).findings).toHaveLength(0);
  });
});

describe('robustness', () => {
  it('handles empty and junk input without throwing', () => {
    expect(lintAuthored('').html).toBe('');
    expect(lintAuthored('<div class="row"><span class="tick"></span>').findings.length).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent — a second pass changes nothing', () => {
    const once = lintAuthored(REAL_ROW).html;
    expect(lintAuthored(once).html).toBe(once);
  });
});
