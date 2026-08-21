import { describe, it, expect, vi } from 'vitest';

/**
 * Runner smoke tests — the ai boundary is mocked (same pattern as
 * compose.test.ts), so the REAL parse plumbing, composeSlide pipeline
 * (sanitise → prune → verbatim/slot guards) and all eval metrics run over
 * canned model replies. Proves the report shape, the warning capture, the
 * offender ranking and the baseline diff math without spending a cent.
 */
const mocks = vi.hoisted(() => ({
  parseText: '',
  fragments: {} as Record<string, string>,
}));

vi.mock('../lib/ai', () => {
  // The system is now cached BLOCK ARRAYS (see cachedSystemLayers) — flatten to
  // what the model actually reads before matching on it.
  const flat = (sys: unknown): string =>
    typeof sys === 'string'
      ? sys
      : Array.isArray(sys)
        ? sys.map((b) => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '')).join('\n')
        : '';
  const canned = (params: { system?: unknown; messages?: Array<{ content?: unknown }> }) => {
    const system = flat(params.system);
    const user = String(params.messages?.[0]?.content ?? '');
    return system.startsWith('You are a social-carousel copywriter')
      ? mocks.parseText
      : (mocks.fragments[user.match(/^\s*role: (\w+)$/m)?.[1] ?? ''] ??
        '<div class="headline">missing test fragment</div>');
  };
  const cacheBlock = (text: string) => ({ type: 'text', text, cache_control: { type: 'ephemeral' } });
  return {
    cachedSystem: (staticPart: string, dynamicPart?: string) =>
      dynamicPart ? [cacheBlock(staticPart), { type: 'text', text: dynamicPart }] : [cacheBlock(staticPart)],
    cachedSystemLayers: (...parts: string[]) => parts.filter(Boolean).map(cacheBlock),
    aiMessage: async (params: { system?: unknown; messages?: Array<{ content?: unknown }> }) => ({
      content: [{ type: 'text', text: canned(params) }],
    }),
    // The parse step forces a tool: its canned JSON reply stands in for the
    // tool's `input`, exactly as a real reply's tool_use block would.
    aiJson: async (params: { system?: unknown; messages?: Array<{ content?: unknown }> }) => {
      const text = canned(params);
      try {
        return { json: JSON.parse(text) as Record<string, unknown>, text };
      } catch {
        return { text };
      }
    },
    textOf: (resp: { content: Array<{ type: string; text?: string }> }) =>
      resp.content.find((c) => c.type === 'text')?.text ?? '',
    modelFor: async () => 'test-model',
  };
});

const { runEval, parseArgs, buildUnits, buildMarkdownSummary, worstOffenders, USAGE } = await import('./run');
const { pickFixtures, pickBrands } = await import('./fixtures');
const { PROMPT_VERSION } = await import('../lib/promptVersion');
const { diffAggregates, formatDiffTable } = await import('./metrics');

const silent = () => {};

