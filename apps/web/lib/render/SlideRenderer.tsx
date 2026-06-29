'use client';

import type { Block, Format, LayoutType, ThemePreset } from '@contentbuilder/shared';
import type { ImageLayoutConfig, LayoutImage, RenderBrandKit } from './types';
import { LAYOUT_REGISTRY } from './layouts';
import { SlideFrame } from './SlideFrame';
import { RenderProvider } from './RenderContext';
import { safeInsets, vScale } from './primitives';
import { resolveTextColor, rgba } from './color';

export interface RenderableSlide {
  layoutType: LayoutType;
  blocks: Block[];
}

/** Mounts a single slide at exact pixel dimensions using the layout registry. */
export function SlideRenderer({
  slide,
  brandKit,
  format,
  image,
  imageLayout,
  onOverflow,
  forExport = false,
  theme = 'editorial',
  slideIndex,
  slideTotal,
  showCounter = false,
}: {
  slide: RenderableSlide;
  brandKit: RenderBrandKit;
  format: Format;
  image?: LayoutImage | null;
  imageLayout?: ImageLayoutConfig;
  onOverflow?: (overflow: boolean) => void;
  forExport?: boolean;
  theme?: ThemePreset;
  /** 0-based position for the cohesion counter. */
  slideIndex?: number;
  slideTotal?: number;
  showCounter?: boolean;
}) {
  const Layout = LAYOUT_REGISTRY[slide.layoutType] ?? LAYOUT_REGISTRY.TextOnly;
  const insets = safeInsets(format);
  const counter =
    showCounter && typeof slideIndex === 'number' && typeof slideTotal === 'number' && slideTotal > 1;

  return (
    <RenderProvider value={{ forExport, theme }}>
      <SlideFrame format={format}>
        <Layout
          brandKit={brandKit}
          blocks={slide.blocks}
          image={image}
          imageLayout={imageLayout}
          format={format}
          onOverflow={onOverflow}
        />
        {counter && (
          <div
            style={{
              position: 'absolute',
              // Top-right — Instagram's own carousel-count convention, and it
              // clears bottom-anchored text (BackgroundImage / CTA). A subtle
              // backdrop keeps it legible over full-bleed photos.
              top: insets.top,
              right: insets.right,
              padding: `${vScale(format, 6)}px ${vScale(format, 14)}px`,
              borderRadius: 999,
              background: rgba(brandKit.colors.background, 0.5),
              backdropFilter: 'blur(3px)',
              fontFamily: `'${brandKit.fonts.render.body}', sans-serif`,
              fontSize: vScale(format, 24),
              fontWeight: 600,
              letterSpacing: '0.05em',
              color: rgba(resolveTextColor(brandKit.colors.background, brandKit), 0.85),
            }}
          >
            {(slideIndex ?? 0) + 1} / {slideTotal}
          </div>
        )}
      </SlideFrame>
    </RenderProvider>
  );
}
