'use client';

import type { Format, ThemePreset } from '@contentbuilder/shared';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import type { LayoutImage, RenderBrandKit } from '../../lib/render/types';

/**
 * Chrome-less stage for a single slide, pinned at the viewport origin so the
 * export (Puppeteer) can screenshot the [data-slide-root] element at exact
 * pixel dimensions. A max z-index overlay covers any app chrome above it.
 */
export default function RenderStage({
  authored,
  image,
  format,
  kit,
  theme,
  slideIndex,
  slideTotal,
  showCounter,
  motion = false,
}: {
  authored?: { html: string; bg?: string };
  image?: LayoutImage | null;
  format: Format;
  kit: RenderBrandKit;
  theme: ThemePreset;
  slideIndex: number;
  slideTotal: number;
  showCounter: boolean;
  /** Play the reveal choreography (animated/video export). */
  motion?: boolean;
}) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, margin: 0, padding: 0, zIndex: 2147483647 }}>
      <SlideRenderer
        slide={{ authored }}
        brandKit={kit}
        format={format}
        image={image}
        forExport
        theme={theme}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        showCounter={showCounter}
        motion={motion}
      />
    </div>
  );
}
