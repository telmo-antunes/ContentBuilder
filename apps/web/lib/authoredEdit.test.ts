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
