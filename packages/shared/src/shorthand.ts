import { isBlockType, type Block, type BlockType } from './blocks';
import { layoutWantsImage, type LayoutType } from './layouts';
import type { ImageNeed } from './types';

/**
 * Layout hint phrases → archetype. These are the ONLY layout words the parser
 * (and the in-app cheatsheet) recognize — keep both in lockstep by sourcing the
 * UI from this list.
 */
export const SHORTHAND_LAYOUT_HINTS: ReadonlyArray<{ phrase: string; layout: LayoutType }> = [
  { phrase: 'cover', layout: 'Cover' },
  { phrase: 'background image', layout: 'BackgroundImage' },
  { phrase: 'centered image', layout: 'CenteredHero' },
  { phrase: 'split image', layout: 'SplitImageText' },
  { phrase: 'text only', layout: 'TextOnly' },
  { phrase: 'quote', layout: 'Quote' },
  { phrase: 'cta', layout: 'CTA' },
];

const HINT_MAP = new Map(SHORTHAND_LAYOUT_HINTS.map((h) => [h.phrase, h.layout]));

export interface ParsedSlide {
  order: number;
  layoutType: LayoutType;
  blocks: Block[];
  imageNeed: ImageNeed;
}

export interface ShorthandResult {
  slides: ParsedSlide[];
  warnings: string[];
}

/** Accumulates a block's raw copy across comma-split fragments. */
interface RawBlock {
  type: BlockType;
  raw: string;
}

/**
 * Parse the deterministic shorthand grammar into slides. No LLM, never rewrites
 * copy: text after the first colon is preserved verbatim (commas included via
 * fragment continuation). Unknown tokens are skipped with a soft warning.
 *
 * Line: `Slide N:` / `Frame N:` (prefix optional), then comma-separated elements:
 *   - a layout hint (cover, background image, …) sets the layout
 *   - `type: text` adds a block (eyebrow, title, paragraph, cta, …)
 *   - `list: a | b | c` adds a list block
 *   - bare `image` marks the slide as needing an uploaded image
 */
export function parseShorthand(input: string): ShorthandResult {
  const warnings: string[] = [];
  const slides: ParsedSlide[] = [];
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const rawLine of lines) {
    const label = `Slide ${slides.length + 1}`;
    const line = rawLine.replace(/^\s*(?:slide|frame)\s*\d*\s*:\s*/i, '');
    const fragments = line.split(',');

    let layout: LayoutType | null = null;
    let hasImage = false;
    const els: RawBlock[] = [];
    let current: RawBlock | null = null;

    for (const frag of fragments) {
      const trimmed = frag.trim();
      if (!trimmed) {
        // Empty fragment = a comma inside copy (e.g. "a,, b"); keep it verbatim.
        if (current) current.raw += `,${frag}`;
        continue;
      }
      const lower = trimmed.toLowerCase();

      // 1) Layout hint (no colon).
      if (HINT_MAP.has(lower)) {
        if (layout) warnings.push(`${label}: multiple layout hints, using "${lower}".`);
        layout = HINT_MAP.get(lower)!;
        current = null;
        continue;
      }
      // 2) Bare image token.
      if (lower === 'image') {
        hasImage = true;
        current = null;
        continue;
      }
      // 3) Block "type: text" / "list: a | b".
      const colon = frag.indexOf(':');
      if (colon !== -1) {
        const type = frag.slice(0, colon).trim().toLowerCase();
        if (type === 'list' || isBlockType(type)) {
          // Drop a single space after the colon; preserve everything else.
          const raw = frag.slice(colon + 1).replace(/^ /, '');
          current = { type: type as BlockType, raw };
          els.push(current);
          continue;
        }
        warnings.push(`${label}: unknown block type "${type}" (ignored).`);
        current = null;
        continue;
      }
      // 4) Continuation of the current block — the comma was part of the copy.
      if (current) {
        current.raw += `,${frag}`;
      } else {
        warnings.push(`${label}: ignored "${trimmed}".`);
      }
    }

    const blocks: Block[] = els.map((e) =>
      e.type === 'list'
        ? { type: 'list', text: '', items: e.raw.split('|').map((s) => s.trim()).filter(Boolean) }
        : { type: e.type, text: e.raw },
    );

    let layoutType = layout;
    if (!layoutType) {
      if (slides.length === 0) layoutType = 'Cover';
      else if (hasImage && blocks.length > 0) layoutType = 'SplitImageText';
      else layoutType = 'TextOnly';
    }

    const imageNeed: ImageNeed = hasImage || layoutWantsImage(layoutType) ? 'upload' : 'none';
    slides.push({ order: slides.length, layoutType, blocks, imageNeed });
  }

  return { slides, warnings };
}
