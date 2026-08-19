import { asVerdict, repairLayout, layoutFaults, withCeiling, type LayoutVerdict } from './renderCheck';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * NO WEB SERVER, NO BROWSER, NO DATABASE, NO NETWORK.
 *
 * Everything real about this module is string work and control flow; the only
 * things it needs from outside are (a) a rig that renders a fragment and reports
 * whether it overflowed, and (b) the AI layer, for the last rung of the ladder.
 * Both are seams:
 *
 *   · the rig is the injectable `openProbe` — tests pass a scripted fake, so no
 *     Puppeteer page is ever opened and no throwaway project is ever written
 *     (the same boundary `exporter`/`verifyRecipe` would be mocked at);
 *   · `../ai` is stubbed exactly as compose.test.ts stubs it, so the step-3
 *     re-compose runs the REAL `composeSlide` against a scripted reply.
 *
 * The renderer-unreachable path is therefore tested deliberately (a probe that
 * throws) rather than by accident (a machine that happens to have no web server).
 */
const reply = vi.fn<(params: Anthropic.MessageCreateParamsNonStreaming) => string>(() => '');
const aiCalls: Anthropic.MessageCreateParamsNonStreaming[] = [];

vi.mock('../ai', () => ({
  aiMessage: async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    aiCalls.push(params);
    return { content: [{ type: 'text', text: reply(params) }] } as unknown as Anthropic.Message;
  },
  textOf: (resp: Anthropic.Message): string => {
    const part = resp.content.find((c) => c.type === 'text');
    return part && 'text' in part ? part.text : '';
  },
  modelFor: async () => 'test-model',
}));

const {
  addHeadlineVariant,
  checkSlideOverflow,
  dropLeastEssential,
  hasSmallerHeadlineVariant,
  renderCheckDeck,
  renderCheckEnabledByDefault,
  repairOverflow,
  OVERFLOW_NOTE,
} = await import('./renderCheck');
const { detailMastersRecipe, dynatosRecipe } = await import('./recipes');

type OverflowState = 'fits' | 'overflows' | 'unknown';

/**
 * A scripted rig. `script` answers "what does slide `index` look like now?" from
 * the fragment it was handed, so a test can say "overflows until the headline
 * goes small". Every fragment it was asked about is recorded.
 */
function fakeProbe(script: (html: string, index: number, nth: number) => OverflowState) {
  const seen: Array<{ index: number; html: string }> = [];
  let closed = 0;
  let nth = 0;
  const openProbe = async () => ({
    async measure(items: readonly { index: number; html: string }[]) {
      return items.map((item) => {
        seen.push({ ...item });
        return asVerdict(script(item.html, item.index, nth++));
      });
    },
    async close() {
      closed += 1;
    },
  });
  return { openProbe, seen, closed: () => closed };
}

const input = (over: Partial<{ role: string; index: number; format: string }> = {}) =>
  ({
    role: (over.role ?? 'feature') as never,
    parts: { headline: 'Get paid before you lift a finger.' },
    format: over.format ?? '1080x1350',
    index: over.index ?? 0,
  }) as never;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  aiCalls.length = 0;
});
afterEach(() => {
  warn.mockRestore();
  reply.mockReset();
});
const warnings = () => warn.mock.calls.map((c) => String(c[0]));

// ── The default ─────────────────────────────────────────────────────────────

