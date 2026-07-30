'use client';

import type { Format, ThemePreset } from '@contentbuilder/shared';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import type { RenderBrandKit } from '../../lib/render/types';
import type { SlidePhotoSet } from '../../lib/render/projectRender';

/**
 * Chrome-less stage for a single slide, pinned at the viewport origin so the
 * export (Puppeteer) can screenshot the [data-slide-root] element at exact
 * pixel dimensions. A max z-index overlay covers any app chrome above it.
 */
export default function RenderStage({
  authored,
  photos,
  format,
  kit,
  theme,
  slideIndex,
  slideTotal,
  showCounter,
  motion = false,
}: {
  authored?: { html: string; bg?: string; role?: string };
  /** The user's own photos: slot fills, a background, and free overlays. */
  photos?: SlidePhotoSet;
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
        photos={photos}
        forExport
        theme={theme}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        showCounter={showCounter}
        motion={motion}
        // Publish the ground-truth overflow result on the DOM so the export /
        // any headless pass driving this route can read it off the page.
        onOverflow={(o) => {
          if (typeof document !== 'undefined') document.body.dataset.overflow = o ? 'true' : 'false';
        }}
      />
    </div>
  );
}
