import { asVerdict } from './renderCheck';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * The AI layer is the only thing composing needs from outside, so it is stubbed:
 * `aiMessage` returns whatever markup the test wants the composer to have
 * produced, and the rest of `composeSlide` — fence stripping, unwrapping,
 * sanitising, the pruning guards, the verbatim + slot guards — runs for real.
 *
 * The stub is instrumented: it records every call's params (so tests can
 * inspect system/user messages and count calls) and keeps an active-counter
 * (so the concurrency pool's cap is observable).
 */
const reply = vi.fn<(params: Anthropic.MessageCreateParamsNonStreaming) => string>(() => '');
const aiCalls: Anthropic.MessageCreateParamsNonStreaming[] = [];
let aiDelayMs = 0;
let active = 0;
let maxActive = 0;

vi.mock('../ai', () => {
  const send = async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    aiCalls.push(params);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (aiDelayMs) await new Promise((r) => setTimeout(r, aiDelayMs));
    const text = reply(params);
    active -= 1;
    return { content: [{ type: 'text', text }] } as unknown as Anthropic.Message;
  };
  const cacheBlock = (text: string) => ({ type: 'text', text, cache_control: { type: 'ephemeral' } });
  return {
    // The cache helpers are pure — mirrored here so the mocked module keeps
    // the real shape (block arrays), which is what `sysOf` reads back.
    cachedSystem: (staticPart: string, dynamicPart?: string) =>
      dynamicPart ? [cacheBlock(staticPart), { type: 'text', text: dynamicPart }] : [cacheBlock(staticPart)],
    cachedSystemLayers: (...parts: string[]) => parts.filter(Boolean).map(cacheBlock),
    aiMessage: send,
    /**
     * The structured-output helper, faked at the same seam: the canned reply
     * stands in for the tool's `input` when it is a JSON object (the forced-tool
     * path every real parse call takes), and for plain text otherwise (the
     * scraping fallback). Records the params it was handed, so the call-count
     * and prompt assertions below read exactly as they did before.
     */
    aiJson: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      const resp = await send(params);
      const part = resp.content.find((c) => c.type === 'text');
      const text = part && 'text' in part ? part.text : '';
      try {
        const json: unknown = JSON.parse(text);
        if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
          return { json: json as Record<string, unknown>, text };
        }
      } catch {
        /* not JSON — the reply is a fragment or prose; fall through to text */
      }
      return { text };
    },
    textOf: (resp: Anthropic.Message): string => {
      const part = resp.content.find((c) => c.type === 'text');
      return part && 'text' in part ? part.text : '';
    },
    // Feature-aware, so a test can prove the copywriting and the typesetting
    // resolve to DIFFERENT tiers rather than sharing one lookup.
    modelFor: async (feature: string) => (feature === 'parse' ? 'parse-tier' : 'compose-tier'),
  };
});

const { composeSlide, composeProject, parseForCompose, composeBudgetsFor, unfinishedProse, trimToFinished } =
  await import('./compose');
type LayoutCheckSummary = import('./compose').LayoutCheckSummary;
type ComposeProgress = import('./compose').ComposeProgress;
const { detailMastersRecipe: detailMastersWithFragments } = await import('./recipes');
/**
 * THE MODEL PATH, explicitly.
 *
 * These tests are about what the composer does when it has to WRITE a slide —
 * call counts, retries, the guard chain. The exemplar now ships worked
 * fragments (so the author model can see the shape), which means using it raw
 * here would silently exercise substitution instead and assert nothing about
 * the model. Stripping them states the intent that used to be an accident.
 */
const detailMastersRecipe = { ...detailMastersWithFragments, fragments: undefined };
const { sanitizeAuthoredHtml } = await import('../htmlSanitize');
const { SLIDE_AUTHOR_INSTRUCTIONS } = await import('./prompt');
const { brandRecipeSchema } = await import('@contentbuilder/shared');

const sysOf = (c: Anthropic.MessageCreateParamsNonStreaming): string =>
  typeof c.system === 'string'
    ? c.system
    : (c.system ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');
const userOf = (c: Anthropic.MessageCreateParamsNonStreaming, i = 0): string => {
  const m = c.messages[i];
  return typeof m?.content === 'string' ? m.content : '';
};

/** The composer's real output for slide 7 of "Prepaid packages — get paid up front". */
const DUPLICATED_REPLY = `\`\`\`html
<div class="cb-slide">
<div class="headline sm">Four things that change <span class="it">how you run your shop.</span></div>
<div class="rule"></div>
<div class="body">Cash in the bank before the work begins. Repeat visits secured in advance. Slow weeks funded ahead of time. Clients who are not comparing your price with anyone else.</div>
<div class="fill"></div>
<div class="panel">
  <div class="row"><span class="tick"></span>Cash in the bank before the work begins.<em></em></div>
  <div class="row"><span class="tick"></span>Repeat visits secured in advance.<em></em></div>
  <div class="row"><span class="tick"></span>Slow weeks funded ahead of time.<em></em></div>
  <div class="row"><span class="tick"></span>Clients who are not comparing your price with anyone else.<em></em></div>
</div>
</div>
\`\`\``;

/** The parts that slide was composed from — a body AND rows, which is how it happened. */
const LIST_PARTS = {
  headline: 'Four things that change how you run your shop.',
  emphasis: 'how you run your shop.',
  body: 'Cash in the bank before the work begins. Repeat visits secured in advance. Slow weeks funded ahead of time. Clients who are not comparing your price with anyone else.',
  rows: [
    { text: 'Cash in the bank before the work begins.' },
    { text: 'Repeat visits secured in advance.' },
    { text: 'Slow weeks funded ahead of time.' },
    { text: 'Clients who are not comparing your price with anyone else.' },
  ],
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  aiCalls.length = 0;
  aiDelayMs = 0;
  active = 0;
  maxActive = 0;
});
afterEach(() => {
  warn.mockRestore();
  reply.mockReset();
});

const warnings = () => warn.mock.calls.map((c) => String(c[0]));

describe('composeSlide (pruning guards in the real compose path)', () => {
  it('dedupes a composed slide that says the same thing twice', async () => {
    reply.mockReturnValue(DUPLICATED_REPLY);
    const out = await composeSlide(detailMastersRecipe, {
      role: 'list',
      parts: LIST_PARTS,
      format: '1080x1350',
      index: 6,
    });

    // the paragraph goes; the panel of rows — the richer expression — stays
    expect(out.html).not.toContain('class="body"');
    expect(out.html).toContain('class="panel"');
    expect(out.html).toContain('Clients who are not comparing your price with anyone else.');
    // the empty note stubs go, the decorative tick spans stay
    expect(out.html).not.toContain('<em></em>');
    expect(out.html.match(/<span class="tick"><\/span>/g)).toHaveLength(4);
    // the fenced + .cb-slide-wrapped reply is still unwrapped, and the role travels
    expect(out.html.startsWith('<div class="headline sm">')).toBe(true);
    expect(out.role).toBe('list');

    expect(warnings()).toContainEqual(
      expect.stringContaining('[compose] list: dropped duplicated div.body (already said by div.panel)'),
    );
    expect(warnings()).toContainEqual(
      expect.stringContaining('[compose] list: stripped 4 empty inline element(s)'),
    );
    // and the guard that runs AFTER the prune is satisfied: every part's copy,
    // the dropped paragraph's included, still survives in the final markup.
    expect(warnings().some((w) => w.includes('not verbatim'))).toBe(false);
  });

  it('still finds the dropped copy when the rows come back on one line', async () => {
    // Same duplication, but with no whitespace between the rows — the verbatim
    // guard runs on the pruned markup, so it must still see the paragraph's copy
    // inside the panel rather than reporting the part it just deduped as lost.
    reply.mockReturnValue(
      `<div class="headline sm">Four things that change <span class="it">how you run your shop.</span></div>` +
        `<div class="body">${LIST_PARTS.body}</div>` +
        `<div class="panel">` +
        LIST_PARTS.rows.map((r) => `<div class="row"><span class="tick"></span>${r.text}<em></em></div>`).join('') +
        `</div>`,
    );
    const out = await composeSlide(detailMastersRecipe, {
      role: 'list',
      parts: LIST_PARTS,
      format: '1080x1350',
    });
    expect(out.html).not.toContain('class="body"');
    expect(out.html).toContain('class="panel"');
    expect(warnings().some((w) => w.includes('not verbatim'))).toBe(false);
  });

  it('leaves a well-composed slide exactly as the composer wrote it', async () => {
    const html = `<div class="eyebrow">Prepaid packages</div>
<div class="headline">Get paid before you <span class="it">lift a finger.</span></div>
<div class="rule"></div>
<div class="body">The money lands in the bank while the diary fills itself.</div>
<div class="fill"></div>
<div class="cta">See how it works</div>`;
    reply.mockReturnValue(html);
    const out = await composeSlide(detailMastersRecipe, {
      role: 'feature',
      parts: {
        eyebrow: 'Prepaid packages',
        headline: 'Get paid before you lift a finger.',
        emphasis: 'lift a finger.',
        body: 'The money lands in the bank while the diary fills itself.',
        cta: 'See how it works',
      },
      format: '1080x1350',
    });
    expect(out.html).toBe(html);
    expect(warnings()).toEqual([]);
    // and the happy path pays for exactly one model call
    expect(aiCalls).toHaveLength(1);
  });
});