describe('runEval (mocked ai boundary)', () => {
  it('produces a deterministic, fully-shaped report on a clean deck', async () => {
    mocks.parseText = JSON.stringify({
      slides: [
        { role: 'cover', image: true, parts: { eyebrow: 'Prepaid packages', headline: 'Get paid before you lift a finger.' } },
        { role: 'list', parts: { headline: 'Four things change', rows: [{ text: 'Cash lands first' }, { text: 'Repeat visits secured' }] } },
        { role: 'cta', parts: { headline: 'Book the demo', cta: 'See how it works' } },
      ],
    });
    mocks.fragments = {
      cover:
        '<div class="eyebrow">Prepaid packages</div><div class="headline">Get paid before you lift a finger.</div>' +
        '<figure class="cb-shot" data-cb-slot="hero"></figure>',
      list:
        '<div class="headline">Four things change</div><div class="panel">' +
        '<div class="row"><span class="tick"></span>Cash lands first</div>' +
        '<div class="row"><span class="tick"></span>Repeat visits secured</div></div>',
      cta: '<div class="headline">Book the demo</div><div class="cta">See how it works</div>',
    };

    const report = await runEval({
      fixtures: pickFixtures(['tips-list']),
      brands: pickBrands(['dynatos']),
      repeat: 2,
      concurrency: 2,
      model: 'claude-haiku-test',
      log: silent,
    });

    // report shape + deterministic ordering (rep 1 before rep 2, even concurrent)
    expect(report.meta).toMatchObject({
      model: 'claude-haiku-test',
      fixtures: ['tips-list'],
      brands: ['dynatos'],
      repeat: 2,
      concurrency: 2,
      runs: 2,
      calls: 8, // 2 × (1 parse + 3 composes)
    });
    expect(typeof report.meta.generatedAt).toBe('string');
    // the prompt versions this run exercised travel WITH the report, so a
    // regression can be pinned to a specific prompt edit rather than a date
    expect(report.meta.promptVersion).toEqual({
      parse: PROMPT_VERSION.parse,
      compose: PROMPT_VERSION.compose,
    });
    expect(buildMarkdownSummary(report)).toContain(
      `- prompts: parse v${PROMPT_VERSION.parse} · compose v${PROMPT_VERSION.compose}`,
    );
    // …and it is metadata only: no metric, and nothing the baseline diff reads
    expect(Object.keys(report.aggregate)).not.toContain('promptVersion');
    expect(report.runs.map((r) => [r.fixture, r.brand, r.rep])).toEqual([
      ['tips-list', 'dynatos', 1],
      ['tips-list', 'dynatos', 2],
    ]);

    const run = report.runs[0]!;
    expect(run.error).toBeUndefined();
    expect(run.parse!.roles).toEqual(['cover', 'list', 'cta']);
    expect(run.parse!.budget).toEqual([]);
    expect(run.parse!.shape).toEqual([]);
    expect(run.slides).toHaveLength(3);
    expect(run.slides[0]!.metrics.slots).toEqual(['hero']);
    expect(run.slides[0]!.metrics.slotIssue).toBeUndefined();
    for (const s of run.slides) {
      expect(s.metrics.verbatimMissing).toEqual([]);
      expect(s.metrics.dedupe.changed).toBe(false);
      expect(s.metrics.sanitizer.changed).toBe(false);
      expect(s.html.length).toBe(s.metrics.fragmentChars);
    }
    expect(run.warnings).toEqual({ droppedDuplicates: 0, droppedSpacers: 0, strippedInline: 0, verbatimMissing: 0 });

    expect(report.aggregate).toMatchObject({
      runs: 2,
      errors: 0,
      slides: 6,
      calls: 8,
      budgetViolations: 0,
      roleShapeViolations: 0,
      verbatimViolations: 0,
      dedupeGuardHits: 0,
      sanitizerDeltas: 0,
      slotViolations: 0,
    });
    expect(report.aggregate.estCostUsd).toBeGreaterThan(0);
    expect(worstOffenders(report.runs)).toEqual([]);

    // COMPOSE-BY-EXAMPLE, reported additively. The reference brands carry no
    // reference fragments, so every slide took the model path and says so —
    // which is also the baseline every future fragments run is measured against.
    expect(report.runs.every((r) => r.slides.every((s) => s.source === 'ai'))).toBe(true);
    expect(report.aggregate.fragmentSlides).toBe(0);
    expect(report.aggregate.aiSlides).toBe(6);
    expect(buildMarkdownSummary(report)).toContain(
      '- composition: 0 slide(s) substituted from recipe fragments · 6 composed by the model',
    );
    expect(buildMarkdownSummary(report)).toContain('| fragmentSlides | 0 |');
  });

  it('catches shape, verbatim, slot and composer-dedupe failures', async () => {
    const longHeadline = 'H'.repeat(70); // parse budget violation (60)
    const rows = ['Cash lands before the work begins.', 'Repeat visits secured in advance.'];
    mocks.parseText = JSON.stringify({
      slides: [
        { role: 'cover', image: true, parts: { headline: longHeadline } },
        { role: 'list', parts: { body: rows.join(' '), rows: rows.map((text) => ({ text })) } },
        { role: 'statement', parts: { headline: 'The end', cta: 'Book now' } }, // last is not a cta
      ],
    });
    mocks.fragments = {
      // photo slide without a hole — composeSlide appends its DEFAULT_SLOT
      cover: `<div class="headline">${longHeadline}</div>`,
      // says the same thing twice + leaves empty <em> stubs → the composer's own
      // pruning guards fire (observed through the captured console.warn lines)
      list:
        `<div class="body">${rows.join(' ')}</div><div class="panel">` +
        rows.map((r) => `<div class="row"><span class="tick"></span>${r}<em></em></div>`).join('') +
        '</div>',
      // drops the cta copy AND leaves a slot on a non-photo slide
      statement: '<div class="headline">The end</div><figure class="cb-shot" data-cb-slot="rogue"></figure>',
    };

    const report = await runEval({
      fixtures: pickFixtures(['promo-price']),
      brands: pickBrands(['detailmasters']),
      repeat: 1,
      concurrency: 1,
      model: 'claude-haiku-test',
      log: silent,
    });

    const run = report.runs[0]!;
    // the parse-side metrics.
    // The 70-char headline IS over the 60-char budget, but parseForCompose now
    // re-parses once and then clamps deterministically, so nothing over-budget
    // survives into its output. Reading 0 here is the guard working — a nonzero
    // count would mean the mechanical clamp had sprung a leak. (The clamp's own
    // mechanics are covered in compose.test.ts's "parse budgets enforced in code".)
    expect(run.parse!.budget).toEqual([]);
    expect(run.parse!.shape).toEqual([{ type: 'last-not-cta', role: 'statement' }]);
    // composeSlide plugged the missing hole on the photo slide
    expect(run.slides[0]!.metrics.slots).toEqual(['photo']);
    expect(run.slides[0]!.metrics.slotIssue).toBeUndefined();
    // the duplicated paragraph was pruned in-flight and reported via console.warn
    expect(run.warnings).toEqual({ droppedDuplicates: 1, droppedSpacers: 0, strippedInline: 2, verbatimMissing: 1 });
    expect(run.rawWarnings.some((w) => w.includes('dropped duplicated'))).toBe(true);
    expect(run.slides[1]!.html).not.toContain('class="body"');
    expect(run.slides[1]!.metrics.dedupe.changed).toBe(false); // final fragment is clean
    // The composer dropped the cta copy — but the verbatim guard now retries and
    // then splices the missing part back in, so the FINAL fragment carries it and
    // the metric reads clean. The warning below is what records that it happened.
    expect(run.slides[2]!.metrics.verbatimMissing).toEqual([]);
    expect(run.slides[2]!.html).toContain('Book now');
    expect(run.slides[2]!.metrics.slotIssue).toBe('unexpected-slot');

    expect(report.aggregate).toMatchObject({
      budgetViolations: 0,
      roleShapeViolations: 1,
      // 0 because the guard repaired it; composerVerbatimWarnings below is the
      // signal that the composer misbehaved in the first place.
      verbatimViolations: 0,
      slotViolations: 1,
      composerDroppedDuplicates: 1,
      composerStrippedInline: 2,
      composerVerbatimWarnings: 1,
      errors: 0,
    });

    const offenders = worstOffenders(report.runs);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.key).toBe('promo-price × detailmasters');
    expect(offenders[0]!.detail).toContain('slot');

    const md = buildMarkdownSummary(report);
    expect(md).toContain('# Compose eval');
    expect(md).toContain('| runs | 1 |');
    expect(md).toContain('## Worst offenders');
    expect(md).toContain('promo-price × detailmasters');
  });

  it('records a failed unit as an error instead of aborting the run', async () => {
    mocks.parseText = 'complete garbage, no json here';
    mocks.fragments = {};
    const report = await runEval({
      fixtures: pickFixtures(['adversarial']),
      brands: pickBrands(['dynatos']),
      repeat: 1,
      concurrency: 1,
      model: 'claude-haiku-test',
      log: silent,
    });
    const run = report.runs[0]!;
    expect(run.error).toMatch(/no JSON object/);
    expect(run.slides).toEqual([]);
    expect(report.aggregate.errors).toBe(1);
    expect(report.aggregate.calls).toBe(1); // the failed parse attempt still cost a call
    const md = buildMarkdownSummary(report);
    expect(md).toContain('## Errors');
    expect(md).toContain('adversarial × dynatos');
  });
});

