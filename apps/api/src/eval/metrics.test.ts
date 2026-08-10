import { describe, it, expect } from 'vitest';
import type { ComposeSlideInput } from '../lib/htmlDirector/prompt';
// The budgets live in the pipeline, not the eval: the harness measures what
// compose actually enforces, so the numbers can never drift apart.
import { composeBudgetsFor } from '../lib/htmlDirector/compose';
import {
  aggregate,
  dedupeGuardCheck,
  diffAggregates,
  estimateRunCostUsd,
  estimateUnitCostUsd,
  formatDiffTable,
  parseBudgetViolations,
  parseComposerWarnings,
  plain,
  roleShapeViolations,
  sanitizerDelta,
  slideMetrics,
  slotCheck,
  verbatimViolations,
  type RunResult,
} from './metrics';
import { EVAL_BRANDS, EVAL_FIXTURES, pickBrands, pickFixtures } from './fixtures';

const slide = (over: Partial<ComposeSlideInput> & Pick<ComposeSlideInput, 'role'>): ComposeSlideInput => ({
  parts: {},
  format: '1080x1350',
  ...over,
});

const POST = composeBudgetsFor('1080x1350');

describe('parseBudgetViolations', () => {
  it('flags every part over its PARSE_SYSTEM budget, with the right limit', () => {
    const slides = [
      slide({
        role: 'cover',
        parts: {
          eyebrow: 'e'.repeat(POST.eyebrow + 1),
          headline: 'h'.repeat(POST.headline + 10),
          body: 'b'.repeat(POST.body + 1),
          cta: 'c'.repeat(POST.cta + 1),
        },
      }),
      slide({
        role: 'list',
        parts: { rows: [{ text: 'r'.repeat(POST.rowText + 1) }, { text: 'short and fine' }] },
      }),
    ];
    const v = parseBudgetViolations(slides);
    expect(v).toHaveLength(5);
    expect(v.map((x) => x.part).sort()).toEqual(['body', 'cta', 'eyebrow', 'headline', 'rows[0].text']);
    const headline = v.find((x) => x.part === 'headline')!;
    expect(headline).toMatchObject({
      slide: 0,
      role: 'cover',
      length: POST.headline + 10,
      limit: POST.headline,
    });
    const row = v.find((x) => x.part === 'rows[0].text')!;
    expect(row).toMatchObject({ slide: 1, role: 'list', limit: POST.rowText });
  });

  it('is silent when everything fits the budgets', () => {
    const slides = [
      slide({ role: 'cover', parts: { eyebrow: 'The hook', headline: 'Short and punchy', cta: 'Book now' } }),
      slide({ role: 'list', parts: { rows: [{ text: 'Fits with ease' }] } }),
    ];
    expect(parseBudgetViolations(slides)).toEqual([]);
  });
});

describe('roleShapeViolations', () => {
  it('accepts cover-first, cta-last, lists with rows', () => {
    const slides = [
      slide({ role: 'cover' }),
      slide({ role: 'list', parts: { rows: [{ text: 'a' }, { text: 'b' }] } }),
      slide({ role: 'cta' }),
    ];
    expect(roleShapeViolations(slides)).toEqual([]);
  });

  it('flags a wrong first, a wrong last and a rowless list', () => {
    const slides = [
      slide({ role: 'statement' }),
      slide({ role: 'list', parts: { rows: [{ text: 'only one' }] } }),
      slide({ role: 'quote' }),
    ];
    expect(roleShapeViolations(slides)).toEqual([
      { type: 'first-not-cover', role: 'statement' },
      { type: 'last-not-cta', role: 'quote' },
      { type: 'list-without-rows', slide: 1 },
    ]);
  });
});

describe('verbatimViolations (the plain() containment check)', () => {
  it('sees copy spread across sibling elements and through entities', () => {
    const parts = { headline: 'Get paid before you lift a finger.', tagline: 'Fish & chips' };
    const html =
      '<div class="headline">Get paid before you <span class="it">lift a finger.</span></div>' +
      '<div class="tagline">Fish &amp; chips</div>';
    expect(verbatimViolations(parts, html)).toEqual([]);
  });

  it('reports missing string parts and missing rows', () => {
    const parts = {
      headline: 'Kept headline',
      cta: 'Book now',
      rows: [{ text: 'Kept row here' }, { text: 'Dropped row text' }],
    };
    const html =
      '<div class="headline">Kept headline</div><div class="panel"><div class="row">Kept row here</div></div>';
    expect(verbatimViolations(parts, html)).toEqual(['cta', 'rows[1].text']);
  });

  it('ignores parts of 2 characters or fewer, exactly like compose.ts', () => {
    expect(verbatimViolations({ stat: '4%' }, '<div class="headline">No stat anywhere</div>')).toEqual([]);
  });

  it('plain() collapses tags to spaces so split copy still matches', () => {
    expect(plain('<div>begins.</div><div>Repeat</div>')).toBe('begins. repeat');
  });
});