describe('composeProject (concurrency pool)', () => {
  const nineSlides = JSON.stringify({
    slides: Array.from({ length: 9 }, (_, i) => ({
      role: i === 0 ? 'cover' : i === 8 ? 'cta' : 'statement',
      parts: { headline: `Slide ${i} headline stands alone` },
    })),
  });

  it('composes slides through a pool of 4 and preserves output order', async () => {
    aiDelayMs = 10;
    reply.mockImplementation((params) => {
      if (sysOf(params).includes('STRICT JSON')) return nineSlides;
      const m = userOf(params).match(/Slide (\d+) headline stands alone/);
      return `<div class="headline">Slide ${m?.[1]} headline stands alone</div>`;
    });
    const out = await composeProject(detailMastersRecipe, 'an idea', {});
    expect(out).toHaveLength(9);
    out.forEach((s, i) => expect(s.authored.html).toContain(`Slide ${i} headline stands alone`));
    expect(out[0]!.role).toBe('cover');
    expect(out[8]!.role).toBe('cta');
    // 1 parse + 9 composes, never more than 4 in flight at once — and the pool
    // actually fills (a serial loop would never pass 1).
    expect(aiCalls).toHaveLength(10);
    expect(maxActive).toBe(4);
  });

  /**
   * The parse WRITES the copy (once per deck, the most quality-determining
   * output in the product); the composes only TYPESET it (once per slide, the
   * volume call). Sharing one tier meant either overpaying nine times or
   * cheapening the copywriting to save a fraction of a cent — so they resolve
   * separately, and this pins that they do.
   */
  it('writes the copy on the quality tier and typesets on the cheap one', async () => {
    reply.mockImplementation((params) => {
      if (sysOf(params).includes('STRICT JSON')) return nineSlides;
      const m = userOf(params).match(/Slide (\d+) headline stands alone/);
      return `<div class="headline">Slide ${m?.[1]} headline stands alone</div>`;
    });
    await composeProject(detailMastersRecipe, 'an idea', {});
    const [parseCall, ...slideCalls] = aiCalls;
    expect(parseCall!.model).toBe('parse-tier');
    expect(slideCalls).toHaveLength(9);
    for (const c of slideCalls) expect(c.model).toBe('compose-tier');
  });

  it('fails the whole compose when one slide fails, with no dangling work', async () => {
    reply.mockImplementation((params) => {
      if (sysOf(params).includes('STRICT JSON')) return nineSlides;
      const user = userOf(params);
      if (user.includes('Slide 4 ')) throw new Error('boom');
      const m = user.match(/Slide (\d+) headline stands alone/);
      return `<div class="headline">Slide ${m?.[1]} headline stands alone</div>`;
    });
    await expect(composeProject(detailMastersRecipe, 'an idea', {})).rejects.toThrow('boom');
    // the failure stops NEW work: not all 9 composes were started
    expect(aiCalls.length).toBeLessThan(10);
  });
});

describe('the render check (compose looking at its own output)', () => {
  /**
   * The render boundary is injected, exactly as the AI boundary above is: no
   * Puppeteer page is opened, no throwaway project is written, no web server is
   * needed. The check is OFF by default under a test runner — passing a probe is
   * what turns it on here, so every other test in this file is unaffected.
   */
  type OverflowState = 'fits' | 'overflows' | 'unknown';
  function fakeProbe(script: (html: string, index: number, nth: number) => OverflowState) {
    const seen: Array<{ index: number; html: string }> = [];
    let nth = 0;
    const openProbe = async () => ({
      async measure(items: readonly { index: number; html: string }[]) {
        return items.map((item) => {
          seen.push({ ...item });
          return asVerdict(script(item.html, item.index, nth++));
        });
      },
      async close() {},
    });
    return { openProbe, seen };
  }

  const THREE = JSON.stringify({
    slides: [
      { role: 'cover', parts: { headline: 'Slide 0 headline stands alone' } },
      { role: 'statement', parts: { headline: 'Slide 1 headline stands alone' } },
      { role: 'cta', parts: { headline: 'Slide 2 headline stands alone' } },
    ],
  });
  /**
   * Slide 1 comes back with a rule BETWEEN its headline and a paragraph — the
   * furniture step 2 is allowed to take. The rule has to be separating
   * something: a trailing one is decoration with nothing after it, and the tail
   * guard removes it at compose time, before the render check ever sees it.
   */
  const SLIDE_1_BODY = 'The supporting sentence underneath it.';
  const composeReply = (params: Anthropic.MessageCreateParamsNonStreaming): string => {
    if (sysOf(params).includes('STRICT JSON')) return THREE;
    const n = userOf(params).match(/Slide (\d+) headline stands alone/)?.[1] ?? '?';
    return (
      `<div class="headline">Slide ${n} headline stands alone</div>` +
      (n === '1' ? `<div class="rule"></div><div class="body">${SLIDE_1_BODY}</div>` : '')
    );
  };

  it('leaves a deck that fits byte-identical, and pays for nothing extra', async () => {
    reply.mockImplementation(composeReply);
    const { openProbe, seen } = fakeProbe(() => 'fits');
    const checked = await composeProject(detailMastersRecipe, 'an idea', { renderProbe: openProbe });
    // 1 parse + 3 composes: the check itself added no model call.
    expect(aiCalls).toHaveLength(4);

    reply.mockImplementation(composeReply);
    aiCalls.length = 0;
    const plain = await composeProject(detailMastersRecipe, 'an idea', { renderCheck: false });

    expect(checked.map((s) => s.authored.html)).toEqual(plain.map((s) => s.authored.html));
    expect(checked.map((s) => s.role)).toEqual(plain.map((s) => s.role));
    expect(seen).toHaveLength(3); // one render per slide, no repairs
    expect(aiCalls).toHaveLength(4); // …and the unchecked run costs exactly the same
  });

  it('reports that a deck was never measured, instead of only warning the terminal', async () => {
    reply.mockImplementation(composeReply);
    const seen: LayoutCheckSummary[] = [];
    await composeProject(detailMastersRecipe, 'an idea', {
      // The renderer is down — every slide comes back `unknown` and the deck
      // ships exactly as composed, which is right. The caller has to be told.
      renderProbe: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3100');
      },
      onLayoutCheck: (r) => seen.push(r),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.unmeasured).toBe(3);
    expect(seen[0]!.measured).toBe(0);
  });

  it('reports nothing unmeasured when every slide was gated', async () => {
    reply.mockImplementation(composeReply);
    const { openProbe } = fakeProbe(() => 'fits');
    const seen: LayoutCheckSummary[] = [];
    await composeProject(detailMastersRecipe, 'an idea', { renderProbe: openProbe, onLayoutCheck: (r) => seen.push(r) });
    expect(seen[0]).toMatchObject({ measured: 3, unmeasured: 0, overflowed: 0 });
  });

  it('names each phase it enters, so slow is distinguishable from stuck', async () => {
    reply.mockImplementation(composeReply);
    const { openProbe } = fakeProbe(() => 'fits');
    const phases: ComposeProgress[] = [];
    await composeProject(detailMastersRecipe, 'an idea', {
      renderProbe: openProbe,
      onProgress: (p) => phases.push(p),
    });
    expect(phases[0]).toEqual({ phase: 'parsing' });
    expect(phases.at(-1)).toEqual({ phase: 'done' });
    // The per-slide count climbs, so a caller can tell 1-of-9 from 8-of-9.
    const composing = phases.filter((p) => p.phase === 'composing');
    expect(composing[0]).toEqual({ phase: 'composing', done: 0, total: 3 });
    expect(composing.at(-1)).toEqual({ phase: 'composing', done: 3, total: 3 });
    expect(phases.some((p) => p.phase === 'checking-layout')).toBe(true);
  });

  it('ships the deck unchanged, with one warning and no throw, when the renderer is unreachable', async () => {
    reply.mockImplementation(composeReply);
    const out = await composeProject(detailMastersRecipe, 'an idea', {
      renderProbe: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3100');
      },
    });
    expect(out).toHaveLength(3);
    expect(out[1]!.authored.html).toBe(
      '<div class="headline">Slide 1 headline stands alone</div>' +
        `<div class="rule"></div><div class="body">${SLIDE_1_BODY}</div>`,
    );
    expect(aiCalls).toHaveLength(4); // parse + 3 composes; nothing was repaired
    expect(warnings().filter((w) => w.includes('deck ships unchecked'))).toHaveLength(1);
  });

  it('fixes an overflowing slide with the smaller headline alone — no model call', async () => {
    reply.mockImplementation(composeReply);
    const answered = new Map<number, number>();
    const { openProbe } = fakeProbe((_html, index) => {
      const n = (answered.get(index) ?? 0) + 1;
      answered.set(index, n);
      return index === 1 && n === 1 ? 'overflows' : 'fits';
    });
    const out = await composeProject(detailMastersRecipe, 'an idea', { renderProbe: openProbe });

    expect(out[1]!.authored.html).toContain('class="headline sm"');
    expect(out[1]!.authored.html).toContain('class="rule"'); // step 2 never ran
    expect(out[0]!.authored.html).toBe('<div class="headline">Slide 0 headline stands alone</div>');
    expect(aiCalls).toHaveLength(4); // still just the parse + one compose per slide
  });

  it('drops the rule at step 2 when the smaller headline is not enough', async () => {
    reply.mockImplementation(composeReply);
    const answered = new Map<number, number>();
    const { openProbe } = fakeProbe((_html, index) => {
      const n = (answered.get(index) ?? 0) + 1;
      answered.set(index, n);
      return index === 1 && n <= 2 ? 'overflows' : 'fits';
    });
    const out = await composeProject(detailMastersRecipe, 'an idea', { renderProbe: openProbe });

    // The rule goes; the paragraph it was separating stays — and with nothing
    // left after it the tail guard would have taken it anyway.
    expect(out[1]!.authored.html).toBe(
      `<div class="headline sm">Slide 1 headline stands alone</div><div class="body">${SLIDE_1_BODY}</div>`,
    );
    expect(aiCalls).toHaveLength(4); // both repair steps are free
    expect(warnings().some((w) => w.includes('dropped div.rule'))).toBe(true);
  });

  it('re-composes the slide exactly once, naming the overflow, as a last resort', async () => {
    reply.mockImplementation(composeReply);
    const answered = new Map<number, number>();
    const { openProbe } = fakeProbe((_html, index) => {
      const n = (answered.get(index) ?? 0) + 1;
      answered.set(index, n);
      return index === 1 && n <= 3 ? 'overflows' : 'fits';
    });
    const out = await composeProject(detailMastersRecipe, 'an idea', { renderProbe: openProbe });

    // 1 parse + 3 composes + exactly ONE re-compose
    expect(aiCalls).toHaveLength(5);
    const repair = aiCalls[4]!;
    const user = userOf(repair);
    expect(user).toContain('the previous composition overflowed the canvas — use fewer elements; the copy is fixed');
    // same system prompt as a normal compose — only the user message gains the note
    expect(sysOf(repair)).toBe(sysOf(aiCalls[1]!));
    expect(user.startsWith(userOf(aiCalls[2]!))).toBe(true);
    // the copy is still verbatim in what ships
    expect(out[1]!.authored.html).toContain('Slide 1 headline stands alone');
    expect(warnings().some((w) => w.includes('recomposed'))).toBe(true);
  });
});