describe('baseline diff math (as the runner applies it)', () => {
  it('diffs a current report against a stored baseline aggregate', async () => {
    mocks.parseText = JSON.stringify({
      slides: [
        { role: 'cover', parts: { headline: 'A clean start' } },
        { role: 'cta', parts: { headline: 'The end', cta: 'Go' } },
      ],
    });
    mocks.fragments = {
      cover: '<div class="headline">A clean start</div>',
      cta: '<div class="headline">The end</div><div class="cta">Go</div>',
    };
    const report = await runEval({
      fixtures: pickFixtures(['stat-led']),
      brands: pickBrands(['dynatos']),
      repeat: 1,
      concurrency: 1,
      model: 'claude-haiku-test',
      log: silent,
    });

    // pretend the last run had 3 verbatim misses and one more slot violation
    const baseline = { ...report.aggregate, verbatimViolations: 3, slotViolations: 1 };
    const rows = diffAggregates(baseline, report.aggregate);
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r]));
    expect(byMetric['verbatimViolations']).toMatchObject({ baseline: 3, current: 0, delta: -3 });
    expect(byMetric['slotViolations']).toMatchObject({ baseline: 1, current: 0, delta: -1 });
    expect(byMetric['runs']).toMatchObject({ delta: 0 });

    const table = formatDiffTable(rows);
    expect(table).toMatch(/verbatimViolations\s+3\s+0\s+-3/);
  });
});