describe('the default', () => {
  it('is OFF under a test runner, so nothing here needs a web server', () => {
    expect(process.env.VITEST || process.env.NODE_ENV === 'test').toBeTruthy();
    expect(renderCheckEnabledByDefault()).toBe(false);
  });

  it('can be forced on or off with COMPOSE_RENDER_CHECK', () => {
    const prev = process.env.COMPOSE_RENDER_CHECK;
    try {
      process.env.COMPOSE_RENDER_CHECK = '1';
      expect(renderCheckEnabledByDefault()).toBe(true);
      process.env.COMPOSE_RENDER_CHECK = 'off';
      expect(renderCheckEnabledByDefault()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.COMPOSE_RENDER_CHECK;
      else process.env.COMPOSE_RENDER_CHECK = prev;
    }
  });
});

// ── Step 1: the recipe's own size control ───────────────────────────────────

describe('step 1 — the smaller-headline variant', () => {
  it('adds .sm to the headline element', () => {
    const out = addHeadlineVariant('<div class="headline">Get paid before you lift a finger.</div>');
    expect(out.changed).toBe(true);
    expect(out.html).toBe('<div class="headline sm">Get paid before you lift a finger.</div>');
  });

  it('finds a headline the tweak endpoint’s regex misses', () => {
    // `class="headline(?! sm)([^"]*)"` only fires when `headline` is FIRST and
    // the attribute is double-quoted. Both of these are real headlines.
    expect(addHeadlineVariant('<h1 class="lead headline">Big</h1>').html).toBe(
      '<h1 class="lead headline sm">Big</h1>',
    );
    expect(addHeadlineVariant("<h1 class='headline'>Big</h1>").html).toBe("<h1 class='headline sm'>Big</h1>");
  });

  it('leaves an already-small headline byte-identical', () => {
    const html = '<div class="headline sm">Already small</div>';
    const out = addHeadlineVariant(html);
    expect(out.changed).toBe(false);
    expect(out.html).toBe(html);
  });

  it('touches nothing else on the slide', () => {
    const html = '<div class="eyebrow">Kicker</div><div class="body">A sentence.</div><div class="fill"></div>';
    expect(addHeadlineVariant(html)).toEqual({ html, changed: false });
  });

  it('only fires for recipes that actually style the variant', () => {
    expect(hasSmallerHeadlineVariant(detailMastersRecipe)).toBe(true);
    expect(hasSmallerHeadlineVariant(dynatosRecipe)).toBe(true);
    const bare = { ...detailMastersRecipe, stylesheet: '.cb-slide{color:red}', components: [] };
    expect(hasSmallerHeadlineVariant(bare as never)).toBe(false);
  });
});

// ── Step 2: the sacrifice ladder ────────────────────────────────────────────

describe('step 2 — dropping the least essential block', () => {
  it('takes the decoration first: .rule goes before any copy does', () => {
    const html =
      '<div class="eyebrow">Kicker</div>' +
      '<div class="headline">A line</div>' +
      '<div class="rule"></div>' +
      '<div class="body">A supporting sentence.</div>' +
      '<div class="panel"><div class="row">One</div><div class="row">Two</div></div>';
    const out = dropLeastEssential(html, detailMastersRecipe, input());
    expect(out.dropped).toBe('div.rule');
    expect(out.html).not.toContain('class="rule"');
    expect(out.html).toContain('class="body"');
    expect(out.html).toContain('class="panel"');
  });

  it('then the paragraph, because the panel of rows already says it', () => {
    const html =
      '<div class="headline">A line</div>' +
      '<div class="body">A supporting sentence.</div>' +
      '<div class="panel"><div class="row">One</div><div class="row">Two</div></div>';
    const out = dropLeastEssential(html, detailMastersRecipe, input());
    expect(out.dropped).toBe('div.body');
    expect(out.html).toContain('class="panel"');
    expect(out.html).toContain('class="headline"');
  });

  it('keeps a .body that is the slide’s only prose — that is not furniture', () => {
    const html = '<div class="headline">A line</div><div class="body">A supporting sentence.</div>';
    expect(dropLeastEssential(html, detailMastersRecipe, input())).toEqual({ html });
  });

  it('never drops the headline, the eyebrow, the cta or the photo slot', () => {
    const html =
      '<div class="eyebrow">Kicker</div>' +
      '<div class="headline">A line</div>' +
      '<figure class="cb-shot" data-cb-slot="hero"></figure>' +
      '<div class="cta">Book now</div>';
    expect(dropLeastEssential(html, detailMastersRecipe, input())).toEqual({ html });
  });

  it('sacrifices what the slide’s composition pattern never asked for first', () => {
    // The detailmasters `feature` variant at index 0 is
    // "eyebrow → headline(.it) → rule → body → fill → panel" — it names the rule
    // but not the tagline, so the tagline is the furniture the pattern didn't
    // require even though it outranks the rule on the ladder.
    const html =
      '<div class="headline">A line</div>' +
      '<div class="rule"></div>' +
      '<div class="tagline">One decision, repeated.</div>';
    const out = dropLeastEssential(html, detailMastersRecipe, input({ role: 'feature', index: 0 }));
    expect(out.dropped).toBe('div.tagline');
    expect(out.html).toContain('class="rule"');
  });

  it('never takes the last words on the slide', () => {
    const html = '<div class="tagline">One decision, repeated.</div>';
    expect(dropLeastEssential(html, detailMastersRecipe, input())).toEqual({ html });
  });

  it('never guts a list — the rows ARE the slide, however long they run', () => {
    // The real failure: "Five habits that shorten the life" shipped with the
    // five habits dropped, leaving a promise over blank canvas. An eyebrow and
    // a headline are labels, not substance, so the panel has nothing to fall
    // back on and the ladder must climb to the re-compose instead.
    const html =
      '<div class="eyebrow">Coating killers</div>' +
      '<div class="headline sm">Five habits that shorten the life</div>' +
      '<div class="panel"><div class="row">Brush washes</div><div class="row">Direct sun</div></div>';
    expect(dropLeastEssential(html, detailMastersRecipe, input({ role: 'list' }))).toEqual({ html });
  });

  it('still drops the paragraph beside a panel — the rows say it better', () => {
    const html =
      '<div class="headline">A line</div>' +
      '<div class="body">Brush washes, direct sun, and bird droppings.</div>' +
      '<div class="panel"><div class="row">Brush washes</div><div class="row">Direct sun</div></div>';
    expect(dropLeastEssential(html, detailMastersRecipe, input({ role: 'list' })).dropped).toBe('div.body');
  });
});

// ── checkSlideOverflow ──────────────────────────────────────────────────────

describe('checkSlideOverflow', () => {
  it('reports what the render measured, per slide', async () => {
    const { openProbe } = fakeProbe((_html, index) => (index === 1 ? 'overflows' : 'fits'));
    const out = await checkSlideOverflow(
      detailMastersRecipe,
      [{ html: '<div class="headline">A</div>' }, { html: '<div class="headline">B</div>' }],
      '1080x1350',
      { openProbe },
    );
    expect(out).toMatchObject([
      { overflows: false, state: 'fits' },
      { overflows: true, state: 'overflows' },
    ]);
  });

  it('returns unknown for every slide when the renderer is unreachable, and warns once', async () => {
    const openProbe = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3100');
    };
    const out = await checkSlideOverflow(
      detailMastersRecipe,
      [{ html: '<div class="headline">A</div>' }, { html: '<div class="headline">B</div>' }],
      '1080x1350',
      { openProbe },
    );
    expect(out).toMatchObject([
      { overflows: false, state: 'unknown' },
      { overflows: false, state: 'unknown' },
    ]);
    expect(warnings().filter((w) => w.includes('renderer unavailable'))).toHaveLength(1);
  });

  it('closes the rig even when measuring blows up', async () => {
    let closed = 0;
    const openProbe = async () => ({
      measure: async () => {
        throw new Error('page crashed');
      },
      close: async () => {
        closed += 1;
      },
    });
    const out = await checkSlideOverflow(detailMastersRecipe, [{ html: '<p>x</p>' }], '1080x1350', {
      openProbe,
    });
    expect(out).toMatchObject([{ overflows: false, state: 'unknown' }]);
    // The full measurement rides along, so one pass answers every layout question.
    expect(out[0]).toHaveProperty('layout');
    expect(closed).toBe(1);
  });

  it('measures nothing for an empty deck', async () => {
    const { openProbe } = fakeProbe(() => 'fits');
    expect(await checkSlideOverflow(detailMastersRecipe, [], '1080x1350', { openProbe })).toEqual([]);
  });
});

