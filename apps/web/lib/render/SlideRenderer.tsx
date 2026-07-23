'use client';

import { useEffect } from 'react';
import type { Block, Format, LayoutType, ThemePreset } from '@contentbuilder/shared';
import type { ImageLayoutConfig, LayoutImage, RenderBrandKit } from './types';
import { ensureGoogleFonts } from './fontLoader';
import { LAYOUT_REGISTRY } from './layouts';
import { SlideFrame } from './SlideFrame';
import { AuthoredSlide } from './AuthoredSlide';
import { RenderProvider } from './RenderContext';
import { safeInsets, vScale } from './primitives';
import { resolveTextColor, rgba } from './color';

export interface RenderableSlide {
  layoutType: LayoutType;
  blocks: Block[];
  /** AI-authored markup; when present (with a kit recipe) it replaces the block layout. */
  authored?: { html: string; bg?: string };
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
  // Kits whose render fonts aren't bundled (real site fonts) load from Google
  // Fonts on demand — every render site (editor, thumbs, export) goes through
  // this component, so this one hook covers them all.
  const { heading, body } = brandKit.fonts.render;
  useEffect(() => {
    ensureGoogleFonts([heading, body]);
  }, [heading, body]);

  const Layout = LAYOUT_REGISTRY[slide.layoutType] ?? LAYOUT_REGISTRY.TextOnly;
  const insets = safeInsets(format);
  const counter =
    showCounter && typeof slideIndex === 'number' && typeof slideTotal === 'number' && slideTotal > 1;

  const counterEl = counter ? (
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
  ) : null;

  // AI-authored slide: mount the recipe + authored markup instead of the block
  // layout. Requires the kit to carry a recipe (the design system it composes on).
  if (slide.authored?.html && brandKit.recipe) {
    return (
      <RenderProvider value={{ forExport, theme }}>
        <SlideFrame format={format}>
          <AuthoredSlide recipe={brandKit.recipe} authored={slide.authored} logoUrl={brandKit.logo?.url} />
          {counterEl}
        </SlideFrame>
      </RenderProvider>
    );
  }

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
        {counterEl}
      </SlideFrame>
    </RenderProvider>
  );
}