describe('dedupeGuardCheck', () => {
  const ROWS = ['Cash lands before the work begins.', 'Repeat visits secured in advance.'];
  const DUPLICATED =
    `<div class="body">${ROWS.join(' ')}</div>` +
    `<div class="panel">` +
    ROWS.map((r) => `<div class="row"><span class="tick"></span>${r}<em></em></div>`).join('') +
    `</div>`;

  it('counts a duplicated paragraph and the empty inline stubs', () => {
    const check = dedupeGuardCheck(DUPLICATED);
    expect(check.changed).toBe(true);
    expect(check.dropped).toBe(1);
    expect(check.strippedInline).toBe(2);
  });

  it('is a no-op on a clean fragment', () => {
    const clean = '<div class="headline">One thing said once</div><div class="cta">Go</div>';
    expect(dedupeGuardCheck(clean)).toEqual({ changed: false, dropped: 0, strippedInline: 0 });
  });
});

describe('sanitizerDelta', () => {
  it('flags a fragment the production sanitiser would still change', () => {
    const dirty = '<div class="body" style="color:red">Hi</div><script>alert(1)</script>';
    const delta = sanitizerDelta(dirty);
    expect(delta.changed).toBe(true);
    expect(delta.charDelta).toBeLessThan(0);
  });

  it('is a no-op on already-sanitised markup', () => {
    expect(sanitizerDelta('<div class="body">Hi</div>')).toEqual({ changed: false, charDelta: 0 });
  });
});

describe('slotCheck', () => {
  const slot = (name: string) => `<figure class="cb-shot" data-cb-slot="${name}"></figure>`;

  it('accepts a photo slide with one or two slots', () => {
    expect(slotCheck(true, slot('hero'))).toEqual({ slots: ['hero'] });
    expect(slotCheck(true, slot('before') + slot('after'))).toEqual({ slots: ['before', 'after'] });
  });

  it('flags a photo slide with no hole, and one with too many', () => {
    expect(slotCheck(true, '<div class="headline">No hole</div>').issue).toBe('missing-slot');
    expect(slotCheck(true, slot('a') + slot('b') + slot('c')).issue).toBe('too-many-slots');
  });

  it('flags any slot on a non-photo slide', () => {
    expect(slotCheck(false, slot('rogue')).issue).toBe('unexpected-slot');
    expect(slotCheck(undefined, '<div class="headline">Fine</div>')).toEqual({ slots: [] });
  });
});

describe('parseComposerWarnings', () => {
  it('parses the exact warn lines compose.ts emits', () => {
    const w = parseComposerWarnings([
      '[compose] list: dropped duplicated div.body (already said by div.panel): "Cash lands…"',
      '[compose] list: dropped a now-redundant div.fill spacer',
      '[compose] list: stripped 4 empty inline element(s)',
      '[compose] cta: parts not verbatim in output: cta, handle',
      '[ai] some-model declined a request — retrying', // not a compose guard line
    ]);
    expect(w).toEqual({ droppedDuplicates: 1, droppedSpacers: 1, strippedInline: 4, verbatimMissing: 2 });
  });

  it('returns zeros for no warnings', () => {
    expect(parseComposerWarnings([])).toEqual({
      droppedDuplicates: 0,
      droppedSpacers: 0,
      strippedInline: 0,
      verbatimMissing: 0,
    });
  });
});

describe('slideMetrics', () => {
  it('rolls up every per-slide check for a clean photo slide', () => {
    const input = slide({
      role: 'cover',
      photo: true,
      parts: { eyebrow: 'Prepaid packages', headline: 'Get paid first.' },
    });
    const html =
      '<div class="eyebrow">Prepaid packages</div><div class="headline">Get paid first.</div>' +
      '<figure class="cb-shot" data-cb-slot="hero"></figure>';
    const m = slideMetrics(input, html);
    expect(m.role).toBe('cover');
    expect(m.fragmentChars).toBe(html.length);
    expect(m.verbatimMissing).toEqual([]);
    expect(m.dedupe.changed).toBe(false);
    expect(m.sanitizer.changed).toBe(false);
    expect(m.slots).toEqual(['hero']);
    expect(m.slotIssue).toBeUndefined();
  });
});