// ── The ladder, end to end ──────────────────────────────────────────────────

describe('repairOverflow — the escalation ladder', () => {
  const SLIDE =
    '<div class="eyebrow">Prepaid packages</div>' +
    '<div class="headline">Get paid before you lift a finger.</div>' +
    '<div class="rule"></div>' +
    '<div class="body">The money lands while the diary fills itself.</div>' +
    '<div class="panel"><div class="row">One</div><div class="row">Two</div></div>';

  it('stops at step 1 when the smaller headline fits — and costs no model call', async () => {
    const measured: string[] = [];
    const out = await repairOverflow(detailMastersRecipe, input(), SLIDE, '1080x1350', {
      measure: async (html) => {
        measured.push(html);
        return 'fits';
      },
    });
    expect(out.steps).toEqual(['smaller-headline']);
    expect(out.html).toContain('class="headline sm"');
    expect(out.html).toContain('class="rule"'); // nothing was dropped
    expect(out.stillOverflows).toBe(false);
    expect(out.aiCalls).toBe(0);
    expect(aiCalls).toHaveLength(0);
    expect(measured).toHaveLength(1); // exactly one re-render
  });

  it('falls to step 2 and drops the rule when the smaller headline is not enough', async () => {
    let call = 0;
    const out = await repairOverflow(detailMastersRecipe, input(), SLIDE, '1080x1350', {
      measure: async () => (++call === 1 ? 'overflows' : 'fits'),
    });
    expect(out.steps).toEqual(['smaller-headline', 'dropped']);
    expect(out.dropped).toBe('div.rule');
    expect(out.html).toContain('class="headline sm"');
    expect(out.html).not.toContain('class="rule"');
    expect(out.stillOverflows).toBe(false);
    expect(out.aiCalls).toBe(0);
    expect(aiCalls).toHaveLength(0); // still entirely free
  });

  it('re-composes ONCE, naming the overflow, only after both free steps fail', async () => {
    reply.mockReturnValue('<div class="headline">Get paid before you lift a finger.</div>');
    let call = 0;
    const out = await repairOverflow(detailMastersRecipe, input(), SLIDE, '1080x1350', {
      // overflows for step 1 and step 2; the re-composed fragment fits
      measure: async () => (++call <= 2 ? 'overflows' : 'fits'),
    });
    expect(out.steps).toEqual(['smaller-headline', 'dropped', 'recomposed']);
    expect(out.stillOverflows).toBe(false);
    expect(out.aiCalls).toBe(1);

    // exactly one model call, and it names the failure in the user message
    expect(aiCalls).toHaveLength(1);
    const user = typeof aiCalls[0]!.messages[0]?.content === 'string' ? aiCalls[0]!.messages[0]!.content : '';
    expect(user).toContain('the previous composition overflowed the canvas — use fewer elements; the copy is fixed');
    expect(user).toContain(OVERFLOW_NOTE);
    // the copy parts are still in the message — this is a re-arrangement, not a rewrite
    expect(user).toContain('Get paid before you lift a finger.');
    expect(out.html).toContain('Get paid before you lift a finger.');
  });

  it('keeps the least crowded attempt and flags a slide nothing could fix', async () => {
    reply.mockReturnValue(
      '<div class="headline">Get paid before you lift a finger.</div><div class="body">Still too much.</div>',
    );
    const out = await repairOverflow(detailMastersRecipe, input(), SLIDE, '1080x1350', {
      measure: async () => 'overflows',
    });
    expect(out.steps).toEqual(['smaller-headline', 'dropped', 'recomposed']);
    expect(out.stillOverflows).toBe(true);
    expect(out.aiCalls).toBe(1);
    // the re-compose came back with the fewest blocks, so that is what survives
    expect(out.html).toContain('Still too much.');
  });

  it('stops climbing — and never pays for a call — when the renderer goes dark', async () => {
    const out = await repairOverflow(detailMastersRecipe, input(), SLIDE, '1080x1350', {
      measure: async () => 'unknown',
    });
    expect(out.steps).toEqual(['smaller-headline']);
    expect(out.stillOverflows).toBe(false);
    expect(aiCalls).toHaveLength(0);
  });

  it('survives a re-compose that throws, keeping the deterministic repair', async () => {
    const out = await repairOverflow(detailMastersRecipe, input(), SLIDE, '1080x1350', {
      measure: async () => 'overflows',
      recompose: async () => {
        throw new Error('model overloaded');
      },
    });
    expect(out.stillOverflows).toBe(true);
    expect(out.aiCalls).toBe(0);
    expect(out.html).toContain('class="headline sm"');
    expect(out.html).not.toContain('class="rule"');
    expect(warnings().some((w) => w.includes('re-compose failed'))).toBe(true);
  });
});

