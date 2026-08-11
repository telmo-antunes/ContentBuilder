import { describe, expect, it } from 'vitest';
import {
  MIN_OBSERVATIONS,
  budgetAfterLessons,
  deriveLessons,
  lessonsBlock,
  variantBiasFromLessons,
  type ObservedGeneration,
  type PartEdit,
} from './learning';

/** One generation in which a single slide was edited in the given ways. */
function gen(id: string, edits: PartEdit[], at = `2026-08-0${id}T00:00:00.000Z`): ObservedGeneration {
  return {
    id,
    projectId: `p${id}`,
    title: `Post ${id}`,
    at,
    outcome: {
      at,
      exported: true,
      added: 0,
      slides: [{ slideId: 's1', role: 'statement', verdict: 'edited', edits }],
    },
  };
}

const shorten = (part: PartEdit['part'], before: string, after: string): PartEdit => ({ part, before, after });

describe('deriveLessons — one edit is noise', () => {
  it('learns nothing from a single correction, however dramatic', () => {
    expect(
      deriveLessons([gen('1', [shorten('headline', 'A headline that runs on and on and on', 'Short')])]),
    ).toEqual([]);
  });

  it('learns nothing from generations that were never observed', () => {
    expect(deriveLessons([{ id: '1', projectId: 'p1', at: '2026-08-01T00:00:00.000Z' }])).toEqual([]);
  });

  it('needs the same correction MIN_OBSERVATIONS times', () => {
    const one = shorten('headline', 'A headline that runs on and on and on here', 'A tighter headline');
    const under = deriveLessons(Array.from({ length: MIN_OBSERVATIONS - 1 }, (_, i) => gen(String(i + 1), [one])));
    expect(under.filter((l) => l.kind === 'shorter')).toEqual([]);
    const over = deriveLessons(Array.from({ length: MIN_OBSERVATIONS }, (_, i) => gen(String(i + 1), [one])));
    expect(over.some((l) => l.id === 'shorter:headline')).toBe(true);
  });
});

describe('deriveLessons — what it learns', () => {
  it('reports the MEDIAN shrink, so one total rewrite cannot skew it', () => {
    const lessons = deriveLessons([
      gen('1', [shorten('headline', 'A headline of about forty characters!!', 'A headline of about thirty')]),
      gen('2', [shorten('headline', 'A headline of about forty characters!!', 'A headline of about thirty')]),
      gen('3', [shorten('headline', 'A headline of about forty characters!!', 'Tiny')]),
    ]);
    const l = lessons.find((x) => x.id === 'shorter:headline')!;
    expect(l.observations).toBe(3);
    expect(l.amount).toBe(12); // the median, not the 34-char outlier
    expect(l.instruction).toContain('12 characters shorter');
    expect(l.evidence).toHaveLength(3);
    // Newest correction first — the most recent opinion is the most current one.
    expect(l.evidence[0]!.title).toBe('Post 3');
  });

  it('ignores a trim below the character floor — that is a typo fix', () => {
    const tiny = shorten('headline', 'A headline of about forty characters!!', 'A headline of about forty characters');
    expect(deriveLessons([gen('1', [tiny]), gen('2', [tiny]), gen('3', [tiny])])).toEqual([]);
  });

  it('ignores a trim that is a rounding error on a long line', () => {
    // 8 characters is over the floor, but 4% of the line is not a preference.
    const long = `A headline that goes on for a very long time indeed ${'and on '.repeat(20)}`;
    // Punctuation, so the only thing under test is the LENGTH ratio — an
            // eight-letter word taken out three times is a word lesson, correctly.
    const trimmed = shorten('body', `${long}!!!!!!!!`, long);
    expect(deriveLessons([gen('1', [trimmed]), gen('2', [trimmed]), gen('3', [trimmed])])).toEqual([]);
  });

  it('learns that a part is deleted, not shortened', () => {
    const killed = shorten('tagline', 'One decision, repeated daily.', '');
    const l = deriveLessons([gen('1', [killed]), gen('2', [killed]), gen('3', [killed])]).find(
      (x) => x.id === 'drops-part:tagline',
    )!;
    expect(l.observations).toBe(3);
    expect(l.instruction).toContain('deletes the tagline');
    expect(l.summary).toContain('3 times');
  });

  it('learns that a whole role gets cut — but only when most of them are', () => {
    const dropped = (id: string, verdicts: Array<'kept' | 'dropped'>): ObservedGeneration => ({
      id,
      projectId: `p${id}`,
      at: `2026-08-0${id}T00:00:00.000Z`,
      outcome: {
        at: `2026-08-0${id}T00:00:00.000Z`,
        exported: true,
        added: 0,
        slides: verdicts.map((v, i) => ({ slideId: `s${i}`, role: 'quote', verdict: v })),
      },
    });
    // 2 of 2 dropped: a habit.
    expect(
      deriveLessons([dropped('1', ['dropped']), dropped('2', ['dropped'])]).some((l) => l.id === 'drops-role:quote'),
    ).toBe(true);
    // 2 of 8 dropped: the deck was trimmed, the role was not rejected.
    expect(
      deriveLessons([
        dropped('1', ['dropped', 'kept', 'kept', 'kept']),
        dropped('2', ['dropped', 'kept', 'kept', 'kept']),
      ]).some((l) => l.id === 'drops-role:quote'),
    ).toBe(false);
  });

  it('learns a word that is always taken out', () => {
    const e = shorten('body', 'This is a seamless and effortless solution', 'This is a simple solution');
    const l = deriveLessons([gen('1', [e]), gen('2', [e]), gen('3', [e])]).find(
      (x) => x.id === 'avoids-word:seamless',
    )!;
    expect(l.instruction).toContain('Do not use the word "seamless"');
  });

  it('refuses to learn a word that is both added and removed', () => {
    const out = shorten('body', 'We deliver premium results', 'We deliver results');
    const inn = shorten('body', 'We deliver results', 'We deliver premium results');
    const lessons = deriveLessons([gen('1', [out]), gen('2', [out]), gen('3', [out]), gen('4', [inn])]);
    expect(lessons.some((l) => l.subject === 'premium')).toBe(false);
  });

  it('puts the most-agreed lesson first', () => {
    const short = shorten('headline', 'A headline of about forty characters!!', 'A headline of about thirty');
    const kill = shorten('tagline', 'One decision, repeated daily.', '');
    const lessons = deriveLessons([
      gen('1', [short, kill]),
      gen('2', [short, kill]),
      gen('3', [short, kill]),
      gen('4', [short]),
    ]);
    expect(lessons[0]!.observations).toBeGreaterThanOrEqual(lessons[lessons.length - 1]!.observations);
  });
});

