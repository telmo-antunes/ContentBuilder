import { describe, expect, it } from 'vitest';
import {
  containsLock,
  extractQuotedCopy,
  extractUrls,
  missingLocks,
  parseBrief,
  parseSlidePlan,
  slideCountFor,
} from './brief';

describe('extractUrls', () => {
  it('finds a link and strips the sentence punctuation around it', () => {
    expect(extractUrls('Make a carousel from https://detailmasters.pro/en/blog/how-often.')).toEqual([
      'https://detailmasters.pro/en/blog/how-often',
    ]);
    expect(extractUrls('see (https://example.com/a/b), then')).toEqual(['https://example.com/a/b']);
  });

  it('deduplicates, ignores non-http schemes, and caps the list', () => {
    expect(extractUrls('https://a.com/x https://A.com/x mailto:me@a.com ftp://a.com/y')).toEqual([
      'https://a.com/x',
    ]);
  });

  it('returns nothing for a brief with no links', () => {
    expect(extractUrls('three habits that build discipline')).toEqual([]);
  });
});

describe('extractQuotedCopy', () => {
  it('lifts straight and typographic quotes, deduplicated', () => {
    expect(extractQuotedCopy('Use "read the water" and again “read the water” plus "not the calendar"')).toEqual([
      'read the water',
      'not the calendar',
    ]);
  });

  it('does not treat an apostrophe as an opening quote', () => {
    expect(extractQuotedCopy("don't wait — it's fine")).toEqual([]);
  });

  it('never runs a lock across a line break', () => {
    expect(extractQuotedCopy('a "one\ntwo" b')).toEqual([]);
  });
});

describe('parseSlidePlan', () => {
  it('groups the lines of a pasted per-slide plan', () => {
    const { plan, rest } = parseSlidePlan(
      [
        'A carousel about ceramic coatings.',
        'Slide 1 title: How often should you reapply?',
        'Slide 1 description: Coatings are sold with a number attached.',
        'Slide 2 title: Read the water',
        'Slide 2 list: beads get flatter; water stops sheeting',
      ].join('\n'),
    );
    expect(rest).toBe('A carousel about ceramic coatings.');
    expect(plan).toHaveLength(2);
    expect(plan[0]).toContain('title: How often should you reapply?');
    expect(plan[0]).toContain('description: Coatings are sold');
    expect(plan[1]).toContain('list: beads get flatter');
  });

  it('closes gaps in the numbering rather than inventing blank slides', () => {
    const { plan } = parseSlidePlan('Slide 1: a\nSlide 4: b\nSlide 9: c');
    expect(plan).toEqual(['a', 'b', 'c']);
  });

  it('leaves an ordinary brief alone — one mention of a slide is not a plan', () => {
    const text = 'Slide 1 should hook them. Keep it punchy.';
    expect(parseSlidePlan(text)).toEqual({ plan: [], rest: text });
  });

  it('attaches unlabelled continuation lines to the slide above', () => {
    const { plan } = parseSlidePlan('Slide 1: the hook\nkeep it short\n\nSlide 2: the payoff');
    expect(plan[0]).toBe('the hook\nkeep it short');
  });
});

describe('parseBrief', () => {
  it('lifts the plan out of the idea and collects locks and urls from both', () => {
    const b = parseBrief('From https://x.com/post\nSlide 1: say "exactly this"\nSlide 2: then the proof');
    expect(b.plan).toEqual(['say "exactly this"', 'then the proof']);
    expect(b.idea).toBe('From https://x.com/post');
    expect(b.locks).toEqual(['exactly this']);
    expect(b.urls).toEqual(['https://x.com/post']);
  });

  it('lets an explicit plan win over anything the free text looks like', () => {
    const b = parseBrief('Slide 1: ignored\nSlide 2: also ignored', ['real one', 'real two']);
    expect(b.plan).toEqual(['real one', 'real two']);
    // The free text is kept whole — nothing was lifted out of it.
    expect(b.idea).toContain('Slide 1: ignored');
  });
});

describe('containsLock', () => {
  it('ignores case, whitespace runs, and smart punctuation', () => {
    expect(containsLock('We say “Don’t wait — book it”.', "don't wait - book it")).toBe(true);
    expect(containsLock('a  b', 'a b')).toBe(true);
  });

  it('reports what is genuinely absent', () => {
    expect(missingLocks('the deck says one thing', ['one thing', 'another thing'])).toEqual(['another thing']);
  });
});

describe('slideCountFor', () => {
  it('a plan fixes the deck length exactly', () => {
    expect(slideCountFor({ planLength: 7 })).toMatchObject({ min: 7, max: 7, target: 7, fixed: true });
  });

  it('starts at a short deck and grows with the material, inside hard bounds', () => {
    const bare = slideCountFor({ ideaChars: 40 });
    const post = slideCountFor({ sourceChars: 3150 }); // one real blog post
    const huge = slideCountFor({ sourceChars: 40000 });
    expect(bare.target).toBe(4);
    expect(post.target).toBe(8);
    expect(huge.target).toBe(10); // the ceiling holds
    expect(post.min).toBe(7);
    expect(post.max).toBe(9);
  });

  it('weighs an article less heavily than the user’s own words', () => {
    // Same length, different kind: a brief is already slide-shaped, prose is not.
    const asBrief = slideCountFor({ ideaChars: 1400 });
    const asSource = slideCountFor({ sourceChars: 1400 });
    expect(asBrief.target).toBeGreaterThan(asSource.target);
  });

  it('gives a story fewer, bigger frames', () => {
    expect(slideCountFor({ sourceChars: 9000, story: true }).target).toBe(5);
  });
});