// ── The deck pass ───────────────────────────────────────────────────────────

describe('renderCheckDeck', () => {
  const deck = [
    { html: '<div class="headline">One</div>' },
    { html: '<div class="headline">Two</div><div class="rule"></div>' },
    { html: '<div class="headline">Three</div>' },
  ];

  it('leaves a clean deck byte-identical and spends nothing', async () => {
    const { openProbe, seen, closed } = fakeProbe(() => 'fits');
    const out = await renderCheckDeck(detailMastersRecipe, [], deck, '1080x1350', { openProbe });
    expect(out.slides.map((s) => s.html)).toEqual(deck.map((s) => s.html));
    expect(out.overflowed).toBe(0);
    expect(out.aiCalls).toBe(0);
    expect(seen).toHaveLength(3); // one render each, no repairs
    expect(closed()).toBe(1);
    // Reworded when the layout gates joined: 'nothing overflowed' stopped
    // being the same statement as 'nothing is wrong'.
    expect(warnings().some((w) => w.includes('nothing to repair'))).toBe(true);
  });

  it('repairs only the slide that overflows and reports a summary', async () => {
    // Slide 2 overflows on the first pass; whatever comes back next fits.
    const answered = new Map<number, number>();
    const { openProbe } = fakeProbe((_html, index) => {
      const n = (answered.get(index) ?? 0) + 1;
      answered.set(index, n);
      return index === 1 && n === 1 ? 'overflows' : 'fits';
    });
    const out = await renderCheckDeck(detailMastersRecipe, [], deck, '1080x1350', { openProbe });
    expect(out.overflowed).toBe(1);
    expect(out.repaired).toBe(1);
    expect(out.unresolved).toEqual([]);
    expect(out.aiCalls).toBe(0);
    expect(out.slides[0]!.html).toBe(deck[0]!.html); // untouched
    expect(out.slides[2]!.html).toBe(deck[2]!.html);
    expect(out.slides[1]!.html).toContain('class="headline sm"');
    expect(warnings().some((w) => w.includes('1 overflowed · 1 repaired'))).toBe(true);
  });

  it('ships the deck untouched when the renderer is unreachable', async () => {
    const out = await renderCheckDeck(detailMastersRecipe, [], deck, '1080x1350', {
      openProbe: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(out.slides.map((s) => s.html)).toEqual(deck.map((s) => s.html));
    expect(out.measured).toBe(0);
    expect(warnings().filter((w) => w.includes('deck ships unchecked'))).toHaveLength(1);
  });

  it('flags what it could not fix instead of pretending', async () => {
    reply.mockReturnValue('<div class="headline">Two</div>');
    const { openProbe } = fakeProbe((_html, index) => (index === 1 ? 'overflows' : 'fits'));
    const out = await renderCheckDeck(detailMastersRecipe, [], deck, '1080x1350', { openProbe });
    expect(out.unresolved).toEqual([1]);
    expect(out.repaired).toBe(0);
    expect(out.aiCalls).toBe(1);
    expect(warnings().some((w) => w.includes('STILL OVERFLOWS'))).toBe(true);
  });
});

// ── The layout ladder ────────────────────────────────────────────────────────
describe('repairLayout — the bidirectional ladder', () => {
  const HTML = '<div class="headline">A headline</div>\n<div class="body">Body</div>';
  const input = { role: 'statement' as const, parts: {}, format: '1080x1350' as const, index: 0 };
  const v = (over: Partial<LayoutVerdict>): LayoutVerdict => ({
    state: 'fits', collide: false, slack: 0, headlineLines: 2, ...over,
  });

  it('does nothing when the slide is clean', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({}), 3, {
      measure: async () => { throw new Error('must not measure a clean slide'); },
    });
    expect(out.steps).toEqual([]);
    expect(out.remaining).toEqual([]);
    expect(out.html).toBe(HTML);
  });

  /**
   * The case the overflow guard was blind to: a headline resting on the CTA
   * chip has not left the frame, so `state` is 'fits' and only `collide` fires.
   */
  it('shrinks for a collision even though nothing overflowed', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ collide: true }), 3, {
      measure: async () => v({ collide: false }),
    });
    expect(out.steps).toEqual(['smaller-headline']);
    expect(out.remaining).toEqual([]);
    expect(out.html).toContain('headline sm');
  });

  it('shrinks for a headline over its archetype cap', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ headlineLines: 5 }), 3, {
      measure: async () => v({ headlineLines: 3 }),
    });
    expect(out.steps).toEqual(['smaller-headline']);
    expect(out.remaining).toEqual([]);
  });

  it('grows into excess slack — the direction the overflow ladder never had', async () => {
    const small = '<div class="headline sm">A headline</div>';
    const out = await repairLayout(detailMastersRecipe, input, small, v({ slack: 0.6 }), 3, {
      measure: async () => v({ slack: 0.1 }),
    });
    expect(out.steps).toEqual(['larger-headline']);
    expect(out.html).not.toContain('headline sm');
  });

  /**
   * Growing is the risky direction. A step that closes the hole by overflowing
   * has traded a visible fault for an invisible one.
   */
  it('refuses a grow that would overflow, and keeps the slack', async () => {
    const small = '<div class="headline sm">A headline</div>';
    const out = await repairLayout(detailMastersRecipe, input, small, v({ slack: 0.6 }), 3, {
      measure: async () => v({ slack: 0.05, state: 'overflows' }),
    });
    expect(out.steps).toEqual([]);
    expect(out.html).toBe(small);
    expect(out.remaining).toContain('slack 60%');
  });

  it('refuses a grow that would collide', async () => {
    const small = '<div class="headline sm">A headline</div>';
    const out = await repairLayout(detailMastersRecipe, input, small, v({ slack: 0.6 }), 3, {
      measure: async () => v({ slack: 0.05, collide: true }),
    });
    expect(out.steps).toEqual([]);
    expect(out.html).toBe(small);
  });

  it('keeps a shrink only when it reduces the fault count', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ collide: true }), 3, {
      // Fixes the collision but opens a hole — no net gain, so it is discarded.
      measure: async () => v({ collide: false, slack: 0.6 }),
    });
    expect(out.steps).toEqual([]);
    expect(out.html).toBe(HTML);
  });

  it('never spends a model call', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ collide: true }), 3, {
      measure: async () => v({}),
    });
    expect(out.aiCalls).toBe(0);
  });

  it('stops when the renderer has gone dark rather than guessing', async () => {
    const out = await repairLayout(
      detailMastersRecipe, input, HTML, v({ state: 'unknown', collide: true }), 3,
      { measure: async () => { throw new Error('must not measure'); } },
    );
    expect(out.steps).toEqual([]);
  });
});

