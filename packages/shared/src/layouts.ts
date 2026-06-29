/**
 * The fixed layout library. Slides are ONLY ever rendered by one of these
 * archetypes — never freehand HTML. A layout defines the spatial arrangement
 * (where image vs text sits) and renders whatever blocks are present, in order.
 */
export const LAYOUT_TYPES = [
  'Cover',
  'BackgroundImage',
  'CenteredHero',
  'TextOnly',
  'SplitImageText',
  'Statement',
  'Checklist',
  'Quote',
  'CTA',
  'FreePosition',
] as const;

export type LayoutType = (typeof LAYOUT_TYPES)[number];

export function isLayoutType(value: unknown): value is LayoutType {
  return typeof value === 'string' && (LAYOUT_TYPES as readonly string[]).includes(value);
}

/**
 * Layouts a user can pick manually or the Designer drafter may emit. `FreePosition`
 * is produced only by Free-mode generation and edited via the drag canvas — it must
 * never appear in the layout dropdown or the Designer allowlist.
 */
export const SELECTABLE_LAYOUT_TYPES: readonly LayoutType[] = LAYOUT_TYPES.filter(
  (l) => l !== 'FreePosition',
);

/** Allowlist for the Designer draft prompt (excludes FreePosition). */
export const DESIGNER_LAYOUT_TYPES = SELECTABLE_LAYOUT_TYPES;

/** Whether a layout is freely positioned (blocks carry their own frames). */
export function isFreeLayout(layout: LayoutType): boolean {
  return layout === 'FreePosition';
}

/** Whether a layout is built around a user-supplied image. */
export const LAYOUTS_REQUIRING_IMAGE: readonly LayoutType[] = [
  'BackgroundImage',
  'CenteredHero',
  'SplitImageText',
];

export function layoutWantsImage(layout: LayoutType): boolean {
  return LAYOUTS_REQUIRING_IMAGE.includes(layout);
}

/** Short descriptions surfaced in the editor's layout dropdown. */
export const LAYOUT_DESCRIPTIONS: Record<LayoutType, string> = {
  Cover: 'Title slide — title/subtitle stack with logo, optional subtle background image.',
  BackgroundImage: 'Full-bleed image with a brand-colored scrim; text on top.',
  CenteredHero: 'Centered framed image (product/device) with text above/below.',
  TextOnly: 'Text blocks on a brand background, strong typographic hierarchy.',
  SplitImageText: 'Image on one half, text blocks on the other.',
  Statement: 'One oversized statement — punchy, full-bleed type.',
  Checklist: 'A list-forward layout with check-style rows.',
  Quote: 'Large quote block with attribution.',
  CTA: 'Call-to-action with handle/logo — designed to close a project.',
  FreePosition: 'Free canvas — blocks placed at exact positions; drag/resize in the editor.',
};
