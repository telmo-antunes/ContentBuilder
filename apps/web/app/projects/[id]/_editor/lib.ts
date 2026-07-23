import type { LayoutType, Slide } from '@contentbuilder/shared';
import { layoutWantsImage } from '@contentbuilder/shared';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function uid(): string {
  return crypto.randomUUID();
}

export function newSlide(layoutType: LayoutType = 'TextOnly'): Slide {
  return {
    id: uid(),
    order: 0,
    layoutType,
    blocks: [{ type: 'title', text: '' }],
    imageNeed: layoutWantsImage(layoutType) ? 'upload' : 'none',
  };
}

/** A slide whose layout needs an image but none is attached yet. */
export function slideMissingImage(s: Slide): boolean {
  return layoutWantsImage(s.layoutType) && !s.mediaAssetId;
}

/** Parse a free-text hashtag field into a clean, deduped list of #tags. */
export function parseTags(s: string): string[] {
  return Array.from(
    new Set(
      s
        .split(/[\s,]+/)
        .map((t) => t.replace(/[^A-Za-z0-9#]/g, '').replace(/^#+/, ''))
        .filter(Boolean)
        .map((t) => `#${t.slice(0, 40)}`),
    ),
  ).slice(0, 30);
}