describe('the rung that asks for more copy', () => {
  const input = {
    role: 'feature' as const,
    parts: { headline: 'Holds the most' },
    format: '1080x1350' as const,
    index: 0,
  };
  const v = (over: Partial<LayoutVerdict>): LayoutVerdict => ({
    state: 'fits', collide: false, slack: 0, headlineLines: 2, ...over,
  });
  const THIN = '<div class="headline">Holds the most</div><div class="fill"></div>';
  const FULLER = '<div class="headline">Holds the most</div><div class="body">And ruins the fastest.</div>';

  it('takes the richer copy when it measures better', async () => {
    const out = await repairLayout(detailMastersRecipe, input, THIN, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0.2 }),
      rewriteForFault: async () => FULLER,
    });
    expect(out.steps).toContain('said-more');
    expect(out.html).toBe(FULLER);
    expect(out.aiCalls).toBe(1);
  });

  it('keeps the original when the rewrite does not help', async () => {
    const out = await repairLayout(detailMastersRecipe, input, THIN, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0.7 }),
      rewriteForFault: async () => FULLER,
    });
    expect(out.steps).not.toContain('said-more');
    expect(out.html).toBe(THIN);
  });

  /**
   * The case that would make things worse. A slide that OVERFLOWS has too much
   * on it, and asking the copywriter for another line is the opposite of the
   * fix — so the rung reads the fault before it acts.
   */
  it('never asks for more copy on a slide that overflows', async () => {
    let asked = false;
    await repairLayout(detailMastersRecipe, input, THIN, v({ state: 'overflows', slack: 0.7 }), 3, {
      measure: async () => v({ state: 'overflows' }),
      rewriteForFault: async () => { asked = true; return FULLER; },
    });
    expect(asked).toBe(false);
  });

  it('never asks on a collision either — that is an arrangement fault', async () => {
    let asked = false;
    await repairLayout(detailMastersRecipe, input, THIN, v({ collide: true }), 3, {
      measure: async () => v({ collide: true }),
      rewriteForFault: async () => { asked = true; return FULLER; },
    });
    expect(asked).toBe(false);
  });

  it('runs before the rearrangement rung, because it addresses the cause', async () => {
    const order: string[] = [];
    await repairLayout(detailMastersRecipe, input, THIN, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0.7 }),
      rewriteForFault: async () => { order.push('wrote'); return null; },
      shoot: async () => { order.push('shot'); return 'png'; },
      repairByLooking: async () => { order.push('looked'); return null; },
    });
    expect(order).toEqual(['wrote', 'shot', 'looked']);
  });

  it('skips a slide the deterministic ladder already fixed', async () => {
    let asked = false;
    const out = await repairLayout(detailMastersRecipe, input, THIN, v({ slack: 0 }), 3, {
      measure: async () => v({}),
      rewriteForFault: async () => { asked = true; return FULLER; },
    });
    expect(out.remaining).toEqual([]);
    expect(asked).toBe(false);
  });

  /**
   * The failure this actually produced. Asked to fill an empty slide without
   * being told what it said, the copywriter returned the deck's COVER — lockup,
   * cover headline and all. It measured beautifully and was the wrong slide.
   */
  it('refuses a rewrite that lost the slide\'s headline, however well it measures', async () => {
    const COVER = '<div class="logo-row">detailmasters</div><div class="headline">The car came out spotless</div>';
    const out = await repairLayout(detailMastersRecipe, input, THIN, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0 }), // a perfect measurement
      rewriteForFault: async () => COVER,
    });
    expect(out.steps).not.toContain('said-more');
    expect(out.html).toBe(THIN);
  });

  it('does not run at all on a slide with no headline to anchor to', async () => {
    let asked = false;
    const noHeadline = { ...input, parts: {} };
    await repairLayout(detailMastersRecipe, noHeadline, THIN, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0.7 }),
      rewriteForFault: async () => { asked = true; return FULLER; },
    });
    expect(asked).toBe(false);
  });
});

