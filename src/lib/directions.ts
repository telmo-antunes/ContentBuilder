import type { GenerationInput, SlideDirection, Workspace } from './schema';

export function activeDirections(workspace: Pick<Workspace, 'slideDirectionsEnabled' | 'slideDirections'>): SlideDirection[] {
  return workspace.slideDirectionsEnabled
    ? (workspace.slideDirections ?? []).filter(item => item.text.trim()).map(({ slide, text }) => ({ slide, text })).sort((a, b) => a.slide - b.slide)
    : [];
}
export function generationContext(input: GenerationInput): { brief: string; directions: SlideDirection[] } {
  if (input.instruction && !input.useUpdatedBrief) {
    return { brief: input.deck?.originBrief ?? input.brief,
      // A legacy deck never used the newly edited per-slide fields.
      directions: input.deck?.originSlideDirections ?? [] };
  }
  return { brief: input.brief, directions: activeDirections(input) };
}
export function duplicateDirection(directions: SlideDirection[]): number | undefined {
  const seen = new Set<number>();
  for (const { slide } of directions) { if (seen.has(slide)) return slide; seen.add(slide); }
}
export function directionSummary(brief: string, directions: SlideDirection[]): string {
  return [brief, ...directions.map(item => `Slide ${item.slide}:\n${item.text}`)].filter(Boolean).join('\n\n');
}
