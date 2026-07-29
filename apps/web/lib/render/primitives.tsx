'use client';

import type { Format } from '@contentbuilder/shared';
import { dimensionsFor } from '@contentbuilder/shared';
import { assetTypeForFormat } from './SlideFrame';

const SAFE_PADDING = 80;
const STORY_UI_RESERVE = 250;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Safe-area insets: 80px all around, plus the 250px top/bottom reserve on Story. */
export function safeInsets(format: Format): Insets {
  const isStory = assetTypeForFormat(format) === 'story';
  return {
    top: isStory ? STORY_UI_RESERVE : SAFE_PADDING,
    bottom: isStory ? STORY_UI_RESERVE : SAFE_PADDING,
    left: SAFE_PADDING,
    right: SAFE_PADDING,
  };
}

/** Convenience: scale a px value by the slide height relative to a 1350 baseline. */
export function vScale(format: Format, px: number): number {
  const { height } = dimensionsFor(format);
  return Math.round((px * height) / 1350);
}