describe('the rung after the ladder — looking at the slide', () => {
  const input = { role: 'feature' as const, parts: {}, format: '1080x1350' as const, index: 0 };
  const v = (over: Partial<LayoutVerdict>): LayoutVerdict => ({
    state: 'fits', collide: false, slack: 0, headlineLines: 2, ...over,
  });
  const HTML = '<div class="headline">A headline</div><div class="fill"></div>';
  const REARRANGED = '<div class="fill"></div><div class="headline">A headline</div>';

  it('takes the model\'s arrangement when it reduces the faults', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ slack: 0.7 }), 3, {
      // Nothing deterministic helps, so the ladder falls through to this.
      measure: async () => v({ slack: 0.1 }),
      shoot: async () => 'base64-png',
      repairByLooking: async () => ({ html: REARRANGED, change: 'moved the spacer above the headline' }),
    });
    expect(out.steps).toContain('looked-at-it');
    expect(out.html).toBe(REARRANGED);
    expect(out.remaining).toEqual([]);
    expect(out.aiCalls).toBe(1);
  });

  it('discards an arrangement that does not help', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0.7 }), // no better
      shoot: async () => 'base64-png',
      repairByLooking: async () => ({ html: REARRANGED, change: 'shuffled things' }),
    });
    expect(out.steps).not.toContain('looked-at-it');
    expect(out.html).toBe(HTML);
  });

  /**
   * The one failure that must never ship. Every string was written, budgeted
   * and checked long before this rung; a slide saying something nobody approved
   * is worse than the hole it was sent to fix.
   */
  it('refuses an arrangement that changed the words, however well it measures', async () => {
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0 }), // it would have "fixed" it perfectly
      shoot: async () => 'base64-png',
      repairByLooking: async () => ({ html: '<div class="headline">A better headline</div>', change: 'improved it' }),
    });
    expect(out.steps).not.toContain('looked-at-it');
    expect(out.html).toBe(HTML);
  });

  it('never runs when the probe cannot photograph', async () => {
    let asked = false;
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ slack: 0.7 }), 3, {
      measure: async () => v({ slack: 0.7 }),
      repairByLooking: async () => { asked = true; return null; },
    });
    expect(asked).toBe(false);
    expect(out.aiCalls).toBe(0);
  });

  it('spends nothing on a slide the ladder already fixed', async () => {
    let asked = false;
    const out = await repairLayout(detailMastersRecipe, input, HTML, v({ collide: true }), 3, {
      measure: async () => v({ collide: false }),
      shoot: async () => 'base64-png',
      repairByLooking: async () => { asked = true; return null; },
    });
    expect(out.remaining).toEqual([]);
    expect(asked).toBe(false);
    expect(out.aiCalls).toBe(0);
  });
});

