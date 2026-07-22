import type { Block, BlockType } from './blocks';
import type { BrandLayout, Slide, SlideDecoration } from './types';

/**
 * Apply a brand layout to a slide: keep the slide's COPY, adopt the layout's
 * structure (frames + decorations + background). The layout has typed, empty
 * frames; the slide has copy. We match copy to frames by block type so nothing
 * lands in the wrong slot, then carry over any leftover copy so no words are
 * lost. Pure + deterministic → unit-testable and undoable via the normal
 * slide mutator.
 */
export function applyBrandLayout(slide: Slide, layout: BrandLayout, backgroundAssetId?: string): Slide {
  // Copy blocks that actually carry content, grouped by type (FIFO per type).
  const byType = new Map<BlockType, Block[]>();
  const leftover: Block[] = [];
  for (const b of slide.blocks) {
    const has = b.type === 'list' ? (b.items?.some((i) => i.trim() !== '') ?? false) : b.text.trim() !== '';
    if (!has) continue;
    const bucket = byType.get(b.type);
    if (bucket) bucket.push(b);
    else byType.set(b.type, [b]);
  }

  const used = new Set<Block>();
  const blocks: Block[] = layout.blocks.map((lb, i) => {
    const bucket = byType.get(lb.type as BlockType);
    const match = bucket?.find((b) => !used.has(b));
    if (match) used.add(match);
    return {
      type: lb.type as BlockType,
      text: match?.text ?? '',
      items: match?.items,
      frame: lb.frame,
      z: lb.z ?? 10 + i,
    };
  });

  // Any copy the layout had no slot for is preserved below the composition so
  // it's never silently dropped — the user can reposition or delete it.
  let extraY = 0.72;
  for (const b of slide.blocks) {
    const has = b.type === 'list' ? (b.items?.some((i) => i.trim() !== '') ?? false) : b.text.trim() !== '';
    if (!has || used.has(b)) continue;
    leftover.push(b);
  }
  for (const b of leftover) {
    blocks.push({
      type: b.type,
      text: b.text,
      items: b.items,
      frame: { x: 0.1, y: Math.min(extraY, 0.9), w: 0.8, h: 0.08 },
      z: 40,
    });
    extraY += 0.09;
  }

  const decorations: SlideDecoration[] | undefined = layout.decorations?.length ? layout.decorations : undefined;

  return {
    ...slide,
    layoutType: 'FreePosition',
    imageNeed: layout.imageNeed ?? (layout.imageFrame || layout.imageBackground ? 'upload' : slide.imageNeed),
    blocks,
    overrides: {
      ...slide.overrides,
      // A layout's own frame/decorations/background replace whatever free-canvas
      // overrides the slide carried; the slide image (mediaAssetId) is kept.
      imageFrame: layout.imageFrame,
      imageBackground: layout.imageBackground,
      decorations,
      backgroundMediaAssetId: backgroundAssetId ?? layout.backgroundMediaAssetId,
    },
  };
}
