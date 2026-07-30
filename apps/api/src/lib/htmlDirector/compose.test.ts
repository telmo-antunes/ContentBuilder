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
  return {
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

const { composeSlide, composeProject, parseForCompose } = await import('./compose');
const { detailMastersRecipe } = await import('./recipes');
const { sanitizeAuthoredHtml } = await import('../htmlSanitize');
const { SLIDE_AUTHOR_INSTRUCTIONS } = await import('./prompt');
const { brandRecipeSchema } = await import('@contentbuilder/shared');

const sysOf = (c: Anthropic.MessageCreateParamsNonStreaming): string =>
  typeof c.system === 'string' ? c.system : '';
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
          return script(item.html, item.index, nth++);
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
  /** Slide 1 comes back with a rule — the furniture step 2 is allowed to take. */
  const composeReply = (params: Anthropic.MessageCreateParamsNonStreaming): string => {
    if (sysOf(params).includes('STRICT JSON')) return THREE;
    const n = userOf(params).match(/Slide (\d+) headline stands alone/)?.[1] ?? '?';
    return (
      `<div class="headline">Slide ${n} headline stands alone</div>` +
      (n === '1' ? '<div class="rule"></div>' : '')
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

  it('ships the deck unchanged, with one warning and no throw, when the renderer is unreachable', async () => {
    reply.mockImplementation(composeReply);
    const out = await composeProject(detailMastersRecipe, 'an idea', {
      renderProbe: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3100');
      },
    });
    expect(out).toHaveLength(3);
    expect(out[1]!.authored.html).toBe(
      '<div class="headline">Slide 1 headline stands alone</div><div class="rule"></div>',
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

    expect(out[1]!.authored.html).toBe('<div class="headline sm">Slide 1 headline stands alone</div>');
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
    expect(correction).toContain('Tighten every flagged part');

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

  it('states the story format’s reduced budgets in the USER message only', async () => {
    reply.mockReturnValueOnce(tiny);
    await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', format: '1080x1920' });
    const user = userOf(aiCalls[0]!);
    expect(user).toContain('eyebrow <= 18');
    expect(user).toContain('headline <= 48');
    expect(user).toContain('body <= 72');
    expect(user).toContain('cta <= 19');
    expect(user).toContain('rows text <= 34');
    expect(user).toContain('safe area');
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

  it('enforces the story budgets, not the base ones', async () => {
    const headline = 'A headline that fits the post budget but not the story one'; // 59 chars
    expect(headline.length).toBeLessThanOrEqual(60);
    expect(headline.length).toBeGreaterThan(48 * 1.1);
    const json = JSON.stringify({ slides: [{ role: 'cover', parts: { headline } }] });
    reply.mockReturnValueOnce(json).mockReturnValueOnce(json);
    const inputs = await parseForCompose(detailMastersRecipe, 'idea', { model: 'm', format: '1080x1920' });
    expect(aiCalls).toHaveLength(2); // >10% over the story budget → corrective re-parse
    expect(inputs[0]!.parts.headline!.length).toBeLessThanOrEqual(48);
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
    expect(aiCalls[0]!.system).toContain('social-carousel copywriter');
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

  it('keeps the photo slot on the photo slide, and applies the signature emphasis', async () => {
    reply.mockImplementation(() => deck());
    const out = await composeProject(byExample, 'an idea', { renderCheck: false });
    const cover = out[0]!.authored.html;

    expect(cover).toContain('<figure class="cb-shot" data-cb-slot="hero"></figure>');
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
    expect(sysOf(aiCalls[1]!)).toBe(SLIDE_AUTHOR_INSTRUCTIONS);
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
    for (const call of aiCalls.slice(1)) expect(sysOf(call)).toBe(SLIDE_AUTHOR_INSTRUCTIONS);
    // …and its output is byte-identical to what the composer wrote (plus the slot
    // guard's own append on the photo slide, exactly as before).
    expect(out[1]!.authored.html).toBe(composed['list']);
    expect(out[2]!.authored.html).toBe(composed['statement']);
    expect(out[3]!.authored.html).toBe(composed['cta']);
    expect(out[0]!.authored.html).toBe(
      `${composed['cover']}<figure class="cb-shot" data-cb-slot="photo"></figure>`,
    );
    // nothing in the new path so much as logged
    expect(warnings().some((w) => w.includes('fragment'))).toBe(false);
  });
});