describe('layoutFaults', () => {
  it('names every gate that fired, and nothing else', () => {
    expect(layoutFaults({ state: 'fits', collide: false, slack: 0.05, headlineLines: 2 }, 3)).toEqual([]);
    expect(
      layoutFaults({ state: 'overflows', collide: true, slack: 0.7, headlineLines: 6 }, 3),
    ).toEqual(['overflows', 'collision', 'slack 70%', 'headline 6 lines']);
  });

  it('holds a content role to a tighter hole than a display role', () => {
    // Measured across every shipped slide: a cover never sits below 51% slack,
    // because a cover IS a headline over space. The two worst `feature` slides
    // in that same sample, at 65.5%, are the ones that had to be hand-authored
    // into panels because they carried nothing.
    const hole = { state: 'fits' as const, collide: false, slack: 0.55, headlineLines: 2 };
    expect(layoutFaults(hole, undefined, 'cover')).toEqual([]);
    expect(layoutFaults(hole, undefined, 'cta')).toEqual([]);
    expect(layoutFaults(hole, undefined, 'feature')).toEqual(['slack 55%']);
    expect(layoutFaults(hole, undefined, 'statement')).toEqual(['slack 55%']);
    expect(layoutFaults(hole, undefined, 'list')).toEqual(['slack 55%']);
    // An unknown role gets the permissive limit — a gate that cries wolf is a
    // gate that gets ignored.
    expect(layoutFaults(hole, undefined, undefined)).toEqual([]);
    // Past the display limit, everything reports.
    const void_ = { ...hole, slack: 0.7 };
    expect(layoutFaults(void_, undefined, 'cover')).toEqual(['slack 70%']);
  });

  it('ignores the headline cap when the archetype does not set one', () => {
    expect(layoutFaults({ state: 'fits', collide: false, slack: 0, headlineLines: 9 }, undefined)).toEqual([]);
  });
});

