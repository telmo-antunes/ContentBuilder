'use client';

import type { Block, Format, LayoutType, ThemePreset } from '@contentbuilder/shared';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import type { ImageLayoutConfig, LayoutImage, RenderBrandKit } from '../../lib/render/types';

/**
 * Chrome-less stage for a single slide, pinned at the viewport origin so the
 * export (Puppeteer) can screenshot the [data-slide-root] element at exact
 * pixel dimensions. A max z-index overlay covers any app chrome above it.
 */
export default function RenderStage({
  layoutType,
  blocks,
  authored,
  format,
  kit,
  image,
  imageLayout,
  theme,
  slideIndex,
  slideTotal,
  showCounter,
}: {
  layoutType: LayoutType;
  blocks: Block[];
  authored?: { html: string; bg?: string };
  format: Format;
  kit: RenderBrandKit;
  image: LayoutImage | null;
  imageLayout?: ImageLayoutConfig;
  theme: ThemePreset;
  slideIndex: number;
  slideTotal: number;
  showCounter: boolean;
}) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, margin: 0, padding: 0, zIndex: 2147483647 }}>
      <SlideRenderer
        slide={{ layoutType, blocks, authored }}
        brandKit={kit}
        format={format}
        image={image}
        imageLayout={imageLayout}
        forExport
        theme={theme}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        showCounter={showCounter}
        // Publish the ground-truth text-fit result so the critique pass (which
        // drives this same /render route headlessly) can read it off the DOM.
        onOverflow={(o) => {
          if (typeof document !== 'undefined') document.body.dataset.overflow = o ? 'true' : 'false';
        }}
      />
    </div>
  );
}