describe('parseArgs / buildUnits', () => {
  it('parses the full flag set', () => {
    expect(
      parseArgs([
        '--fixtures', 'tips-list,promo-price',
        '--brands', 'dynatos',
        '--repeat', '3',
        '--out', 'my-reports',
        '--baseline', 'eval-reports/old.json',
        '--concurrency', '4',
        '--yes',
      ]),
    ).toEqual({
      fixtures: ['tips-list', 'promo-price'],
      brands: ['dynatos'],
      repeat: 3,
      out: 'my-reports',
      baseline: 'eval-reports/old.json',
      concurrency: 4,
      yes: true,
      help: false,
    });
  });

  it('defaults to the whole matrix, serial, one repeat, no auto-yes', () => {
    expect(parseArgs([])).toEqual({ repeat: 1, concurrency: 1, yes: false, help: false });
  });

  it('rejects unknown flags and bad numbers', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['--repeat', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--concurrency', 'many'])).toThrow(/positive integer/);
    expect(USAGE).toContain('--baseline');
  });

  it('orders units fixture → brand → rep, deterministically', () => {
    const units = buildUnits(pickFixtures(['tips-list', 'promo-price']), pickBrands(), 2);
    expect(units.map((u) => `${u.fixture.id}/${u.brand.id}/${u.rep}`)).toEqual([
      'tips-list/dynatos/1',
      'tips-list/dynatos/2',
      'tips-list/detailmasters/1',
      'tips-list/detailmasters/2',
      'promo-price/dynatos/1',
      'promo-price/dynatos/2',
      'promo-price/detailmasters/1',
      'promo-price/detailmasters/2',
    ]);
  });
});