describe('renderCheckDeck — the layout gates run too', () => {
  const CAP = '<div class="headline">A headline that runs long</div>';

  /**
   * The gap this closes: before it, the deck pass only ever looked at overflow,
   * so a slide could ship with a collision or a hole and nothing would run.
   */
  it('repairs a slide that fits but collides', async () => {
    let nth = 0;
    const openProbe = async () => ({
      async measure() {
        // First pass: fits, but two boxes are touching. After the shrink: clean.
        nth += 1;
        return [nth === 1
          ? { state: 'fits' as const, collide: true, slack: 0, headlineLines: 2 }
          : { state: 'fits' as const, collide: false, slack: 0, headlineLines: 2 }];
      },
      async close() {},
    });

    const out = await renderCheckDeck(
      detailMastersRecipe,
      [{ role: 'statement' as const, parts: {}, format: '1080x1350' as const, index: 0 }],
      [{ html: CAP, role: 'statement', archetype: 'statement' }],
      '1080x1350',
      { openProbe },
    );

    expect(out.slides[0]!.html).toContain('headline sm');
    expect(out.notes.join(' ')).toContain('smaller-headline');
  });

  it('reports a fault nothing could fix rather than shipping it silently', async () => {
    const openProbe = async () => ({
      // Never improves: the hole survives every attempt.
      async measure() {
        return [{ state: 'fits' as const, collide: false, slack: 0.62, headlineLines: 2 }];
      },
      async close() {},
    });

    const out = await renderCheckDeck(
      detailMastersRecipe,
      [{ role: 'statement' as const, parts: {}, format: '1080x1350' as const, index: 0 }],
      [{ html: CAP, role: 'statement', archetype: 'statement' }],
      '1080x1350',
      { openProbe },
    );

    expect(out.notes.join(' ')).toContain('UNFIXED');
    expect(out.notes.join(' ')).toContain('slack 62%');
  });

  it('leaves a clean slide untouched and spends no measurement on it', async () => {
    const openProbe = async () => ({
      async measure() {
        return [{ state: 'fits' as const, collide: false, slack: 0.05, headlineLines: 2 }];
      },
      async close() {},
    });

    const out = await renderCheckDeck(
      detailMastersRecipe,
      [{ role: 'statement' as const, parts: {}, format: '1080x1350' as const, index: 0 }],
      [{ html: CAP, role: 'statement', archetype: 'statement' }],
      '1080x1350',
      { openProbe },
    );

    expect(out.slides[0]!.html).toBe(CAP);
    expect(out.notes).toEqual([]);
  });
});

describe('withCeiling', () => {
  /**
   * The backstop behind the two awaits in a measurement that have no timeout of
   * their own — `pagePool.acquire()` and `page.evaluate`. Without it, either one
   * stalling leaves compose pending forever: no response, no slide saved, and
   * the scaffold's `finally` never runs, so a `__render-check-*` business leaks
   * too. A 45-minute stall that wrote nothing is what put this here.
   */
  it('passes a value straight through when the promise settles in time', async () => {
    await expect(withCeiling(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok')
  })

  it('propagates the original rejection rather than masking it as a timeout', async () => {
    await expect(withCeiling(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom')
  })

  it('rejects with the label and the budget when the promise never settles', async () => {
    await expect(withCeiling(new Promise(() => {}), 20, 'slide 3 measure'))
      .rejects.toThrow('slide 3 measure exceeded 20ms')
  })

  it('does not hold the process open after the guarded promise wins', async () => {
    // The timer is unref'd and cleared; a leaked one would keep the event loop
    // alive long past the deck it was measuring.
    const before = process.listenerCount('exit')
    await withCeiling(Promise.resolve(1), 60_000, 'x')
    expect(process.listenerCount('exit')).toBe(before)
  })
})
