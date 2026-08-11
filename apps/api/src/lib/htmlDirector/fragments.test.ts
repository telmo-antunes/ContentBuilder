import { describe, it, expect } from 'vitest';
import { brandRecipeSchema, type BrandRecipe } from '@contentbuilder/shared';
import { detailMastersRecipe } from './recipes';
import { authoredSlots } from '@contentbuilder/shared';
import {
  FRAGMENT_CONVENTION,
  checkFragment,
  ensurePhotoHole,
  fillFragmentGaps,
  fillRecipeFragmentGaps,
  fragmentVerbatimGaps,
  substituteFragment,
  validateRecipeFragments,
  readsAsReasoning,
  firstSlideBody,
} from './fragments';
import type { ComposeSlideInput } from './prompt';

/**
 * The substitution engine on its own — no AI boundary to stub, because there is
 * nothing here that could call one. Everything below is pure string work over
 * DetailMasters' real component vocabulary (logo-row, monogram, wordmark,
 * eyebrow, headline, rule, body, stat, panel, cta, handle, fill).
 */

const STATEMENT = `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="rule"></div>
<div class="body">{{body}}</div>`;

const LIST = `<div class="headline">{{headline}}</div>
<div class="panel">{{#rows}}<div class="row"><span class="tick"></span>{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>`;

const COVER = `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<figure class="cb-shot" data-cb-slot="hero"></figure>
<div class="fill"></div>
<div class="handle">{{handle}}</div>`;

const withFragments = (fragments: Record<string, string>): BrandRecipe =>
  brandRecipeSchema.parse({ ...detailMastersRecipe, fragments });

const input = (over: Partial<ComposeSlideInput> & Pick<ComposeSlideInput, 'role'>): ComposeSlideInput => ({
  parts: {},
  format: '1080x1350',
  ...over,
});

/** The filled markup, or a failure that names the gap instead. */
const fill = (recipe: BrandRecipe, i: ComposeSlideInput): string => {
  const out = substituteFragment(recipe, i);
  if (!('html' in out)) throw new Error(`expected a fill, got ${JSON.stringify(out)}`);
  return out.html;
};

describe('checkFragment (author-time validation)', () => {
  const recipe = detailMastersRecipe;

  it('accepts a fragment built from the recipe’s own vocabulary', () => {
    const out = checkFragment(recipe, 'statement', STATEMENT);
    expect(out).toEqual({ html: STATEMENT });
  });

  it('rejects a fragment naming a class the recipe never defined', () => {
    const out = checkFragment(recipe, 'statement', '<div class="hero-block">{{headline}}</div>');
    expect(out).toEqual({ reason: 'uses undefined class .hero-block' });
  });

  it('allows the structural classes no recipe advertises', () => {
    // fill/row/tick/sm/em/it/cb-shot are markup furniture, not brand vocabulary
    const html = '<div class="headline sm"><span class="it">{{headline}}</span></div><div class="fill"></div>';
    expect(checkFragment(recipe, 'statement', html)).toEqual({ html });
  });

  it('rejects an unknown placeholder, and {{emphasis}} in particular', () => {
    expect(checkFragment(recipe, 'statement', '<div class="headline">{{emphasis}}</div>')).toEqual({
      reason: 'unknown placeholder {{emphasis}}',
    });
    expect(checkFragment(recipe, 'statement', '<div class="body">{{subtitle}}</div>')).toEqual({
      reason: 'unknown placeholder {{subtitle}}',
    });
  });

  it('rejects the same hole twice — it would print the copy twice', () => {
    const html = '<div class="headline">{{headline}}</div><div class="body">{{headline}}</div>';
    expect(checkFragment(recipe, 'statement', html)).toEqual({
      reason: '{{headline}} appears more than once',
    });
  });

  it('rejects a malformed or empty rows section', () => {
    expect(checkFragment(recipe, 'list', '<div class="panel">{{#rows}}<div class="row">x</div></div>')).toEqual({
      reason: 'unbalanced {{#rows}} section',
    });
    expect(checkFragment(recipe, 'list', '<div class="panel">{{#rows}}<div class="row"></div>{{/rows}}</div>')).toEqual({
      reason: '{{#rows}} section carries no {{row.text}}',
    });
    expect(checkFragment(recipe, 'list', '<div class="row">{{row.text}}</div>')).toEqual({
      reason: 'row placeholder outside a {{#rows}} section',
    });
  });

  it('rejects a role that is not a slide role', () => {
    expect(checkFragment(recipe, 'hero', STATEMENT)).toEqual({ reason: 'not a slide role' });
  });

  it('sanitises with the SAME allowlist a composed slide goes through', () => {
    const out = checkFragment(
      recipe,
      'statement',
      '<div class="headline" style="color:red" onclick="x()">{{headline}}</div><script>evil()</script>',
    );
    expect(out).toEqual({ html: '<div class="headline">{{headline}}</div>' });
  });

  it('normalises whitespace inside the braces, and unwraps a .cb-slide wrapper', () => {
    const out = checkFragment(recipe, 'statement', '<div class="cb-slide"><div class="headline">{{ headline }}</div></div>');
    expect(out).toEqual({ html: '<div class="headline">{{headline}}</div>' });
  });

  it('drops a fragment that sanitises away to nothing', () => {
    expect(checkFragment(recipe, 'statement', '<script>alert(1)</script>')).toEqual({
      reason: 'empty after sanitising',
    });
  });
});