describe('verbatim guard: repair, not warn', () => {
  const FEATURE_PARTS = {
    eyebrow: 'Prepaid packages',
    headline: 'Get paid before you lift a finger.',
    cta: 'See how it works',
  };

  it('retries once with a VIOLATION correction naming each missing part', async () => {
    reply
      .mockReturnValueOnce('<div class="headline">Something else entirely rewritten</div>')
      .mockReturnValueOnce(
        `<div class="eyebrow">Prepaid packages</div>` +
          `<div class="headline">Get paid before you lift a finger.</div>` +
          `<div class="cta">See how it works</div>`,
      );
    const out = await composeSlide(detailMastersRecipe, {
      role: 'feature',
      parts: FEATURE_PARTS,
      format: '1080x1350',
    });

    expect(aiCalls).toHaveLength(2);
    // same model, same system — only the user message gains the correction
    expect(aiCalls[1]!.model).toBe(aiCalls[0]!.model);
    expect(sysOf(aiCalls[1]!)).toBe(sysOf(aiCalls[0]!));
    const retryUser = userOf(aiCalls[1]!);
    expect(retryUser.startsWith(userOf(aiCalls[0]!))).toBe(true);
    expect(retryUser).toContain('VIOLATION: these copy parts must appear verbatim and were missing or altered:');
    expect(retryUser).toContain('eyebrow: "Prepaid packages"');
    expect(retryUser).toContain('headline: "Get paid before you lift a finger."');
    expect(retryUser).toContain('cta: "See how it works"');

    // the retry's clean output ships
    expect(out.html).toContain('Get paid before you lift a finger.');
    expect(warnings().some((w) => w.includes('not verbatim'))).toBe(true);
  });

  it('splices a still-missing part deterministically when the retry also fails', async () => {
    const bad = `<div class="eyebrow">Prepaid packages</div>\n<div class="cta">See how it works</div>`;
    reply.mockReturnValueOnce(bad).mockReturnValueOnce(bad);
    const out = await composeSlide(detailMastersRecipe, {
      role: 'feature',
      parts: FEATURE_PARTS,
      format: '1080x1350',
      index: 0,
    });

    expect(aiCalls).toHaveLength(2); // one compose + one retry, then no more calls
    // the missing headline is inserted with the recipe's matching class...
    expect(out.html).toContain('<div class="headline">Get paid before you lift a finger.</div>');
    // ...at its role-appropriate position: after the eyebrow, before the cta
    const posEyebrow = out.html.indexOf('class="eyebrow"');
    const posHeadline = out.html.indexOf('class="headline"');
    const posCta = out.html.indexOf('class="cta"');
    expect(posEyebrow).toBeGreaterThanOrEqual(0);
    expect(posHeadline).toBeGreaterThan(posEyebrow);
    expect(posHeadline).toBeLessThan(posCta);
    // spliced markup is sanitizer-clean (re-sanitising changes nothing)
    expect(sanitizeAuthoredHtml(out.html)).toBe(out.html);
    // telemetry still sees both the retry and the splice
    expect(warnings().some((w) => w.includes('retrying once'))).toBe(true);
    expect(warnings().some((w) => w.includes('splicing deterministically'))).toBe(true);
  });

  it('escapes spliced copy so hostile text cannot smuggle markup', async () => {
    const bad = `<div class="eyebrow">Prepaid packages</div>`;
    reply.mockReturnValueOnce(bad).mockReturnValueOnce(bad);
    const out = await composeSlide(detailMastersRecipe, {
      role: 'feature',
      parts: { eyebrow: 'Prepaid packages', headline: 'Deals < worth > "quoting" & more' },
      format: '1080x1350',
    });
    expect(out.html).toContain('Deals &lt; worth &gt; &quot;quoting&quot; &amp; more');
    expect(sanitizeAuthoredHtml(out.html)).toBe(out.html);
  });
});

describe('parse budgets enforced in code', () => {
  // 72 chars — >10% over the 60-char headline budget.
  const longHeadline = 'This headline runs far past the poster budget and keeps going regardless'.slice(0, 72);
  // 58 chars — >10% over the 42-char row budget.
  const longRow = 'Cash lands in the bank before any of the work begins today';

  it('re-parses once naming each violation, then clamps what is still over', async () => {
    expect(longHeadline.length).toBeGreaterThan(66);
    const over = JSON.stringify({
      slides: [{ role: 'cover', parts: { headline: longHeadline, rows: [{ text: longRow }] } }],
    });
    reply.mockReturnValueOnce(over).mockReturnValueOnce(over); // the correction changes nothing
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });

    expect(aiCalls).toHaveLength(2);
    // the corrective call carries the previous JSON and names each violation
    const retry = aiCalls[1]!;
    expect(retry.messages).toHaveLength(3);
    expect(userOf(retry, 1)).toContain(longHeadline); // assistant turn: previous JSON
    const correction = userOf(retry, 2);
    expect(correction).toContain(`headline is ${longHeadline.length} chars, budget 60`);
    expect(correction).toContain(`rows[0].text is ${longRow.length} chars, budget 42`);
    expect(correction).toContain('Fix every flagged item');

    // still over after the retry → deterministic clamps
    const parts = inputs[0]!.parts;
    expect(parts.headline!.length).toBeLessThanOrEqual(60);
    expect(parts.headline!.endsWith('…')).toBe(false); // no ellipsis on a headline
    expect(longHeadline.startsWith(parts.headline!)).toBe(true); // cut at a word boundary
    expect(parts.rows![0]!.text.length).toBeLessThanOrEqual(42);
    expect(warnings().some((w) => w.includes('clamped'))).toBe(true);
  });

  it('clamps directly, without a re-parse, when the overrun is within 10%', async () => {
    const slightlyLong = 'word '.repeat(12) + 'tail'; // 64 chars: over 60, under 66
    expect(slightlyLong.length).toBe(64);
    reply.mockReturnValueOnce(JSON.stringify({ slides: [{ role: 'cover', parts: { headline: slightlyLong } }] }));
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(aiCalls).toHaveLength(1);
    expect(inputs[0]!.parts.headline!.length).toBeLessThanOrEqual(60);
    expect(warnings().some((w) => w.includes('clamped'))).toBe(true);
  });

  it('makes exactly one parse call when the copy is within budget', async () => {
    reply.mockReturnValueOnce(JSON.stringify({ slides: [{ role: 'cover', parts: { headline: 'Short and sharp.' } }] }));
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(aiCalls).toHaveLength(1);
    expect(inputs[0]!.parts.headline).toBe('Short and sharp.');
    expect(warnings()).toEqual([]);
  });

  it('drops an emphasis that a clamped headline no longer contains', async () => {
    const emphasis = 'keeps going regardless';
    reply.mockReturnValueOnce(
      JSON.stringify({ slides: [{ role: 'cover', parts: { headline: longHeadline, emphasis } }] }),
    ).mockReturnValueOnce(
      JSON.stringify({ slides: [{ role: 'cover', parts: { headline: longHeadline, emphasis } }] }),
    );
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(inputs[0]!.parts.emphasis).toBeUndefined();
  });
});

