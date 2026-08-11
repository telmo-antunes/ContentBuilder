import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  MAX_RUN,
  archetypeFor,
  assignArchetypes,
  isArchetype,
  slideArchetypeCss,
  planInversion,
  type ArchetypeKey,
} from './archetypes';

const deck = (...roles: string[]) => roles.map((role) => ({ role, hasPhoto: false }));

describe('assignArchetypes', () => {
  it('never lets one composition run more than MAX_RUN slides', () => {
    // Six statements in a row is the shape that produced "one slide repeated".
    const out = assignArchetypes(deck('statement', 'statement', 'statement', 'statement', 'statement', 'statement'));
    let run = 1;
    for (let i = 1; i < out.length; i += 1) {
      run = out[i] === out[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(MAX_RUN);
    }
  });

  /**
   * An empty `cb-shot` renders as a dead grey rectangle — worse than the
   * text-only composition it replaced. So a photo archetype is only reachable
   * when a picture exists.
   */
  it('never picks a photo archetype for a slide with no photo', () => {
    const out = assignArchetypes(deck('cover', 'feature'));
    for (const key of out) expect(ARCHETYPES[key].photo).not.toBe('required');
  });

  it('uses the photo archetypes once a picture is there', () => {
    const out = assignArchetypes([{ role: 'cover', hasPhoto: true }]);
    expect(ARCHETYPES[out[0]!].photo).toBe('required');
  });

  it('keeps a list a list — a role never wears a composition that misreads it', () => {
    const out = assignArchetypes(deck('list', 'list', 'list'));
    expect(out).toEqual(['list', 'list', 'list']);
  });

  it('assigns one archetype per slide, always valid', () => {
    const out = assignArchetypes(deck('cover', 'statement', 'quote', 'feature', 'stat', 'list', 'cta'));
    expect(out).toHaveLength(7);
    for (const key of out) expect(isArchetype(key)).toBe(true);
  });

  it('falls back rather than leaving a slide uncomposed', () => {
    const out = assignArchetypes(deck('something-nobody-defined'));
    expect(isArchetype(out[0]!)).toBe(true);
  });

  it('is deterministic', () => {
    const d = deck('cover', 'statement', 'statement', 'list', 'cta');
    expect(assignArchetypes(d)).toEqual(assignArchetypes(d));
  });
});

describe('slideArchetypeCss', () => {
  const css = slideArchetypeCss();

  it('gives every archetype a slack policy', () => {
    for (const key of ARCHETYPE_KEYS) {
      expect(css).toContain(`.cb-slide[data-archetype="${key}"]{justify-content:`);
    }
  });

  /**
   * The load-bearing line. Brands bottom-anchor with a flex-grow spacer and the
   * composer scatters more per slide; leaving them live means the archetype and
   * the markup fight over the same space and the markup wins.
   */
  it('neutralises stray fill spacers where the archetype owns the slack', () => {
    expect(css).toContain('.cb-slide[data-archetype="statement"] > .fill{flex:0 0 0');
  });

  it('keeps them under "between", which is the one policy that wants an interior gap', () => {
    const between = ARCHETYPE_KEYS.filter((k) => ARCHETYPES[k].slack === 'between');
    expect(between.length).toBeGreaterThan(0);
    for (const key of between) {
      expect(css).not.toContain(`.cb-slide[data-archetype="${key}"] > .fill{flex:0 0 0`);
    }
  });

  it('scopes every rule to the slide root', () => {
    for (const line of css.split('\n')) expect(line.startsWith('.cb-slide')).toBe(true);
  });
});

describe('archetypeFor', () => {
  it('returns undefined for anything unknown, rather than a default', () => {
    expect(archetypeFor('nope')).toBeUndefined();
    expect(archetypeFor(undefined)).toBeUndefined();
    expect(archetypeFor('statement')?.slack).toBe('center');
  });
});

describe('planInversion', () => {
  const deck = (...keys: string[]) => keys as never as ArchetypeKey[];

  it('does nothing when the brand authored no inverse surface', () => {
    expect(planInversion(deck('showcase', 'statement', 'banner', 'list', 'cta'), false)).toBeUndefined();
  });

  /** Under five slides the deck is over before a rhythm registers. */
  it('does nothing on a deck too short to have a middle', () => {
    expect(planInversion(deck('showcase', 'statement', 'cta'), true)).toBeUndefined();
  });

  it('marks exactly one slide', () => {
    const out = planInversion(deck('showcase', 'statement', 'banner', 'list', 'pull', 'statement', 'cta'), true);
    expect(typeof out).toBe('number');
  });

  it('never the cover — it earns the swipe', () => {
    const out = planInversion(deck('statement', 'statement', 'banner', 'list', 'cta'), true);
    expect(out).not.toBe(0);
  });

  it('never the closing slide — the CTA lands harder returning to the brand ground', () => {
    const keys = deck('showcase', 'statement', 'banner', 'list', 'cta');
    expect(planInversion(keys, true)).not.toBe(keys.length - 1);
  });

  /**
   * An inverted surface under a photograph that covers the frame changes
   * nothing except the type it has to fight.
   */
  it('never a full-bleed slide', () => {
    const keys = deck('banner', 'showcase', 'showcase', 'showcase', 'cta');
    const out = planInversion(keys, true);
    // Only index 0 and 4 are non-bleed, and both are excluded as ends.
    expect(out).toBeUndefined();
  });

  it('picks the eligible slide nearest the middle', () => {
    // indices 1..5 eligible; midpoint of a 7-slide deck is 3.
    const out = planInversion(deck('showcase', 'statement', 'banner', 'list', 'pull', 'statement', 'cta'), true);
    expect(out).toBe(3);
  });

  it('is deterministic', () => {
    const keys = deck('showcase', 'statement', 'banner', 'list', 'pull', 'statement', 'cta');
    expect(planInversion(keys, true)).toBe(planInversion(keys, true));
  });
});
