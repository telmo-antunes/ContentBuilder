import { describe, expect, it } from 'vitest';
import { matchScore, matchWords } from './mediaTags';

describe('matchWords', () => {
  it('normalises, strips the generic words, and folds plurals', () => {
    expect(matchWords('Ceramic coating applied to car bonnets')).toEqual(['ceramic', 'coating', 'applied', 'bonnet']);
  });
  it('reads a tag list the same way', () => {
    expect(matchWords(['Foam', 'car seats', 'a photo'])).toEqual(['foam', 'seat']);
  });
});

describe('matchScore', () => {
  const dashboard = { subjects: ['dashboard', 'booking table', 'calendar'], caption: 'A CRM booking screen with a list of jobs.' };
  const bonnet = { subjects: ['car bonnet', 'ceramic coating', 'applicator pad'], caption: 'A detailer applies coating to a dark bonnet.' };

  it('counts the words the picture answers', () => {
    expect(matchScore(bonnet, 'ceramic coating applied to car bonnet')).toBe(3);
    expect(matchScore(dashboard, 'ceramic coating applied to car bonnet')).toBe(0);
  });
  it('does not match on the noun every picture in a car library shares', () => {
    expect(matchScore(dashboard, 'car')).toBe(0);
  });
  it('is zero without tags or without a query', () => {
    expect(matchScore(undefined, 'anything')).toBe(0);
    expect(matchScore(bonnet, undefined)).toBe(0);
  });
});