describe('format-aware parse', () => {
  const tiny = JSON.stringify({ slides: [{ role: 'cover', parts: { headline: 'Hi there.' } }] });

  it('states the story format’s budgets in the USER message only', async () => {
    reply.mockReturnValueOnce(tiny);
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', format: '1080x1920' });
    const user = userOf(aiCalls[0]!);
    // A story takes NO cut. Measured part by part: every one clears post parity
    // with room over it, on a canvas 570px taller whose UI band the padding
    // already reserves. The per-format LINE still belongs to the user message.
    expect(user).toContain('eyebrow <= 26');
    expect(user).toContain('headline <= 60');
    expect(user).toContain('body <= 90');
    expect(user).toContain('cta <= 24');
    expect(user).toContain('rows text <= 42');
    expect(user).toContain('TALLER canvas');
    // the system prompt stays static across formats (cache-friendly)
    expect(sysOf(aiCalls[0]!)).not.toContain('FORMAT:');
    expect(sysOf(aiCalls[0]!)).not.toContain('1080');
  });

  it('tightens the square format slightly, and leaves the base post format alone', async () => {
    reply.mockReturnValueOnce(tiny).mockReturnValueOnce(tiny);
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', format: '1080x1080' });
    expect(userOf(aiCalls[0]!)).toContain('headline <= 54');
    expect(userOf(aiCalls[0]!)).toContain('body <= 81');
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', format: '1080x1350' });
    expect(userOf(aiCalls[1]!)).not.toContain('FORMAT:');
    // one system prompt, byte-identical for every format
    expect(sysOf(aiCalls[1]!)).toBe(sysOf(aiCalls[0]!));
  });

  it('enforces the SQUARE budgets, not the base ones', async () => {
    // The square is the format that still takes a cut, and for a reason that
    // survived measurement: it is genuinely a shorter canvas than the 4:5. The
    // story no longer takes one, so this is where a per-format budget is tested.
    const headline = 'A headline that fits the post budget but not the square'; // 55 chars
    expect(headline.length).toBeLessThanOrEqual(60);
    expect(headline.length).toBeGreaterThan(54 * 1.01);
    const json = JSON.stringify({ slides: [{ role: 'cover', parts: { headline } }] });
    reply.mockReturnValueOnce(json).mockReturnValueOnce(json);
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', format: '1080x1080' });
    expect(inputs[0]!.parts.headline!.length).toBeLessThanOrEqual(54);
  });

  it('gives a story the same budgets as a post, on every part', async () => {
    const post = composeBudgetsFor('1080x1350');
    const story = composeBudgetsFor('1080x1920');
    expect(story).toEqual(post);
    // …and the square still tightens, which measurement never contradicted.
    expect(composeBudgetsFor('1080x1080').headline).toBeLessThan(post.headline);
  });
});

describe('copy that stops mid-thought', () => {
  const slide = (parts: Record<string, unknown>, role = 'statement') => ({ role, parts }) as never;
  const flag = (parts: Record<string, unknown>, role?: string) =>
    unfinishedProse([slide(parts, role)]).map((u) => `${u.label}: ${u.reason}`);

  it('catches the line that actually shipped', () => {
    // 41 characters against a 150 budget, so nothing clamped it and nothing
    // noticed. The copywriter simply stopped.
    // Diagnosed by the sharpest rule that applies: this line does not merely
    // lack a full stop, it opens a second sentence and abandons it.
    expect(flag({ body: 'Enzymes break the source. Fragrance covers' })).toEqual([
      'body: starts a sentence it never finishes',
    ]);
  });

  it('catches a headline left open on a dangling word', () => {
    expect(flag({ headline: 'Cut no-shows by' })).toEqual(['headline: ends on a dangling word']);
  });

  it('catches a headline that opens a second sentence and never closes it', () => {
    // Shipped past both other rules: a headline may be a fragment, and "finds"
    // is a verb rather than a dangling function word. Across 282 stored strings
    // this rule fires exactly once — on this line.
    expect(flag({ headline: 'Miss the ducts. The smell finds' })).toEqual([
      'headline: starts a sentence it never finishes',
    ]);
  });

  it('leaves a multi-sentence line that does close', () => {
    expect(flag({ headline: 'Fragrance covers. Enzymes work.' })).toEqual([]);
    expect(flag({ headline: 'Holds the most. Ruins the fastest.' })).toEqual([]);
  });

  it('leaves a sentence that legitimately ends on a particle', () => {
    // English ends sentences on particles all the time. Without the
    // terminal-punctuation guard this rule fired on 12 good lines out of 13.
    expect(flag({ body: 'Every redemption tracked. Every session accounted for.' })).toEqual([]);
    expect(flag({ body: 'Some jobs you quote yourself into.' })).toEqual([]);
    expect(flag({ body: 'It does not have to be.' })).toEqual([]);
  });

  it('lets a headline be a fragment, because 34 of 93 shipped ones are', () => {
    expect(flag({ headline: 'The job that comes back' })).toEqual([]);
    expect(flag({ headline: 'Read the water, not the calendar' })).toEqual([]);
  });

  it('never judges a label — an eyebrow, a CTA or a handle is not a sentence', () => {
    // "Reframe this" and "What a package is" are real eyebrows. Checking them
    // produced nothing but false alarms.
    expect(flag({ eyebrow: 'Reframe this', cta: 'Book a slot', handle: '@detailmasters' })).toEqual([]);
  });

  it('holds a row note to prose, and a row item to a fragment', () => {
    expect(flag({ rows: [{ text: 'Extraction', note: 'Pulls back out what you put in' }] })).toEqual([
      'rows[0].note: no terminal punctuation',
    ]);
    // The row's own text is scanned, not read — a fragment is correct there.
    expect(flag({ rows: [{ text: 'Saturated foam holds odour deep' }] })).toEqual([]);
  });

  it('reports what survived the correction, instead of shipping it quietly', async () => {
    // The model is asked once to finish the line and returns it unfinished
    // anyway. Nothing can repair that — the missing words are the point — so it
    // has to reach the caller.
    const json = JSON.stringify({
      slides: [{ role: 'statement', parts: { headline: 'The returning job', body: 'The smell tells a different story' } }],
    });
    reply.mockReturnValue(json);
    const seen: Array<{ unfinished: Array<{ label: string }> }> = [];
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', onCopyCheck: (r) => seen.push(r) });
    expect(aiCalls.length).toBeGreaterThan(1); // it did ask for a correction
    expect(seen[0]!.unfinished.map((u) => u.label)).toEqual(['body']);
    expect(warnings().some((w) => w.includes('still stops mid-thought'))).toBe(true);
  });

  it('reports nothing when the copy is finished', async () => {
    reply.mockReturnValueOnce(
      JSON.stringify({ slides: [{ role: 'statement', parts: { headline: 'The returning job', body: 'The smell tells a different story.' } }] }),
    );
    const seen: Array<{ unfinished: unknown[] }> = [];
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', onCopyCheck: (r) => seen.push(r) });
    expect(seen[0]!.unfinished).toEqual([]);
  });

  it('does not accept a trailing colon as an ending', () => {
    // A colon promises something after it. This shipped as "finished":
    // "Tight beads: healthy. Flat, clinging beads:" — a comparison cut off
    // before its second half. One string in 284 ends with a colon and it is
    // that one, so there is no legitimate use to protect.
    expect(flag({ headline: 'Tight beads: healthy. Flat, clinging beads:' })).toEqual([
      'headline: starts a sentence it never finishes',
    ]);
    expect(flag({ body: 'What you get:' })).toEqual(['body: no terminal punctuation']);
  });

  it('still accepts a colon INSIDE a line that ends properly', () => {
    expect(flag({ headline: 'Tight beads: healthy. Flat beads: not.' })).toEqual([]);
  });

  it('ignores a single word, however it is punctuated', () => {
    expect(flag({ body: 'Extraction' })).toEqual([]);
    expect(flag({ headline: 'Deposits' })).toEqual([]);
  });
});

