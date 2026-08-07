import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, needsSetup, onboardingStep, resumeLabel, stepIndex, summaryStep } from './onboarding';

const biz = (projectCount = 0) => ({ projectCount });
const recipe = { version: 2 };

describe('onboardingStep', () => {
  it('starts at the name when there is no brand yet', () => {
    expect(onboardingStep({})).toBe('name');
    expect(onboardingStep({ business: null })).toBe('name');
  });

  it('reads the website once the brand exists but nothing has been extracted', () => {
    expect(onboardingStep({ business: biz() })).toBe('read');
    expect(onboardingStep({ business: biz(), kit: { draft: null, approved: null } })).toBe('read');
  });

  it('designs once a kit exists, draft or approved', () => {
    expect(onboardingStep({ business: biz(), kit: { draft: {} } })).toBe('design');
    expect(onboardingStep({ business: biz(), kit: { approved: {} } })).toBe('design');
  });

  it('keeps a designed DRAFT on the design step — approving is part of it', () => {
    // A recipe on the draft is not a recipe the composer can use; only the
    // approved kit is what posts are built against.
    expect(onboardingStep({ business: biz(), kit: { draft: { recipe } } })).toBe('design');
  });

  it('sends a brand with an approved, designed kit to its first post', () => {
    expect(onboardingStep({ business: biz(0), kit: { approved: { recipe } } })).toBe('post');
  });

  it('is done once that brand has a post', () => {
    expect(onboardingStep({ business: biz(1), kit: { approved: { recipe } } })).toBe('done');
  });

  it('does not skip design for a brand approved before recipes existed', () => {
    // These exist in the database. Sending them straight to the composer would
    // hand it an approved kit with no design system to compose against.
    expect(onboardingStep({ business: biz(4), kit: { approved: {} } })).toBe('design');
  });

  it('ignores a stale draft once the approved kit is designed', () => {
    // Re-analysing a finished brand opens a draft. That is editing, not setup,
    // and it must not drag a working brand back into onboarding.
    const s = onboardingStep({ business: biz(3), kit: { draft: {}, approved: { recipe } } });
    expect(s).toBe('done');
  });
});

describe('stepIndex', () => {
  it('maps each step to its place on the rail, in order', () => {
    expect(ONBOARDING_STEPS.map(stepIndex)).toEqual([0, 1, 2, 3]);
  });

  it('puts `done` past the end, so the rail reads fully complete', () => {
    expect(stepIndex('done')).toBe(ONBOARDING_STEPS.length);
  });
});

describe('summaryStep — the shape the Desk rail and brand page actually hold', () => {
  const sum = (o: Partial<Parameters<typeof summaryStep>[0]> = {}) => ({
    hasApprovedKit: false,
    hasRecipe: false,
    hasDraftKit: false,
    projectCount: 0,
    ...o,
  });

  it('agrees with onboardingStep on every state — one rule, two shapes', () => {
    expect(summaryStep(sum())).toBe('read');
    expect(summaryStep(sum({ hasDraftKit: true }))).toBe('design');
    expect(summaryStep(sum({ hasApprovedKit: true }))).toBe('design');
    expect(summaryStep(sum({ hasApprovedKit: true, hasRecipe: true }))).toBe('post');
    expect(summaryStep(sum({ hasApprovedKit: true, hasRecipe: true, projectCount: 2 }))).toBe('done');
  });

  it('catches the brand the inline rule got WRONG: approved before recipes, with posts', () => {
    // `!hasApprovedKit || projectCount === 0` called this finished and showed
    // no way to continue, while /start correctly routed it to the design step.
    // That disagreement is the whole reason this helper exists.
    const legacy = sum({ hasApprovedKit: true, hasRecipe: false, projectCount: 4 });
    expect(summaryStep(legacy)).toBe('design');
    expect(summaryStep(legacy)).not.toBe('done');
  });

  it('labels the last step as writing a post rather than finishing setup', () => {
    expect(resumeLabel(summaryStep(sum({ hasApprovedKit: true, hasRecipe: true })))).toBe(
      'Write the first post',
    );
    expect(resumeLabel(summaryStep(sum({ hasDraftKit: true })))).toBe('Finish setting up');
    expect(resumeLabel('done')).toBeNull();
  });
});

describe('needsSetup', () => {
  it('is false with no brand at all — there is nothing to finish', () => {
    expect(needsSetup({})).toBe(false);
  });

  it('is true for every unfinished brand', () => {
    expect(needsSetup({ business: biz() })).toBe(true);
    expect(needsSetup({ business: biz(), kit: { draft: {} } })).toBe(true);
    expect(needsSetup({ business: biz(), kit: { approved: { recipe } } })).toBe(true);
  });

  it('is false once the brand has a designed kit and a post', () => {
    expect(needsSetup({ business: biz(1), kit: { approved: { recipe } } })).toBe(false);
  });
});
