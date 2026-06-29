/**
 * Controlled, extensible vocabulary of content block types.
 *
 * Adding a new block type requires only:
 *   (a) extending this union (add to BLOCK_TYPES), and
 *   (b) adding its entry to the type scale (see typeScale in the web layout lib).
 * Nothing else in the system should branch on specific block types.
 */
export const BLOCK_TYPES = [
  'eyebrow',
  'title',
  'subtitle',
  'paragraph',
  'quote',
  'attribution',
  'date',
  'price',
  'list',
  'caption',
  'cta',
  'footer',
  'handle',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * Absolute placement of a block on the slide canvas, as fractions [0..1] of the
 * canvas width/height. Resolution-independent across all formats. Only meaningful
 * on `FreePosition` slides; preset layouts ignore it.
 */
export interface BlockFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single user-provided copy block. The app never invents this text. */
export interface Block {
  type: BlockType;
  /** Verbatim user copy. Empty string is allowed (an intentionally empty block). */
  text: string;
  /** Only meaningful for `list` blocks; each entry rendered as a list item. */
  items?: string[];
  /** Absolute placement (fractions of canvas). Only used by `FreePosition` slides. */
  frame?: BlockFrame;
  /** Paint order on `FreePosition` slides; higher = front. Defaults to array index. */
  z?: number;
}

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}

/** Block types that carry their content in `items[]` rather than `text`. */
export const LIST_BLOCK_TYPES: readonly BlockType[] = ['list'];

export function isListBlock(type: BlockType): boolean {
  return LIST_BLOCK_TYPES.includes(type);
}

/** Human-friendly labels for the editor UI. */
export const BLOCK_LABELS: Record<BlockType, string> = {
  eyebrow: 'Eyebrow',
  title: 'Title',
  subtitle: 'Subtitle',
  paragraph: 'Paragraph',
  quote: 'Quote',
  attribution: 'Attribution',
  date: 'Date',
  price: 'Price',
  list: 'List',
  caption: 'Caption',
  cta: 'Call to action',
  footer: 'Footer',
  handle: 'Handle',
};