describe('the body budget is per-role, not one number for the whole deck', () => {
  // Two sentences. Well over the 90-char base budget, inside the 150 an
  // explaining slide is allowed.
  const twoSentences =
    'A booking that never reaches the calendar is one you have already lost. ' +
    'The shop finds out when the bay is empty on a Friday.';

  it('leaves an explaining slide its two sentences, with no re-parse and no clamp', async () => {
    expect(twoSentences.length).toBeGreaterThan(90);
    expect(twoSentences.length).toBeLessThanOrEqual(150);
    reply.mockReturnValueOnce(
      JSON.stringify({ slides: [{ role: 'statement', parts: { headline: 'The quiet week', body: twoSentences } }] }),
    );
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(aiCalls).toHaveLength(1);
    expect(inputs[0]!.parts.body).toBe(twoSentences);
    expect(warnings()).toEqual([]);
  });

  it('gives a feature slide the same room', async () => {
    reply.mockReturnValueOnce(
      JSON.stringify({ slides: [{ role: 'feature', parts: { headline: 'Deposits', body: twoSentences } }] }),
    );
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(inputs[0]!.parts.body).toBe(twoSentences);
  });

  it('withdraws the room when a tagline shares the canvas — the shape that overflows', async () => {
    const json = JSON.stringify({
      slides: [
        { role: 'statement', parts: { headline: 'The quiet week', tagline: 'Ask for the deposit.', body: twoSentences } },
      ],
    });
    reply.mockReturnValueOnce(json).mockReturnValueOnce(json);
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(inputs[0]!.parts.body!.length).toBeLessThanOrEqual(90);
  });

  it('holds every other role to the base budget', async () => {
    const json = JSON.stringify({
      slides: [{ role: 'cover', parts: { headline: 'The quiet week', body: twoSentences } }],
    });
    reply.mockReturnValueOnce(json).mockReturnValueOnce(json);
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(inputs[0]!.parts.body!.length).toBeLessThanOrEqual(90);
  });

  it('follows a “shorter body” lesson down instead of keeping its 150', async () => {
    // The brand has been taught its bodies are always cut by ~20 characters, so
    // the base budget drops to 70 — and the explain allowance drops with it.
    const lesson = {
      id: 'shorter:body',
      kind: 'shorter' as const,
      subject: 'body' as const,
      observations: 4,
      amount: 20,
      instruction: 'aim shorter',
      summary: 'you shorten the body',
      evidence: [],
    };
    const json = JSON.stringify({
      slides: [{ role: 'statement', parts: { headline: 'The quiet week', body: twoSentences } }],
    });
    reply.mockReturnValue(json);
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', lessons: [lesson] });
    // 70 * (150/90) = 117, so the two sentences no longer fit whole.
    expect(inputs[0]!.parts.body!.length).toBeLessThanOrEqual(117);
    expect(inputs[0]!.parts.body!.length).toBeGreaterThan(70);
  });

  it('names the allowance — in the system prompt at base, scaled in the user message', async () => {
    const tiny = JSON.stringify({ slides: [{ role: 'cover', parts: { headline: 'Hi there.' } }] });
    reply.mockReturnValueOnce(tiny).mockReturnValueOnce(tiny);
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    // The base numbers live in the static system prompt; the user message adds
    // nothing for the base format, so the cache stays warm across posts.
    expect(sysOf(aiCalls[0]!)).toContain('the body may run to 150 characters');
    expect(composeBudgetsFor('1080x1350').explainBody).toBe(150);
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', format: '1080x1920' });
    expect(userOf(aiCalls[1]!)).toContain('body <= 90 (<= 150 on a statement or feature slide that has no tagline)');
  });
});

describe('mechanical emphasis wrap', () => {
  it('wraps a forgotten emphasis phrase in the brand’s emphasis span', async () => {
    reply.mockReturnValueOnce('<div class="headline">Get paid before you lift a finger.</div>');
    const out = await composeSlide(detailMastersRecipe, {
      role: 'statement',
      parts: { headline: 'Get paid before you lift a finger.', emphasis: 'lift a finger.' },
      format: '1080x1350',
    });
    // DetailMasters' stylesheet defines `.headline .it` — the derived wrap
    expect(out.html).toBe(
      '<div class="headline">Get paid before you <span class="it">lift a finger.</span></div>',
    );
    expect(aiCalls).toHaveLength(1); // the phrase was in the headline — no retry
    expect(warnings().some((w) => w.includes('wrapped the emphasis phrase'))).toBe(true);
  });

  it('leaves a correctly wrapped emphasis byte-identical', async () => {
    const html = '<div class="headline">Get paid before you <span class="it">lift a finger.</span></div>';
    reply.mockReturnValueOnce(html);
    const out = await composeSlide(detailMastersRecipe, {
      role: 'statement',
      parts: { headline: 'Get paid before you lift a finger.', emphasis: 'lift a finger.' },
      format: '1080x1350',
    });
    expect(out.html).toBe(html);
    expect(warnings()).toEqual([]);
  });

  it('does nothing when the phrase is not in the headline text', async () => {
    const html = '<div class="headline">A different line entirely.</div>';
    reply.mockReturnValueOnce(html);
    const out = await composeSlide(detailMastersRecipe, {
      role: 'statement',
      parts: { headline: 'A different line entirely.', emphasis: 'lift a finger.' },
      format: '1080x1350',
    });
    expect(out.html).toBe(html);
    // a missing emphasis is warned about but never retried — no element can carry it
    expect(aiCalls).toHaveLength(1);
    expect(warnings().some((w) => w.includes('not verbatim'))).toBe(true);
  });

  it('tolerates whitespace and case drift when finding the phrase', async () => {
    reply.mockReturnValueOnce('<div class="headline">Get paid before you Lift  A Finger.</div>');
    const out = await composeSlide(detailMastersRecipe, {
      role: 'statement',
      parts: { headline: 'Get paid before you Lift  A Finger.', emphasis: 'lift a finger.' },
      format: '1080x1350',
    });
    expect(out.html).toContain('<span class="it">Lift  A Finger.</span>');
  });
});

