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
        return script(item.html, item.index, nth++);
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
    expect(out).toEqual([
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
    expect(out).toEqual([
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
    expect(out).toEqual([{ overflows: false, state: 'unknown' }]);
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
    expect(warnings().some((w) => w.includes('none overflow'))).toBe(true);
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