describe('validateRecipeFragments', () => {
  it('keeps the good and drops the bad, naming each reason', () => {
    const r = withFragments({
      statement: STATEMENT,
      list: LIST,
      quote: '<div class="hero-block">{{quote}}</div>',
      nonsense: STATEMENT,
    });
    const out = validateRecipeFragments(r);
    expect(Object.keys(out.recipe.fragments ?? {}).sort()).toEqual(['list', 'statement']);
    expect(out.dropped).toEqual([
      { role: 'quote', reason: 'uses undefined class .hero-block' },
      { role: 'nonsense', reason: 'not a slide role' },
    ]);
  });

  it('returns a recipe with NO fragments untouched (the same object)', () => {
    const out = validateRecipeFragments(detailMastersRecipe);
    expect(out.recipe).toBe(detailMastersRecipe);
    expect(out.dropped).toEqual([]);
  });

  it('removes the key entirely when every fragment is unusable', () => {
    const out = validateRecipeFragments(withFragments({ statement: '<div class="nope">{{headline}}</div>' }));
    expect(out.recipe.fragments).toBeUndefined();
    expect(out.dropped).toHaveLength(1);
  });
});

describe('substituteFragment (the deterministic fill)', () => {
  it('substitutes copy byte-for-byte into the brand’s own markup', () => {
    const r = withFragments({ statement: STATEMENT });
    expect(
      fill(
        r,
        input({
          role: 'statement',
          parts: {
            eyebrow: 'Prepaid packages',
            headline: 'Get paid before you lift a finger.',
            body: 'The money lands in the bank while the diary fills itself.',
          },
        }),
      ),
    ).toBe(
      `<div class="eyebrow">Prepaid packages</div>
<div class="headline">Get paid before you lift a finger.</div>
<div class="rule"></div>
<div class="body">The money lands in the bank while the diary fills itself.</div>`,
    );
  });

  it('omits an absent part’s ELEMENT rather than leaving a placeholder', () => {
    const r = withFragments({ statement: STATEMENT });
    const html = fill(r, input({ role: 'statement', parts: { headline: 'Only the line.' } }));
    expect(html).toBe(`<div class="headline">Only the line.</div>
<div class="rule"></div>`);
    expect(html).not.toContain('{{');
    expect(html).not.toContain('class="eyebrow"');
    expect(html).not.toContain('class="body"');
  });

  it('repeats the row unit once per row — for 2 rows and for 5', () => {
    const r = withFragments({ list: LIST });
    const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Row number ${i + 1}` }));
    for (const n of [2, 5]) {
      const html = fill(r, input({ role: 'list', parts: { headline: 'Four things change', rows: rowsOf(n) } }));
      expect(html.match(/class="row"/g)).toHaveLength(n);
      rowsOf(n).forEach((row) => expect(html).toContain(row.text));
      // the optional note's element goes with it — no empty <em> stubs left
      expect(html).not.toContain('<em>');
      expect(html).not.toContain('{{');
    }
  });

  it('keeps a row’s note when it has one, per row', () => {
    const r = withFragments({ list: LIST });
    const html = fill(
      r,
      input({
        role: 'list',
        parts: {
          headline: 'Two things change',
          rows: [{ text: 'Cash lands first', note: 'before the work' }, { text: 'Repeat visits secured' }],
        },
      }),
    );
    expect(html).toContain('<em>before the work</em>');
    expect(html.match(/<em>/g)).toHaveLength(1);
  });

  it('takes the panel with it when a list slide has no rows at all', () => {
    const r = withFragments({ list: LIST });
    const html = fill(r, input({ role: 'list', parts: { headline: 'Nothing to enumerate' } }));
    expect(html).toBe('<div class="headline">Nothing to enumerate</div>');
  });

  it('keeps the photo slot on a photo slide and removes it on one without', () => {
    const r = withFragments({ cover: COVER });
    const parts = { eyebrow: 'Prepaid packages', headline: 'Get paid up front.' };
    const withPhoto = fill(r, input({ role: 'cover', parts, photo: true }));
    expect(withPhoto).toContain('<figure class="cb-shot" data-cb-slot="hero"></figure>');
    const without = fill(r, input({ role: 'cover', parts, photo: false }));
    expect(without).not.toContain('cb-shot');
    expect(without).not.toContain('data-cb-slot');
    expect(without).toContain('class="fill"');
  });

  it('escapes copy, so hostile text cannot smuggle markup or a replace pattern', () => {
    const r = withFragments({ statement: STATEMENT });
    const html = fill(
      r,
      input({ role: 'statement', parts: { headline: 'Deals < worth > "quoting" & $& more' } }),
    );
    expect(html).toContain('Deals &lt; worth &gt; &quot;quoting&quot; &amp; $&amp; more');
    expect(fragmentVerbatimGaps(html, { headline: 'Deals < worth > "quoting" & $& more' })).toEqual([]);
  });

  it('falls back when the role has no fragment', () => {
    expect(substituteFragment(withFragments({ statement: STATEMENT }), input({ role: 'cta' }))).toEqual({
      kind: 'no-fragment',
    });
    expect(substituteFragment(detailMastersRecipe, input({ role: 'statement' }))).toEqual({
      kind: 'no-fragment',
    });
  });

  it('falls back when a provided part has no hole to go in — never loses copy', () => {
    const r = withFragments({ statement: STATEMENT });
    expect(
      substituteFragment(r, input({ role: 'statement', parts: { headline: 'A line', cta: 'Book now' } })),
    ).toEqual({ kind: 'no-placeholder', part: 'cta' });
    expect(
      substituteFragment(r, input({ role: 'statement', parts: { headline: 'A line', rows: [{ text: 'x' }] } })),
    ).toEqual({ kind: 'no-placeholder', part: 'rows' });
  });

  it('falls back when a photo slide’s fragment leaves no hole for the picture', () => {
    const r = withFragments({ statement: STATEMENT });
    expect(
      substituteFragment(r, input({ role: 'statement', parts: { headline: 'A line' }, photo: true })),
    ).toEqual({ kind: 'no-slot' });
  });

  it('carries an emphasis on the headline’s coat-tails, and falls back without one', () => {
    const r = withFragments({ statement: STATEMENT });
    // the wrap itself is mechanical (compose.ts) — here it only has to be POSSIBLE
    expect(
      'html' in
        substituteFragment(
          r,
          input({ role: 'statement', parts: { headline: 'Get paid before you lift a finger.', emphasis: 'lift a finger.' } }),
        ),
    ).toBe(true);
    expect(substituteFragment(r, input({ role: 'statement', parts: { emphasis: 'lift a finger.' } }))).toEqual({
      kind: 'no-placeholder',
      part: 'emphasis',
    });
  });

  it('keeps a shared element when only one of its two holes is absent', () => {
    // The convention says one hole per element; an author who ignores it must
    // still not lose the part that IS present.
    const r = withFragments({ statement: '<div class="body">{{eyebrow}} — {{body}}</div>' });
    const html = fill(r, input({ role: 'statement', parts: { body: 'The money lands first.' } }));
    expect(html).toBe('<div class="body"> — The money lands first.</div>');
  });
});

describe('the convention the author prompt states', () => {
  it('names every placeholder the validator accepts, and forbids {{emphasis}}', () => {
    for (const part of ['eyebrow', 'headline', 'tagline', 'body', 'quote', 'attribution', 'stat', 'cta', 'handle']) {
      expect(FRAGMENT_CONVENTION).toContain(`{{${part}}}`);
    }
    expect(FRAGMENT_CONVENTION).toContain('{{#rows}}');
    expect(FRAGMENT_CONVENTION).toContain('{{row.text}}');
    expect(FRAGMENT_CONVENTION).toContain('NO {{emphasis}} placeholder');
  });

  it('shows an example that would itself survive validation', () => {
    // The illustrative block in the prompt is real markup, so pull it out and
    // hold it to the same gate — a prompt that teaches an invalid shape is worse
    // than one that teaches none.
    const example = FRAGMENT_CONVENTION.slice(FRAGMENT_CONVENTION.indexOf('  <div class="eyebrow">'))
      .split('\n')
      .map((l) => l.trim())
      .join('\n');
    expect(checkFragment(detailMastersRecipe, 'list', example)).toHaveProperty('html');
  });
});

describe('filling the gaps a fragment was authored without', () => {
  it('adds the missing hole in the brand’s own class and its own composition order', () => {
    // The real case: DetailMasters' `list` fragment had no {{tagline}}, so
    // every list slide with a tagline paid for a model call.
    const out = fillFragmentGaps(
      detailMastersRecipe,
      'feature',
      `<div class="eyebrow">{{eyebrow}}</div>\n<div class="headline">{{headline}}</div>\n<div class="rule"></div>`,
      ['eyebrow', 'headline', 'body'],
    );
    expect(out.added).toEqual(['body']);
    expect(out.html).toContain('<div class="body">{{body}}</div>');
    // The feature pattern reads "eyebrow → headline(.it) → rule → body → …",
    // so the body lands AFTER the rule, not before the headline.
    expect(out.html.indexOf('{{body}}')).toBeGreaterThan(out.html.indexOf('class="rule"'));
  });

  it('changes nothing when every hole is already there', () => {
    const fragment = `<div class="headline">{{headline}}</div>`;
    expect(fillFragmentGaps(detailMastersRecipe, 'statement', fragment, ['headline'])).toEqual({
      html: fragment,
      added: [],
    });
  });

  it('skips a part this brand has no class for', () => {
    const bare = { ...detailMastersRecipe, components: [{ className: 'headline', use: 'the line' }] };
    const out = fillFragmentGaps(bare, 'statement', '<div class="headline">{{headline}}</div>', [
      'headline',
      'tagline',
    ]);
    expect(out.added).toEqual([]);
  });

  it('is idempotent — a second pass adds nothing', () => {
    const once = fillRecipeFragmentGaps({
      ...detailMastersRecipe,
      fragments: { statement: '<div class="headline">{{headline}}</div>' },
    });
    expect(once.repairs.length).toBeGreaterThan(0);
    expect(fillRecipeFragmentGaps(once.recipe).repairs).toEqual([]);
  });

  it('leaves a repaired fragment valid — it still passes the stored-fragment gate', () => {
    const out = fillRecipeFragmentGaps({
      ...detailMastersRecipe,
      fragments: { list: '<div class="headline">{{headline}}</div>\n<div class="panel">{{#rows}}<div class="row">{{row.text}}</div>{{/rows}}</div>' },
    });
    const repaired = out.recipe.fragments!.list!;
    expect(checkFragment(detailMastersRecipe, 'list', repaired)).toHaveProperty('html');
    // …and it can still carry a real slide, rows and all.
    const filled = substituteFragment(out.recipe, {
      role: 'list',
      parts: { eyebrow: 'A kicker', headline: 'A line', rows: [{ text: 'One' }, { text: 'Two' }] },
      format: '1080x1350',
    });
    expect(filled).toHaveProperty('html');
    expect((filled as { html: string }).html).toContain('A kicker');
    expect((filled as { html: string }).html).toContain('One');
  });

  it('never inserts a hole inside a list — the rows own that element', () => {
    const out = fillRecipeFragmentGaps({
      ...detailMastersRecipe,
      fragments: { list: '<div class="panel">{{#rows}}<div class="row">{{row.text}}</div>{{/rows}}</div>' },
    });
    const repaired = out.recipe.fragments!.list!;
    const panelStart = repaired.indexOf('class="panel"');
    const panelEnd = repaired.indexOf('</div>', repaired.indexOf('{{/rows}}'));
    for (const part of ['{{eyebrow}}', '{{headline}}', '{{body}}']) {
      const at = repaired.indexOf(part);
      if (at === -1) continue;
      expect(at < panelStart || at > panelEnd).toBe(true);
    }
  });

  it('does nothing to a recipe with no fragments at all', () => {
    const out = fillRecipeFragmentGaps(detailMastersRecipe);
    expect(out.repairs).toEqual([]);
    expect(out.recipe).toBe(detailMastersRecipe);
  });
});

describe('ensurePhotoHole', () => {
  const R = withFragments({});

  it('adds a slot before the sign-off line, where the brand puts its own', () => {
    const out = ensurePhotoHole(R, 'statement',
      '<div class="headline">{{headline}}</div>\n<div class="handle">{{handle}}</div>');
    expect(out.added).toBe(true);
    expect(authoredSlots(out.html)).toEqual(['hero']);
    // The handle stays last — it is the brand's bottom line.
    expect(out.html.indexOf('cb-shot')).toBeLessThan(out.html.indexOf('class="handle"'));
  });

  it('appends when the fragment has no sign-off line', () => {
    const out = ensurePhotoHole(R, 'cover', STATEMENT);
    expect(out.added).toBe(true);
    expect(authoredSlots(out.html)).toEqual(['hero']);
  });

  it('leaves a fragment that already has a slot exactly as it was', () => {
    const out = ensurePhotoHole(R, 'cover', COVER);
    expect(out.added).toBe(false);
    expect(out.html).toBe(COVER);
  });

  /**
   * Rows and a picture never share a slide, a quote is the line and nothing
   * else, and a cta competing with a photograph is just a busier cta.
   */
  it.each(['quote', 'stat', 'list', 'cta'])('does not give %s a photo slot', (role) => {
    const out = ensurePhotoHole(R, role, STATEMENT);
    expect(out.added).toBe(false);
    expect(authoredSlots(out.html)).toEqual([]);
  });

  it('is idempotent — a second pass adds nothing', () => {
    const once = ensurePhotoHole(R, 'cover', STATEMENT);
    const twice = ensurePhotoHole(R, 'cover', once.html);
    expect(twice.added).toBe(false);
    expect(twice.html).toBe(once.html);
  });

  it('reports the photo slot as a repair through fillRecipeFragmentGaps', () => {
    const { recipe, repairs } = fillRecipeFragmentGaps(withFragments({ statement: STATEMENT }));
    expect(repairs.find((r) => r.role === 'statement')?.added).toContain('photo slot');
    expect(authoredSlots(recipe.fragments?.statement ?? '')).toEqual(['hero']);
  });
})

describe('readsAsReasoning', () => {
  /** The exact text that shipped on an exported story frame. */
  const LEAKED =
    'Wait, I need to re-examine. The copy parts provided are only eyebrow and cta — ' +
    'no headline, no tagline, no handle. I must not fabricate missing elements. ' +
    'Let me also fix the double class attribute on figure.';

  it('catches the reply that actually shipped', () => {
    expect(readsAsReasoning(LEAKED)).toBe(true);
  });

  it.each([
    'I need to check the coating before winter.',
    'Let me fix that for you.',
    'Wait, I have a question about my booking.',
  ])('catches meta-commentary even in isolation: %s', (t) => {
    expect(readsAsReasoning(t)).toBe(true);
  });

  /**
   * A false positive throws away a legitimate compose, so the markers are
   * deliberately narrow. Real slide copy addresses a reader about their world.
   */
  it.each([
    'Your coating is probably fine.',
    'Tight beads that sheet off cleanly: healthy.',
    'Automatic washes with brushes do more damage than age does.',
    'Have it looked at by someone who does this for a living.',
    'We need to talk about your paint.',
    'This is the corrected finish your car deserves.',
    'Book an inspection before the first frost.',
  ])('leaves real slide copy alone: %s', (t) => {
    expect(readsAsReasoning(t)).toBe(false);
  });

  it('ignores anything too short to be prose', () => {
    expect(readsAsReasoning('I need to')).toBe(false);
    expect(readsAsReasoning('')).toBe(false);
  });
});

describe('firstSlideBody', () => {
  it('keeps the first frame when a reply emitted the slide twice', () => {
    const one = '<div class="cb-slide"><div class="headline">First</div></div>';
    const two = '<div class="cb-slide"><div class="headline">Second</div></div>';
    const out = firstSlideBody(`${one}\n${two}`);
    expect(out).toBe(one);
    expect(out).not.toContain('Second');
  });

  it('leaves a single frame byte-identical', () => {
    const one = '<div class="cb-slide"><div class="headline">Only</div></div>';
    expect(firstSlideBody(one)).toBe(one);
  });

  it('leaves a bare fragment — the normal case — untouched', () => {
    const frag = '<div class="headline">No wrapper here</div>';
    expect(firstSlideBody(frag)).toBe(frag);
  });
})