describe('compose by example (the recipe composes its own slides)', () => {
  /**
   * DetailMasters, plus one worked fragment per role — written in its real
   * component vocabulary and run through `brandRecipeSchema`, so these tests
   * exercise the same stored shape a real authored recipe would carry.
   */
  const FRAGMENTS = {
    cover: `<div class="eyebrow">{{eyebrow}}</div>
<figure class="cb-shot" data-cb-slot="hero"></figure>
<div class="headline">{{headline}}</div>
<div class="fill"></div>
<div class="handle">{{handle}}</div>`,
    list: `<div class="headline">{{headline}}</div>
<div class="panel">{{#rows}}<div class="row"><span class="tick"></span>{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>`,
    statement: `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="rule"></div>
<div class="body">{{body}}</div>`,
    cta: `<div class="headline">{{headline}}</div>
<div class="fill"></div>
<div class="cta">{{cta}}</div>
<div class="handle">{{handle}}</div>`,
  };
  const byExample = brandRecipeSchema.parse({ ...detailMastersRecipe, fragments: FRAGMENTS });

  /** Every part here sits inside the 4:5 budgets, so the parse costs ONE call. */
  const deck = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      slides: [
        {
          role: 'cover',
          image: true,
          parts: {
            eyebrow: 'Prepaid packages',
            headline: 'Get paid before you lift a finger.',
            emphasis: 'lift a finger.',
          },
        },
        {
          role: 'list',
          parts: {
            headline: 'Four things change.',
            rows: [{ text: 'Cash lands first' }, { text: 'Repeat visits secured' }],
          },
        },
        {
          role: 'statement',
          parts: {
            headline: 'The diary fills itself.',
            body: 'The money lands while the work is still ahead.',
            ...(over.statementParts as object | undefined),
          },
        },
        { role: 'cta', parts: { headline: 'Book the demo.', cta: 'See how it works', handle: '@detailmasters' } },
      ],
    });

  it('composes a whole deck with ZERO per-slide model calls', async () => {
    reply.mockImplementation(() => deck());
    const out = await composeProject(byExample, 'an idea', { renderCheck: false });

    // THE PRIZE: one parse call for the deck, and nothing else.
    expect(aiCalls).toHaveLength(1);
    expect(sysOf(aiCalls[0]!)).toContain('social-carousel copywriter');
    expect(out.map((s) => s.source)).toEqual(['fragment', 'fragment', 'fragment', 'fragment']);
    expect(out.map((s) => s.role)).toEqual(['cover', 'list', 'statement', 'cta']);

    // …and the copy landed byte-correct in the brand's own markup.
    expect(out[1]!.authored.html).toBe(
      '<div class="headline">Four things change.</div>\n' +
        '<div class="panel"><div class="row"><span class="tick"></span>Cash lands first</div>\n' +
        '<div class="row"><span class="tick"></span>Repeat visits secured</div></div>',
    );
    expect(out[2]!.authored.html).toBe(
      '<div class="headline">The diary fills itself.</div>\n' +
        '<div class="rule"></div>\n' +
        '<div class="body">The money lands while the work is still ahead.</div>',
    );
    expect(out[3]!.authored.html).toContain('<div class="cta">See how it works</div>');
    expect(out[3]!.authored.html).toContain('<div class="handle">@detailmasters</div>');
    // no placeholder ever reaches a slide, and an absent part took its element
    for (const s of out) expect(s.authored.html).not.toContain('{{');
    expect(out[0]!.authored.html).not.toContain('class="handle"'); // the cover has no handle
    expect(out[2]!.authored.html).not.toContain('class="eyebrow"'); // nor this statement an eyebrow
    // the deck log says how it was composed
    expect(warnings()).toContainEqual(
      expect.stringContaining('[compose] deck: 4/4 slide(s) substituted from recipe fragments'),
    );
  });

  it('drops the slot on a full-bleed photo slide, and applies the signature emphasis', async () => {
    reply.mockImplementation(() => deck());
    const out = await composeProject(byExample, 'an idea', { renderCheck: false });
    const cover = out[0]!.authored.html;

    // A photo cover is assigned the showcase archetype (placement 'bleed'):
    // the photograph arrives as the BACKGROUND layer, so the fragment's
    // conditional slot is dropped — a slot would punch a card through it.
    expect(out[0]!.authored.archetype).toBe('showcase');
    expect(cover).not.toContain('cb-shot');
    // the mechanical wrap runs on the substituted path exactly as on the model one
    expect(cover).toContain(
      '<div class="headline">Get paid before you <span class="it">lift a finger.</span></div>',
    );
    expect(aiCalls).toHaveLength(1);
  });

  it('repeats the row unit for 2 rows and for 5, straight through the guard chain', async () => {
    for (const n of [2, 5]) {
      const rows = Array.from({ length: n }, (_, i) => ({ text: `Row number ${i + 1}` }));
      const out = await composeSlide(byExample, {
        role: 'list',
        parts: { headline: 'What you get', rows },
        format: '1080x1350',
      });
      expect(out.source).toBe('fragment');
      expect(out.html.match(/class="row"/g)).toHaveLength(n);
      for (const row of rows) expect(out.html).toContain(row.text);
      expect(out.html).not.toContain('<em>'); // the unused note's element went with it
    }
    expect(aiCalls).toHaveLength(0);
  });

  it('falls back to the model for the ONE slide a fragment cannot express', async () => {
    // The statement fragment has no {{cta}} hole, so substituting would silently
    // drop that copy — that slide goes to the model, and only that slide.
    reply.mockImplementation((params) =>
      sysOf(params).includes('STRICT JSON')
        ? deck({ statementParts: { cta: 'Book a slot' } })
        : '<div class="headline">The diary fills itself.</div>' +
          '<div class="body">The money lands while the work is still ahead.</div>' +
          '<div class="cta">Book a slot</div>',
    );
    const out = await composeProject(byExample, 'an idea', { renderCheck: false });

    expect(out.map((s) => s.source)).toEqual(['fragment', 'fragment', 'ai', 'fragment']);
    expect(aiCalls).toHaveLength(2); // the parse + exactly one compose
    expect(sysOf(aiCalls[1]!)).toContain(SLIDE_AUTHOR_INSTRUCTIONS);
    expect(userOf(aiCalls[1]!)).toContain('role: statement');
    expect(out[2]!.authored.html).toContain('Book a slot');
    expect(warnings()).toContainEqual(
      expect.stringContaining('[compose] statement: recipe fragment cannot carry this slide (no {{cta}} placeholder)'),
    );
    expect(warnings()).toContainEqual(
      expect.stringContaining('[compose] deck: 3/4 slide(s) substituted from recipe fragments · 1 composed by the model'),
    );
  });

  it('falls back for a photo slide whose fragment leaves no hole for the picture', async () => {
    const noSlot = brandRecipeSchema.parse({
      ...detailMastersRecipe,
      fragments: { statement: FRAGMENTS.statement },
    });
    reply.mockReturnValueOnce(
      '<div class="headline">A line</div><figure class="cb-shot" data-cb-slot="hero"></figure>',
    );
    const out = await composeSlide(noSlot, {
      role: 'statement',
      parts: { headline: 'A line' },
      format: '1080x1350',
      photo: true,
    });
    expect(out.source).toBe('ai');
    expect(aiCalls).toHaveLength(1);
    expect(warnings()).toContainEqual(expect.stringContaining('(no-slot) — composing with the model'));
  });

  it('leaves a recipe WITHOUT fragments composing exactly as it does today', async () => {
    /** What the composer "writes" for each role — carrying that role's copy verbatim. */
    const composed: Record<string, string> = {
      cover:
        '<div class="eyebrow">Prepaid packages</div>' +
        '<div class="headline">Get paid before you <span class="it">lift a finger.</span></div>',
      list: '<div class="headline">Four things change.</div>',
      statement:
        '<div class="headline">The diary fills itself.</div>' +
        '<div class="body">The money lands while the work is still ahead.</div>',
      cta:
        '<div class="headline">Book the demo.</div>' +
        '<div class="cta">See how it works</div>' +
        '<div class="handle">@detailmasters</div>',
    };
    reply.mockImplementation((params) =>
      sysOf(params).includes('STRICT JSON')
        ? deck()
        : (composed[userOf(params).match(/role: (\w+)/)?.[1] ?? ''] ?? ''),
    );
    const out = await composeProject(detailMastersRecipe, 'an idea', { renderCheck: false });

    // the model path still runs: 1 parse + one compose per slide, nothing retried
    expect(aiCalls).toHaveLength(5);
    expect(out.map((s) => s.source)).toEqual(['ai', 'ai', 'ai', 'ai']);
    for (const call of aiCalls.slice(1)) expect(sysOf(call)).toContain(SLIDE_AUTHOR_INSTRUCTIONS);
    // …and its output is byte-identical to what the composer wrote. The photo
    // cover gets NO appended slot: its archetype is full-bleed (showcase), so
    // the photograph is the background layer and the slot guard inverts.
    expect(out[1]!.authored.html).toBe(composed['list']);
    expect(out[2]!.authored.html).toBe(composed['statement']);
    expect(out[3]!.authored.html).toBe(composed['cta']);
    expect(out[0]!.authored.archetype).toBe('showcase');
    expect(out[0]!.authored.html).toBe(composed['cover']);
    // nothing in the new path so much as logged
    expect(warnings().some((w) => w.includes('fragment'))).toBe(false);
  });
});

// ── The brief: sources, a plan, and copy the user locked ────────────────────

