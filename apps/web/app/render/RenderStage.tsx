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
  reserveSlots = false,
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
  /** Measure empty photo slots at their real size — set only by the layout probe. */
  reserveSlots?: boolean;
  /** Clip length; the ambient drift is stretched across it. */
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
        reserveSlots={reserveSlots}
        // Publish the ground-truth overflow result on the DOM so the export /
        // any headless pass driving this route can read it off the page.
        onOverflow={(o, layout) => {
          if (typeof document !== 'undefined') document.body.dataset.overflow = o ? 'true' : 'false';
          // Published beside `overflow` so one probe pass returns every layout
          // verdict — the API reads all three from the same measurement.
          if (typeof document !== 'undefined' && layout) {
            document.body.dataset.collide = layout.collide ? 'true' : 'false';
            document.body.dataset.slack = layout.slack.toFixed(4);
            document.body.dataset.headlineLines = String(layout.headlineLines);
          }
        }}
      />
    </div>
  );
}
