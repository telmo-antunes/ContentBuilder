/**
 * The design-first refinement vocabulary — shared so the API applies it and the
 * web renders the intent chips from one source of truth. The transform logic
 * itself lives API-side (apps/api/src/lib/refine.ts).
 */
export type RefineIntent =
  | 'bigger-headline'
  | 'fill-space'
  | 'more-breathing-room'
  | 'bolder-background'
  | 'calmer-background'
  | 'tidy';

export const REFINE_INTENTS: ReadonlyArray<{ intent: RefineIntent; label: string; hint: string }> = [
  { intent: 'bigger-headline', label: 'Bigger headline', hint: 'Enlarge the hero line' },
  { intent: 'fill-space', label: 'Fill the space', hint: 'Use more of the canvas' },
  { intent: 'more-breathing-room', label: 'More breathing room', hint: 'Add negative space' },
  { intent: 'bolder-background', label: 'Bolder background', hint: 'Step the background up' },
  { intent: 'calmer-background', label: 'Calmer background', hint: 'Quiet the background' },
  { intent: 'tidy', label: 'Tidy up', hint: 'Fix spacing and order' },
];

const REFINE_INTENT_SET = new Set<string>(REFINE_INTENTS.map((r) => r.intent));

export function isRefineIntent(value: unknown): value is RefineIntent {
  return typeof value === 'string' && REFINE_INTENT_SET.has(value);
}