describe('the brief reaches the copywriter', () => {
  const oneSlide = (parts: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ slides: [{ role: 'statement', parts, ...extra }] });

  it('puts the read source in the user message, marked as the material', async () => {
    reply.mockReturnValue(oneSlide({ headline: 'A line' }));
    await parseForCompose(detailMastersRecipe, 'make a carousel from the post', {
      model: 'm',
      sources: [{ url: 'https://dm.pro/post', title: 'Reapplying a coating', text: '# Read the water\n- beads flatten' }],
    });
    const user = userOf(aiCalls[0]!);
    expect(user).toContain('SOURCE 1 — "Reapplying a coating" (https://dm.pro/post)');
    expect(user).toContain('- beads flatten');
    expect(user).toContain('BRIEF: make a carousel from the post');
  });

  it('a plan fixes the deck length and travels as numbered directions', async () => {
    reply.mockReturnValue(oneSlide({ headline: 'A line' }));
    await parseForCompose(detailMastersRecipe, 'the angle', {
      model: 'm',
      plan: ['the hook', 'the proof', 'the ask'],
    });
    const user = userOf(aiCalls[0]!);
    expect(user).toContain('SLIDES: exactly 3');
    expect(user).toContain('1. the hook');
    expect(user).toContain('3. the ask');
  });

  it('without a plan the count is a range derived from how much material there is', async () => {
    reply.mockReturnValue(oneSlide({ headline: 'A line' }));
    await parseForCompose(detailMastersRecipe, 'a short idea', { model: 'm' });
    expect(userOf(aiCalls[0]!)).toMatch(/SLIDES: 3–5/);

    aiCalls.length = 0;
    await parseForCompose(detailMastersRecipe, 'a short idea', {
      model: 'm',
      sources: [{ url: 'u', title: 't', text: 'x'.repeat(9000) }],
    });
    expect(userOf(aiCalls[0]!)).toMatch(/SLIDES: 9–10/);
  });

  it('names locked copy up front, and corrects the parse once when it is missing', async () => {
    reply
      .mockReturnValueOnce(oneSlide({ headline: 'Read the calendar' })) // reworded
      .mockReturnValueOnce(oneSlide({ headline: 'Read the water, not the calendar' }));
    const out = await parseForCompose(detailMastersRecipe, 'brief', {
      model: 'm',
      locks: ['Read the water, not the calendar'],
    });
    expect(userOf(aiCalls[0]!)).toContain('VERBATIM');
    expect(userOf(aiCalls[1]!, 2)).toContain('had to appear EXACTLY as written');
    expect(out[0]!.parts.headline).toBe('Read the water, not the calendar');
  });

  it('never clamps locked copy, however far over budget it runs', async () => {
    const lock = 'Judge the coating after a proper decontamination wash, never before it';
    expect(lock.length).toBeGreaterThan(60);
    reply.mockReturnValue(oneSlide({ headline: lock }));
    const out = await parseForCompose(detailMastersRecipe, 'brief', { model: 'm', locks: [lock] });
    expect(out[0]!.parts.headline).toBe(lock);
    expect(warnings().some((w) => w.includes('carries locked copy'))).toBe(true);
  });

  it('clamps over-long prose to a finished clause instead of an ellipsis', async () => {
    const body =
      'Proper reapplication means removing what remains, correcting the paint, and starting again from bare ' +
      'lacquer on every panel.';
    reply.mockReturnValue(oneSlide({ body: `${body} It is a real job, not a top-up between washes.` }));
    const out = await parseForCompose(detailMastersRecipe, 'brief', { model: 'm' });
    expect(out[0]!.parts.body!.endsWith('…')).toBe(false);
    expect(body.startsWith(out[0]!.parts.body!.replace(/[.,]$/, ''))).toBe(true);
  });

  it('lifts an inline "Slide N" plan and quoted copy straight out of the idea', async () => {
    reply.mockImplementation((params) =>
      sysOf(params).includes('STRICT JSON')
        ? oneSlide({ headline: 'say this exactly' })
        : '<div class="headline">say this exactly</div>',
    );
    await composeProject(detailMastersRecipe, 'Slide 1: open with "say this exactly"\nSlide 2: then the proof', {
      renderCheck: false,
    });
    const user = userOf(aiCalls[0]!);
    expect(user).toContain('SLIDES: exactly 2');
    expect(user).toContain('"say this exactly"');
    expect(user).toContain('VERBATIM');
  });
});

describe('the parsed deck is made structurally honest', () => {
  const deck = (slides: unknown[]) => JSON.stringify({ slides });

  it('keeps the rows when a slide asks for both a photograph and a list', async () => {
    reply.mockReturnValue(
      deck([{ role: 'list', image: true, parts: { headline: 'Two things', rows: [{ text: 'a' }, { text: 'b' }] } }]),
    );
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.photo).toBe(false);
    expect(out[0]!.parts.rows).toHaveLength(2);
    expect(warnings().some((w) => w.includes('keeping the rows'))).toBe(true);
  });

  it('re-roles a list that came back with nothing in it', async () => {
    reply.mockReturnValue(deck([{ role: 'list', parts: { headline: 'Two things', body: 'and their detail' } }]));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.role).toBe('feature');
    expect(warnings().some((w) => w.includes('list with no rows'))).toBe(true);
  });

  /** A brand whose cover is typographic and whose feature slide holds a picture. */
  const withFragments = {
    ...detailMastersRecipe,
    fragments: {
      cover: '<div class="headline">{{headline}}</div>',
      feature: '<div class="headline">{{headline}}</div>\n<figure class="cb-shot" data-cb-slot="hero"></figure>',
    },
  };

  it('refuses a photo where the brand’s own composition cannot hold one', async () => {
    reply.mockReturnValue(deck([{ role: 'cover', image: true, parts: { headline: 'A hook' } }]));
    const out = await parseForCompose(withFragments, 'idea', { model: 'm', photoBudget: 4 });
    expect(out[0]!.photo).toBe(false);
    expect(warnings().some((w) => w.includes('nowhere to put one'))).toBe(true);
  });

  it('allows one where it can — the feature fragment has a slot', async () => {
    reply.mockReturnValue(deck([{ role: 'feature', image: true, parts: { headline: 'A hook' } }]));
    const out = await parseForCompose(withFragments, 'idea', { model: 'm', photoBudget: 4 });
    expect(out[0]!.photo).toBe(true);
  });

  it('leaves the judgement alone when no library size was supplied', async () => {
    reply.mockReturnValue(deck([{ role: 'feature', image: true, parts: { headline: 'A hook' } }]));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.photo).toBe(true);
  });

  it('asks for no photograph at all when the brand has none to fill it with', async () => {
    reply.mockReturnValue(
      deck([
        { role: 'feature', image: true, parts: { headline: 'One' } },
        { role: 'feature', image: true, parts: { headline: 'Two' } },
      ]),
    );
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', photoBudget: 1 });
    expect(out.map((s) => s.photo)).toEqual([true, false]);
    expect(warnings().some((w) => w.includes('none left to fill it'))).toBe(true);
  });
});

describe('clamping a display line reads as written short, not cut', () => {
  const oneSlide = (parts: Record<string, unknown>) =>
    JSON.stringify({ slides: [{ role: 'statement', parts }] });

  it('drops a trailing preposition or article rather than dangling on it', async () => {
    // Cutting at the word boundary alone left the line dangling on "of".
    reply.mockReturnValue(oneSlide({ eyebrow: 'A truly workable rule of thumb', headline: 'Anything' }));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.parts.eyebrow).toBe('A truly workable rule');
  });

  it('never strips a line down to nothing', async () => {
    reply.mockReturnValue(oneSlide({ eyebrow: 'Notwithstandingly extended single token', headline: 'x' }));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.parts.eyebrow!.length).toBeGreaterThan(0);
  });
});

describe('markdown is not copy', () => {
  const oneSlide = (parts: Record<string, unknown>) =>
    JSON.stringify({ slides: [{ role: 'statement', parts }] });

  it('removes the asterisks and promotes what they marked to the accent', async () => {
    reply.mockReturnValue(
      oneSlide({ headline: "Not 'how long has it been?' — *where is it now?*", body: 'A **best case**, not a deadline.' }),
    );
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.parts.headline).toBe("Not 'how long has it been?' — where is it now?");
    expect(out[0]!.parts.body).toBe('A best case, not a deadline.');
    expect(out[0]!.parts.emphasis).toBe('where is it now?');
  });

  it('does not overrule an emphasis the copywriter named itself', async () => {
    reply.mockReturnValue(oneSlide({ headline: 'A dull car is *a dirty car*', emphasis: 'a dirty car' }));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.parts.emphasis).toBe('a dirty car');
  });

  it('measures the budget in words that will be printed, not in markers', async () => {
    // 62 chars with the asterisks, 60 without — inside the headline budget.
    const marked = '*Reapplying early wastes the coating you have already paid*';
    expect(marked.length).toBe(59);
    reply.mockReturnValue(oneSlide({ headline: marked }));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.parts.headline).toBe('Reapplying early wastes the coating you have already paid');
  });

  it('leaves a handle’s underscores alone — they are a name, not emphasis', async () => {
    reply.mockReturnValue(oneSlide({ headline: 'A line', handle: '@detail_masters_pro' }));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.parts.handle).toBe('@detail_masters_pro');
  });
});

describe('prose is shortened by the sentence, not mid-thought', () => {
  it('drops the trailing sentence rather than amputating it', async () => {
    const body =
      'Those numbers describe a best case. A coating wears down unevenly, starting where the car takes the ' +
      'most abuse and never quite recovering from the neglect afterwards.';
    expect(body.length).toBeGreaterThan(150);
    reply.mockReturnValue(JSON.stringify({ slides: [{ role: 'statement', parts: { body } }] }));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(out[0]!.parts.body).toBe('Those numbers describe a best case.');
  });

  it('falls back to a clause when not even the first sentence fits', async () => {
    const body =
      'A coating does not stop working on a particular date, it wears down unevenly across the whole car, ' +
      'fastest on the panels that take the weather and the washing.';
    expect(body.split('. ')).toHaveLength(1); // one sentence — nothing to drop
    reply.mockReturnValue(JSON.stringify({ slides: [{ role: 'statement', parts: { body } }] }));
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    const got = out[0]!.parts.body!;
    expect(got.length).toBeLessThanOrEqual(150);
    expect(got.endsWith('…')).toBe(false);
    expect(body.startsWith(got.replace(/[.,]$/, ''))).toBe(true);
  });
});

