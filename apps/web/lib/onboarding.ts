/**
 * SETTING UP A BRAND, AS ONE CONTINUOUS THING.
 *
 * Adding a brand used to end the moment it was created: the form closed, a new
 * card appeared on the Desk, and the person was left to work out on their own
 * that they now had to open the brand, analyse its website, design a recipe,
 * approve it, create a project, and only then write something. Six discoveries
 * across four screens, none of them announced. Everything after "name it" was
 * technically reachable and practically invisible.
 *
 * The guided flow is the fix. This module is its spine: WHERE A BRAND IS, as a
 * pure function of what the API already returns.
 *
 * That matters more than it looks. The obvious implementation of a wizard is a
 * step counter held in component state, which means closing the tab loses your
 * place, refreshing restarts you, and arriving from a link puts you at the
 * beginning of something you half-finished — the same discontinuity, moved.
 * Deriving the step instead means there is no place to lose: a brand with a
 * draft kit and no recipe IS at the design step, whoever asks and whenever.
 * Nothing new is stored, and nothing can go stale.
 */

export const ONBOARDING_STEPS = ['name', 'read', 'design', 'post'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number] | 'done';

/** Just the fields the derivation reads — so callers can pass anything shaped like this. */
export interface OnboardingInput {
  business?: { projectCount: number } | null;
  /** The brand-kit state: a pending draft and/or the live approved kit. */
  kit?: {
    draft?: { recipe?: unknown } | null;
    approved?: { recipe?: unknown } | null;
  } | null;
}

/**
 * Which step a brand is on.
 *
 * Read top to bottom, it is the setup story in five lines: you have not named
 * it; nothing has read the website; there is no design; there is no post; done.
 */
export function onboardingStep(input: OnboardingInput): OnboardingStep {
  if (!input.business) return 'name';
  const kit = input.kit?.approved ?? input.kit?.draft ?? null;
  if (!kit) return 'read';
  // An approved kit without a recipe is still undesigned — brands from before
  // recipes existed sit here, and they need the design step, not a shortcut
  // past it into a composer that has no design system to compose against.
  if (!input.kit?.approved?.recipe) return 'design';
  return input.business.projectCount > 0 ? 'done' : 'post';
}

/** Zero-based position for the progress rail; 'done' is past the end. */
export function stepIndex(step: OnboardingStep): number {
  const i = (ONBOARDING_STEPS as readonly string[]).indexOf(step);
  return i === -1 ? ONBOARDING_STEPS.length : i;
}

/** Is this brand mid-setup — i.e. worth offering "finish setting up"? */
export function needsSetup(input: OnboardingInput): boolean {
  return Boolean(input.business) && onboardingStep(input) !== 'done';
}

/**
 * The same question, asked of a brand SUMMARY — the shape the Desk rail and the
 * brand page actually hold, which carries booleans rather than the kit itself.
 *
 * This exists so those two surfaces stop open-coding the rule. They previously
 * each wrote `!hasApprovedKit || projectCount === 0` inline, which is the exact
 * drift the module header warns about — and they were already wrong: a brand
 * approved before recipes existed, with posts, reads as finished to them while
 * `onboardingStep` correctly routes it to the design step. `hasRecipe` closes
 * that gap, and routing both through here keeps it closed.
 */
export function summaryStep(biz: {
  hasApprovedKit: boolean;
  hasRecipe: boolean;
  hasDraftKit: boolean;
  projectCount: number;
}): OnboardingStep {
  return onboardingStep({
    business: { projectCount: biz.projectCount },
    kit:
      biz.hasApprovedKit || biz.hasDraftKit
        ? {
            approved: biz.hasApprovedKit ? { recipe: biz.hasRecipe || undefined } : null,
            draft: biz.hasDraftKit ? {} : null,
          }
        : null,
  });
}

/** What "finish setting up" should say for a brand at this step. */
export function resumeLabel(step: OnboardingStep): string | null {
  if (step === 'done') return null;
  return step === 'post' ? 'Write the first post' : 'Finish setting up';
}

export interface StepCopy {
  /** The rail label. One word where possible — this is a map, not prose. */
  short: string;
  /** What this step is, in the second person. */
  title: string;
  /** Why it exists, said once. Empty when the title says it all. */
  blurb: string;
}

/**
 * The words. Kept beside the derivation so a new step cannot be added without
 * someone deciding what it is called and why a person should care.
 */
export const STEP_COPY: Record<(typeof ONBOARDING_STEPS)[number], StepCopy> = {
  name: {
    short: 'Name',
    title: 'What are we building for?',
    blurb:
      'A name, what kind of business it is, and — if it has one — its website. The site is where the colours, the type and the tone of voice come from.',
  },
  read: {
    short: 'Read',
    title: 'Reading the brand',
    blurb:
      'Pulling the palette, the typefaces, the logo and the way this brand talks, straight off its own site.',
  },
  design: {
    short: 'Design',
    title: 'Two directions',
    blurb:
      'A complete design system — type, layout, imagery, motion — that every future post is composed against. Pick the one that feels right; you can tune it in detail afterwards.',
  },
  post: {
    short: 'First post',
    title: 'Make something',
    blurb: 'Say what it should be about. The system you just approved does the rest.',
  },
};
