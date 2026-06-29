/**
 * Business profile — positioning & voice captured during onboarding. Distinct
 * from the brand kit (which is visual identity: colors/fonts/logo). The profile
 * is collected deterministically (no AI) and is a prerequisite for the two
 * optional AI features (brand extraction + draft-from-paragraph).
 */
export type BusinessCategory =
  | 'personal-brand'
  | 'coach-creator'
  | 'saas-product'
  | 'local-service'
  | 'ecommerce'
  | 'agency'
  | 'nonprofit'
  | 'other';

export type BusinessGoal = 'awareness' | 'leads' | 'sales' | 'community';

export interface BusinessProfile {
  category: BusinessCategory;
  /** One line: what the business does / offers. */
  offer?: string;
  /** Who the content is for. */
  audience?: string;
  /** Voice/tone descriptors (from BUSINESS_TONES). */
  tone?: string[];
  goal?: BusinessGoal;
  /** Set when the profile is first saved — its presence unlocks the AI features. */
  completedAt?: string;
}

export const BUSINESS_CATEGORIES: ReadonlyArray<{
  value: BusinessCategory;
  label: string;
  hint: string;
}> = [
  { value: 'personal-brand', label: 'Personal brand', hint: 'You, as the brand — creator, founder, author' },
  { value: 'coach-creator', label: 'Coach / creator', hint: 'Coaching, courses, consulting, community' },
  { value: 'saas-product', label: 'SaaS / product', hint: 'Software or a digital/physical product' },
  { value: 'local-service', label: 'Local service', hint: 'Detailing, salon, trades, hospitality' },
  { value: 'ecommerce', label: 'E-commerce', hint: 'Online store / product catalog' },
  { value: 'agency', label: 'Agency', hint: 'Services for other businesses' },
  { value: 'nonprofit', label: 'Nonprofit', hint: 'Mission, cause, community' },
  { value: 'other', label: 'Other', hint: 'Something else' },
];

export const BUSINESS_TONES: readonly string[] = [
  'Professional',
  'Friendly',
  'Bold',
  'Premium',
  'Playful',
  'Minimal',
  'Inspiring',
  'Technical',
  'Warm',
];

export const BUSINESS_GOALS: ReadonlyArray<{ value: BusinessGoal; label: string }> = [
  { value: 'awareness', label: 'Awareness' },
  { value: 'leads', label: 'Leads / sign-ups' },
  { value: 'sales', label: 'Sales' },
  { value: 'community', label: 'Community' },
];

export function isBusinessCategory(value: unknown): value is BusinessCategory {
  return BUSINESS_CATEGORIES.some((c) => c.value === value);
}

export function categoryLabel(value: BusinessCategory): string {
  return BUSINESS_CATEGORIES.find((c) => c.value === value)?.label ?? 'Other';
}