describe('applying the lessons', () => {
  const lesson = deriveLessons([
    gen('1', [shorten('headline', 'A headline of about forty characters!!', 'A headline of about thirty')]),
    gen('2', [shorten('headline', 'A headline of about forty characters!!', 'A headline of about thirty')]),
    gen('3', [shorten('headline', 'A headline of about forty characters!!', 'A headline of about thirty')]),
  ]);

  it('rides in the prompt as an instruction, with its provenance stated', () => {
    const block = lessonsBlock(lesson);
    expect(block).toContain('WHAT THIS BRAND HAS TAUGHT YOU');
    expect(block).toContain('corrections its owner made');
    expect(block).toContain('12 characters shorter');
  });

  it('is empty for a brand that has taught nothing', () => {
    expect(lessonsBlock([])).toBe('');
  });

  it('moves the copy budget too — a sentence can be ignored, a number cannot', () => {
    const out = budgetAfterLessons({ eyebrow: 26, headline: 60, body: 90, cta: 24, rowText: 42 }, lesson);
    expect(out.headline).toBe(48);
    expect(out.body).toBe(90); // untouched
  });

  it('never collapses a budget below a floor, however aggressive the edits', () => {
    const brutal = deriveLessons([
      gen('1', [shorten('headline', 'x'.repeat(200), 'ok')]),
      gen('2', [shorten('headline', 'x'.repeat(200), 'ok')]),
      gen('3', [shorten('headline', 'x'.repeat(200), 'ok')]),
    ]);
    expect(budgetAfterLessons({ headline: 60 }, brutal).headline).toBe(36); // 60 × 0.6
  });

  it('only ever shortens — nobody has asked the app to write more', () => {
    const grew = deriveLessons([
      gen('1', [shorten('headline', 'Short', 'A much longer headline than before')]),
      gen('2', [shorten('headline', 'Short', 'A much longer headline than before')]),
      gen('3', [shorten('headline', 'Short', 'A much longer headline than before')]),
    ]);
    expect(budgetAfterLessons({ headline: 60 }, grew).headline).toBe(60);
  });
});

// ── The three signals the copy diff cannot see ──────────────────────────────

/** A generation whose slides carry non-copy signals rather than edits. */
function moved(id: string, slides: Array<{ role: string; moved?: number; rearranged?: boolean; tweaks?: Array<{ kind: string; chars?: number }> }>): ObservedGeneration {
  const at = `2026-08-0${id}T00:00:00.000Z`;
  return {
    id,
    projectId: `p${id}`,
    title: `Post ${id}`,
    at,
    outcome: {
      at,
      exported: true,
      added: 0,
      slides: slides.map((s, i) => ({
        slideId: `s${i}`,
        role: s.role,
        verdict: 'kept' as const,
        ...(s.moved !== undefined ? { moved: s.moved } : {}),
        ...(s.rearranged ? { rearranged: true } : {}),
        ...(s.tweaks ? { tweaks: s.tweaks as never } : {}),
      })),
    },
  };
}

