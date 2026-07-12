import type { Block, BlockType } from './blocks';
import type { LayoutType } from './layouts';
import type { ImageNeed } from './types';

/**
 * The zero-AI layout guide: pick WHAT you're sharing and get a pre-structured,
 * professionally-arranged slide plan — layouts chosen for the content shape,
 * blocks scaffolded empty for you to fill. No model call anywhere in here.
 */

export interface IntentSlidePlan {
  layoutType: LayoutType;
  blocks: BlockType[];
  imageNeed?: ImageNeed;
}

export interface ContentIntent {
  key: string;
  label: string;
  /** One-line "when to pick this". */
  description: string;
  slides: IntentSlidePlan[];
}

export const CONTENT_INTENTS: ContentIntent[] = [
  {
    key: 'tips',
    label: 'Tips & advice',
    description: 'Share a handful of practical points your audience can use.',
    slides: [
      { layoutType: 'Cover', blocks: ['eyebrow', 'title'] },
      { layoutType: 'Checklist', blocks: ['title', 'list'] },
      { layoutType: 'CTA', blocks: ['title', 'cta', 'handle'] },
    ],
  },
  {
    key: 'testimonial',
    label: 'Testimonial / quote',
    description: 'Let a customer say it for you.',
    slides: [
      { layoutType: 'Quote', blocks: ['quote', 'attribution'] },
      { layoutType: 'CTA', blocks: ['title', 'cta', 'handle'] },
    ],
  },
  {
    key: 'promo',
    label: 'Offer / promotion',
    description: 'A deal, discount or limited-time push.',
    slides: [
      { layoutType: 'BackgroundImage', blocks: ['eyebrow', 'title'], imageNeed: 'upload' },
      { layoutType: 'Statement', blocks: ['title'] },
      { layoutType: 'CTA', blocks: ['title', 'price', 'cta', 'handle'] },
    ],
  },
  {
    key: 'announcement',
    label: 'Announcement / news',
    description: 'Something new: launch, milestone, change of hours…',
    slides: [
      { layoutType: 'Statement', blocks: ['eyebrow', 'title'] },
      { layoutType: 'TextOnly', blocks: ['title', 'paragraph'] },
      { layoutType: 'CTA', blocks: ['title', 'cta', 'handle'] },
    ],
  },
  {
    key: 'showcase',
    label: 'Product / work showcase',
    description: 'Show what you make or a job well done — photo-forward.',
    slides: [
      { layoutType: 'BackgroundImage', blocks: ['eyebrow', 'title'], imageNeed: 'upload' },
      { layoutType: 'CenteredHero', blocks: ['title', 'caption'], imageNeed: 'upload' },
      { layoutType: 'SplitImageText', blocks: ['title', 'paragraph'], imageNeed: 'upload' },
      { layoutType: 'CTA', blocks: ['title', 'cta', 'handle'] },
    ],
  },
  {
    key: 'story',
    label: 'Story / behind the scenes',
    description: 'A narrative moment — how it started, how it’s going.',
    slides: [
      { layoutType: 'BackgroundImage', blocks: ['title'], imageNeed: 'upload' },
      { layoutType: 'TextOnly', blocks: ['title', 'paragraph'] },
      { layoutType: 'Quote', blocks: ['quote', 'attribution'] },
      { layoutType: 'CTA', blocks: ['handle'] },
    ],
  },
];

export interface LayoutSuggestion {
  layoutType: LayoutType;
  /** Human-readable "why", shown next to the suggestion. */
  reason: string;
}

/**
 * Rule-based layout suggestion for ONE slide's current content (no AI).
 * Returns null when the current layout already fits (or there's nothing to
 * judge), so callers can render nothing instead of noise.
 */
export function suggestLayoutForBlocks(
  blocks: Block[],
  current: LayoutType,
  hasImage: boolean,
): LayoutSuggestion | null {
  if (current === 'FreePosition') return null; // free canvas is deliberate
  const present = blocks.filter(
    (b) => (b.items?.some((i: string) => i.trim()) ?? false) || b.text.trim() !== '',
  );
  if (present.length === 0) return null;
  const types = new Set(present.map((b) => b.type));
  const title = present.find((b) => b.type === 'title');

  let s: LayoutSuggestion | null = null;
  if (types.has('list')) {
    s = { layoutType: 'Checklist', reason: 'this slide has a list' };
  } else if (types.has('quote')) {
    s = { layoutType: 'Quote', reason: 'this slide has a quote' };
  } else if (types.has('cta') || types.has('price')) {
    s = { layoutType: 'CTA', reason: 'this slide closes with a call-to-action' };
  } else if (hasImage && types.has('paragraph')) {
    s = { layoutType: 'SplitImageText', reason: 'image beside the copy keeps both readable' };
  } else if (hasImage && present.length <= 2 && (title?.text.length ?? 99) <= 60) {
    s = { layoutType: 'BackgroundImage', reason: 'short copy over a photo makes a strong visual' };
  } else if (hasImage) {
    s = { layoutType: 'CenteredHero', reason: 'a framed photo gives the image real presence' };
  } else if (present.length === 1 && title && title.text.length <= 60) {
    s = { layoutType: 'Statement', reason: 'a single short line lands hardest oversized' };
  }
  return s && s.layoutType !== current ? s : null;
}