// ── aggregate + diff ─────────────────────────────────────────────────────────

const RUN_OK: RunResult = {
  fixture: 'tips-list',
  brand: 'dynatos',
  rep: 1,
  parse: {
    latencyMs: 100,
    roles: ['cover', 'cta'],
    budget: [{ slide: 0, role: 'cover', part: 'headline', length: 70, limit: 60 }],
    shape: [],
  },
  slides: [
    {
      role: 'cover',
      html: 'x'.repeat(100),
      latencyMs: 200,
      metrics: {
        role: 'cover',
        fragmentChars: 100,
        verbatimMissing: [],
        dedupe: { changed: false, dropped: 0, strippedInline: 0 },
        sanitizer: { changed: false, charDelta: 0 },
        slots: [],
      },
    },
    {
      role: 'cta',
      html: 'x'.repeat(300),
      latencyMs: 300,
      metrics: {
        role: 'cta',
        fragmentChars: 300,
        verbatimMissing: ['cta'],
        dedupe: { changed: true, dropped: 1, strippedInline: 0 },
        sanitizer: { changed: true, charDelta: -12 },
        slots: ['rogue'],
        slotIssue: 'unexpected-slot',
      },
    },
  ],
  warnings: { droppedDuplicates: 1, droppedSpacers: 0, strippedInline: 2, verbatimMissing: 1 },
  rawWarnings: [],
  estCostUsd: 0.01,
};

const RUN_FAILED: RunResult = {
  fixture: 'adversarial',
  brand: 'detailmasters',
  rep: 1,
  error: 'no JSON object in response',
  slides: [],
  warnings: { droppedDuplicates: 0, droppedSpacers: 0, strippedInline: 0, verbatimMissing: 0 },
  rawWarnings: [],
  estCostUsd: 0.005,
};

describe('aggregate', () => {
  it('sums, counts and averages across runs', () => {
    const a = aggregate([RUN_OK, RUN_FAILED]);
    expect(a).toEqual({
      runs: 2,
      errors: 1,
      slides: 2,
      calls: 4, // (1 parse + 2 slides) + (1 failed parse attempt)
      budgetViolations: 1,
      roleShapeViolations: 0,
      verbatimViolations: 1,
      dedupeGuardHits: 1,
      composerDroppedDuplicates: 1,
      composerDroppedSpacers: 0,
      composerStrippedInline: 2,
      composerVerbatimWarnings: 1,
      sanitizerDeltas: 1,
      slotViolations: 1,
      // neither fixture slide carries a `source`, and an absent one is the AI
      // path — which is what every report written before fragments existed was
      fragmentSlides: 0,
      aiSlides: 2,
      avgFragmentChars: 200,
      maxFragmentChars: 300,
      totalLatencyMs: 600,
      avgCallLatencyMs: 150,
      estCostUsd: 0.015,
    });
  });

  it('splits slides by which path composed them', () => {
    const mixed: RunResult = {
      ...RUN_OK,
      slides: [
        { ...RUN_OK.slides[0]!, source: 'fragment' },
        { ...RUN_OK.slides[1]!, source: 'ai' },
        { ...RUN_OK.slides[0]!, source: 'fragment' },
      ],
    };
    const a = aggregate([mixed]);
    expect(a.fragmentSlides).toBe(2);
    expect(a.aiSlides).toBe(1);
    expect(a.fragmentSlides + a.aiSlides).toBe(a.slides);
  });

  it('handles an empty run list', () => {
    const a = aggregate([]);
    expect(a.runs).toBe(0);
    expect(a.avgFragmentChars).toBe(0);
    expect(a.avgCallLatencyMs).toBe(0);
  });
});

describe('diffAggregates / formatDiffTable', () => {
  it('diffs metric by metric, reading absent baseline keys as 0', () => {
    const current = aggregate([RUN_OK, RUN_FAILED]);
    const rows = diffAggregates({ verbatimViolations: 4, runs: 2 }, current);
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r]));
    expect(byMetric['verbatimViolations']).toEqual({ metric: 'verbatimViolations', baseline: 4, current: 1, delta: -3 });
    expect(byMetric['runs']!.delta).toBe(0);
    // a metric the baseline never had reads as 0
    expect(byMetric['slotViolations']).toEqual({ metric: 'slotViolations', baseline: 0, current: 1, delta: 1 });
    // every aggregate key appears exactly once
    expect(rows.map((r) => r.metric).sort()).toEqual(Object.keys(current).sort());
  });

  it('renders a signed fixed-width table', () => {
    const table = formatDiffTable([
      { metric: 'verbatimViolations', baseline: 4, current: 1, delta: -3 },
      { metric: 'slotViolations', baseline: 0, current: 1, delta: 1 },
    ]);
    expect(table).toContain('metric');
    expect(table).toContain('baseline');
    expect(table).toMatch(/verbatimViolations\s+4\s+1\s+-3/);
    expect(table).toMatch(/slotViolations\s+0\s+1\s+\+1/);
  });
});