describe('a reorder is an edit the copy diff cannot see', () => {
  it('learns where a role belongs when the moves agree on a direction', () => {
    const l = deriveLessons([
      moved('1', [{ role: 'quote', moved: 2 }]),
      moved('2', [{ role: 'quote', moved: 3 }]),
      moved('3', [{ role: 'quote', moved: 2 }]),
    ]).find((x) => x.id === 'moves-role:quote:later')!;
    expect(l.observations).toBe(3);
    expect(l.amount).toBe(2);
    expect(l.instruction).toContain('nearer the end');
    expect(l.summary).toBe('You move quote slides later — 3 times.');
    expect(l.evidence[0]!.after).toContain('places later');
  });

  it('learns nothing when a role is shoved both ways — that is a reshuffle', () => {
    expect(
      deriveLessons([
        moved('1', [{ role: 'stat', moved: 2 }]),
        moved('2', [{ role: 'stat', moved: -2 }]),
        moved('3', [{ role: 'stat', moved: 2 }]),
      ]).some((x) => x.kind === 'moves-role'),
    ).toBe(false);
  });

  it('ignores a slide that did not actually move', () => {
    expect(
      deriveLessons([
        moved('1', [{ role: 'stat', moved: 0 }]),
        moved('2', [{ role: 'stat', moved: 0 }]),
        moved('3', [{ role: 'stat', moved: 0 }]),
      ]),
    ).toEqual([]);
  });
});

describe('pressing "smaller headline" is the same statement as retyping it shorter', () => {
  const press = [{ kind: 'smaller-headline', chars: 50 }];

  it('counts a press as a shortening, with a magnitude taken from the line', () => {
    const l = deriveLessons([
      moved('1', [{ role: 'statement', tweaks: press }]),
      moved('2', [{ role: 'statement', tweaks: press }]),
      moved('3', [{ role: 'statement', tweaks: press }]),
    ]).find((x) => x.id === 'shorter:headline')!;
    expect(l.observations).toBe(3);
    expect(l.amount).toBe(9); // 18% of a 50-character headline
    expect(l.evidence[0]!.after).toContain('smaller headline');
  });

  it('nets a withdrawal — bigger after smaller is not two opinions', () => {
    const both = [{ kind: 'smaller-headline', chars: 50 }, { kind: 'bigger-headline' }];
    expect(
      deriveLessons([
        moved('1', [{ role: 'statement', tweaks: both }]),
        moved('2', [{ role: 'statement', tweaks: both }]),
        moved('3', [{ role: 'statement', tweaks: both }]),
      ]),
    ).toEqual([]);
  });

  it('pools presses with typed edits — two ways of saying one thing', () => {
    const typed = gen('1', [shorten('headline', 'A headline of about forty characters!!', 'A headline of about thirty')]);
    const lessons = deriveLessons([typed, moved('2', [{ role: 'statement', tweaks: press }]), moved('3', [{ role: 'statement', tweaks: press }])]);
    const l = lessons.find((x) => x.id === 'shorter:headline')!;
    expect(l.observations).toBe(3);
  });

  it('says nothing about an invert — that is a surface, not a sentence', () => {
    const inv = [{ kind: 'invert' }];
    expect(
      deriveLessons([
        moved('1', [{ role: 'statement', tweaks: inv }]),
        moved('2', [{ role: 'statement', tweaks: inv }]),
        moved('3', [{ role: 'statement', tweaks: inv }]),
      ]),
    ).toEqual([]);
  });
});

describe('swapping an arrangement rejects a composition', () => {
  it('learns that a role’s first arrangement is the wrong one', () => {
    const l = deriveLessons([
      moved('1', [{ role: 'feature', rearranged: true }]),
      moved('2', [{ role: 'feature', rearranged: true }]),
      moved('3', [{ role: 'feature', rearranged: true }]),
    ]).find((x) => x.id === 'rearranges-role:feature')!;
    expect(l.observations).toBe(3);
    expect(l.instruction).toContain('is not the one they want');
  });

  it('moves the composer exactly one variant along — no further', () => {
    const lessons = deriveLessons([
      moved('1', [{ role: 'feature', rearranged: true }]),
      moved('2', [{ role: 'feature', rearranged: true }]),
      moved('3', [{ role: 'feature', rearranged: true }]),
    ]);
    expect(variantBiasFromLessons(lessons)).toEqual({ feature: 1 });
  });

  it('biases nothing for a brand that has never swapped one', () => {
    expect(variantBiasFromLessons([])).toEqual({});
  });
});