describe('a deck that says the same thing twice', () => {
  const slide = (parts: Record<string, unknown>, role = 'statement') => ({ role, parts });

  it('catches two slides making one point, and corrects once', async () => {
    const twice = JSON.stringify({
      slides: [
        slide({ headline: 'Coatings are sold with a number attached' }, 'cover'),
        slide({ headline: 'Beading flattens as the coating wears down', body: 'Water clings in patches instead of sheeting off the panel.' }),
        slide({ headline: 'As the coating wears, beading flattens', body: 'Water clings to the panel in patches rather than sheeting.' }),
        slide({ headline: 'Book an inspection today' }, 'cta'),
      ],
    });
    const fixed = JSON.stringify({
      slides: [
        slide({ headline: 'Coatings are sold with a number attached' }, 'cover'),
        slide({ headline: 'Beading flattens as the coating wears down', body: 'Water clings in patches instead of sheeting off the panel.' }),
        slide({ headline: 'Brush washes abrade the clear coat', body: 'Automatic machines grind grit across every horizontal surface.' }),
        slide({ headline: 'Book an inspection today' }, 'cta'),
      ],
    });
    reply.mockReturnValueOnce(twice).mockReturnValueOnce(fixed);
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });

    expect(aiCalls).toHaveLength(2);
    expect(userOf(aiCalls[1]!, 2)).toContain('make the same point twice');
    expect(userOf(aiCalls[1]!, 2)).toContain('slide 2 and slide 3');
    expect(out[2]!.parts.headline).toBe('Brush washes abrade the clear coat');
  });

  it('exempts the cover and the cta — restating the thesis is their job', async () => {
    reply.mockReturnValue(
      JSON.stringify({
        slides: [
          slide({ headline: 'Reapply a ceramic coating later than you think', body: 'The number on the bottle is a best case, never a deadline.' }, 'cover'),
          slide({ headline: 'Reapply a ceramic coating later than you think', body: 'The number on the bottle is a best case, never a deadline.' }, 'cta'),
        ],
      }),
    );
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(aiCalls).toHaveLength(1); // nothing to correct
  });

  it('will not judge a slide with too little to say', async () => {
    reply.mockReturnValue(
      JSON.stringify({
        slides: [
          slide({ eyebrow: 'Read water', headline: 'Read the water' }),
          slide({ eyebrow: 'Read water', headline: 'Read the water' }),
        ],
      }),
    );
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' });
    expect(aiCalls).toHaveLength(1);
  });

  it('keeps the original when the correction dropped locked copy to fix the repeat', async () => {
    const lock = 'Read the water, not the calendar';
    const first = JSON.stringify({
      slides: [
        slide({ headline: lock, body: 'Beading flattens and water clings in patches as it wears.' }),
        slide({ headline: 'Beading flattens as it wears', body: 'Water clings in patches instead of sheeting off the panel.' }),
      ],
    });
    const worse = JSON.stringify({
      slides: [slide({ headline: 'Something else entirely', body: 'With none of the words you asked for.' })],
    });
    reply.mockReturnValueOnce(first).mockReturnValueOnce(worse);
    const out = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', locks: [lock] });
    expect(out[0]!.parts.headline).toBe(lock);
  });
});

describe('a plan entry that asks for a shape', () => {
  it('tells the copywriter which role each entry reads as', async () => {
    reply.mockReturnValue(JSON.stringify({ slides: [{ role: 'statement', parts: { headline: 'A line' } }] }));
    await parseForCompose(detailMastersRecipe, 'idea', {
      model: 'm',
      plan: ['The two wear signals, as a list of two', 'A pull quote from the piece', 'Just say something true'],
    });
    const user = userOf(aiCalls[0]!);
    expect(user).toContain('1. The two wear signals, as a list of two   [reads as role "list"]');
    expect(user).toContain('2. A pull quote from the piece   [reads as role "quote"]');
    expect(user).toContain('3. Just say something true');
    expect(user).not.toContain('3. Just say something true   [reads as role');
  });
});

describe('an explicit slideCount is honoured', () => {
  const deckOf = (n: number) =>
    JSON.stringify({
      slides: Array.from({ length: n }, (_, i) => ({
        role: i === 0 ? 'cover' : 'statement',
        parts: { headline: `slide ${i + 1}` },
      })),
    })

  /**
   * `fixed` has two sources — a plan, and an explicit `slideCount` — and the
   * guidance used to read the PLAN's length in both cases. A caller passing
   * `slideCount: 6` with no plan was told "SLIDES: exactly 0 — one per SLIDE
   * PLAN entry", which is not followable; the real run returned 8.
   */
  it('asks for the requested number, not the (empty) plan length', async () => {
    reply.mockReturnValue(deckOf(6))
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', slideCount: 6 })

    const user = userOf(aiCalls[0]!)
    expect(user).toContain('SLIDES: exactly 6')
    expect(user).not.toContain('exactly 0')
  })

  it('still points at the plan when there is one', async () => {
    reply.mockReturnValue(deckOf(2))
    await parseForCompose(detailMastersRecipe, 'idea', {
      model: 'm',
      plan: ['open on the problem', 'close on the offer'],
    })

    expect(userOf(aiCalls[0]!)).toContain('SLIDES: exactly 2 — one per SLIDE PLAN entry')
  })

  it('trims a deck that came back longer than asked for', async () => {
    // Asked for 3, given 5. Trimming only: inventing a slide to reach a floor
    // would be the padding the range guidance forbids.
    reply.mockReturnValue(deckOf(5))
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', slideCount: 3 })

    expect(inputs).toHaveLength(3)
    expect(inputs[0]!.parts.headline).toBe('slide 1')
    expect(inputs[2]!.parts.headline).toBe('slide 3')
  })

  it('leaves a shorter deck alone rather than padding it', async () => {
    reply.mockReturnValue(deckOf(2))
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', slideCount: 5 })
    expect(inputs).toHaveLength(2)
  })
})

describe('parse guards on what each hole may carry', () => {
  const deck = (parts: Record<string, unknown>, role = 'statement') =>
    JSON.stringify({ slides: [{ role, parts }] })

  it('drops an eyebrow that only repeats its own headline', async () => {
    reply.mockReturnValue(deck({ eyebrow: 'Raise the average', headline: 'Raise the average ticket' }))
    const slide = (await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' }))[0]!
    expect(slide.parts.eyebrow).toBeUndefined()
    expect(slide.parts.headline).toBe('Raise the average ticket')
  })

  it('keeps an eyebrow that adds what the headline does not say', async () => {
    reply.mockReturnValue(deck({ eyebrow: 'Ticket médio', headline: 'Raise the average ticket' }))
    const slide = (await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' }))[0]!
    expect(slide.parts.eyebrow).toBe('Ticket médio')
  })

  it('drops the lower-ranked hole when two carry the same line', async () => {
    // The stat slide that shipped with its figure and its headline identical.
    reply.mockReturnValue(deck({ headline: 'Two in five never come back', stat: 'Two in five never come back' }, 'stat'))
    const slide = (await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' }))[0]!
    expect(slide.parts.headline).toBe('Two in five never come back')
    expect(slide.parts.stat).toBeUndefined()
  })

  it('composes a stat slide with no stat as something else', async () => {
    reply.mockReturnValue(deck({ headline: 'Most cars come back', body: 'Because the smell was never in the air.' }, 'stat'))
    const slide = (await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' }))[0]!
    expect(slide.role).not.toBe('stat')
    expect(slide.role).toBe('feature')
  })

  it('leaves a stat slide that actually has a figure', async () => {
    reply.mockReturnValue(deck({ headline: 'Repeat work', stat: '3 in 5' }, 'stat'))
    const slide = (await parseForCompose(detailMastersRecipe, 'idea', { model: 'm' }))[0]!
    expect(slide.role).toBe('stat')
    expect(slide.parts.stat).toBe('3 in 5')
  })
})

// ── Unfinished copy ──────────────────────────────────────────────────────────

describe('trimToFinished — the repair the correction never had', () => {
  it('cuts back to the last complete sentence when a line abandoned another', () => {
    expect(trimToFinished('Cash lands first. Slow weeks are funded. And then')).toBe(
      'Cash lands first. Slow weeks are funded.',
    );
  });

  it('drops trailing words that leave a phrase open', () => {
    // The exact line that shipped on a closing slide.
    expect(trimToFinished('Your next quiet week is already')).toBe('Your next quiet week');
  });

  it('leaves a finished line alone', () => {
    expect(trimToFinished('Foam and carpet decide the result.')).toBeNull();
    expect(trimToFinished('Never sell a discount')).toBeNull();
  });

  it('refuses to leave a stub nobody wrote', () => {
    // Trimming this leaves one word; better to flag the slide than to ship it.
    expect(trimToFinished('January is already')).toBeNull();
  });

  it('never invents words — everything it returns was in the original', () => {
    const original = 'A busy December fixes nothing if January is';
    const out = trimToFinished(original);
    expect(out).not.toBeNull();
    expect(original.startsWith(out!)).toBe(true);
  });
});