describe('cost estimation', () => {
  it('prices a unit as one parse plus one compose per slide', () => {
    const est = estimateRunCostUsd('claude-haiku-x', [{ ideaChars: 300, slideCount: 5 }]);
    expect(est.calls).toBe(6);
    expect(est.estCostUsd).toBeGreaterThan(0);
  });

  it('scales with slide count and with model tier', () => {
    expect(estimateUnitCostUsd('claude-haiku-x', 300, 8)).toBeGreaterThan(estimateUnitCostUsd('claude-haiku-x', 300, 4));
    expect(estimateUnitCostUsd('claude-fable-5', 300, 5)).toBeGreaterThan(estimateUnitCostUsd('claude-haiku-x', 300, 5));
  });
});

// ── fixture sanity (the golden set the metrics run over) ────────────────────

describe('eval fixtures', () => {
  it('covers the intended range with stable, unique ids', () => {
    expect(EVAL_FIXTURES).toHaveLength(10);
    expect(new Set(EVAL_FIXTURES.map((f) => f.id)).size).toBe(10);
    for (const f of EVAL_FIXTURES) {
      expect(f.idea.length).toBeGreaterThan(0);
      expect(f.idea.length).toBeLessThanOrEqual(2000);
      expect(f.slideCount).toBeGreaterThanOrEqual(1);
      expect(f.slideCount).toBeLessThanOrEqual(12);
      expect(['1080x1350', '1080x1920', '1080x1080']).toContain(f.format);
    }
  });

  it('keeps the long ramble near the 2000-char cap and the adversarial idea hostile', () => {
    const ramble = EVAL_FIXTURES.find((f) => f.id === 'long-ramble')!;
    expect(ramble.idea.length).toBeGreaterThanOrEqual(1700);
    expect(ramble.idea.length).toBeLessThanOrEqual(2000);
    const adversarial = EVAL_FIXTURES.find((f) => f.id === 'adversarial')!;
    expect(adversarial.idea).toContain('ignore instructions');
    expect(adversarial.idea).toContain('<script>');
  });

  it('exercises the brief language: a read source, a plan and a verbatim lock', () => {
    const fromSource = EVAL_FIXTURES.find((f) => f.id === 'from-a-blog-post')!;
    expect(fromSource.sources).toHaveLength(1);
    // The frozen read must keep the shape `extractReadable` produces, or the
    // fixture stops testing the thing it exists to test.
    expect(fromSource.sources![0]!.text).toMatch(/^# /);
    expect(fromSource.sources![0]!.text).toContain('\n- Beads get flatter');
    expect(fromSource.sources![0]!.byline).toBe('Telmo Antunes');
    // The brief itself says almost nothing: everything has to come from the page.
    expect(fromSource.idea.length).toBeLessThan(120);

    const planned = EVAL_FIXTURES.find((f) => f.id === 'planned-from-a-source')!;
    expect(planned.plan).toHaveLength(4);
    expect(planned.locks).toEqual(['Read the water, not the calendar']);
    // The lock has to actually be quoted in the plan the user typed.
    expect(planned.plan!.join(' ')).toContain('"Read the water, not the calendar"');
  });

  it('binds both reference recipes and filters by id', () => {
    expect(EVAL_BRANDS.map((b) => b.id)).toEqual(['dynatos', 'detailmasters']);
    for (const b of EVAL_BRANDS) expect(b.recipe.components.length).toBeGreaterThan(0);
    expect(pickFixtures(['stat-led', 'tips-list']).map((f) => f.id)).toEqual(['tips-list', 'stat-led']);
    expect(pickBrands().map((b) => b.id)).toEqual(['dynatos', 'detailmasters']);
    expect(() => pickFixtures(['nope'])).toThrow(/unknown fixture/);
    expect(() => pickBrands(['nope'])).toThrow(/unknown brand/);
  });
});
