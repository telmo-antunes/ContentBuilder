'use client';

import { useEffect } from 'react';
import type { Format, ThemePreset } from '@contentbuilder/shared';
import type { ImageLayoutConfig, LayoutImage, RenderBrandKit } from './types';
import { ensureGoogleFonts } from './fontLoader';
import { SlideFrame } from './SlideFrame';
import { AuthoredSlide } from './AuthoredSlide';
import { RenderProvider } from './RenderContext';
import { safeInsets, vScale } from './primitives';
import { resolveTextColor, rgba } from './color';

export interface RenderableSlide {
  /** AI-authored markup — the only kind of slide the app renders. */
  authored?: { html: string; bg?: string };
}

/** Mounts one AI-composed slide at exact pixel dimensions, styled by the brand recipe. */
export function SlideRenderer({
  slide,
  brandKit,
  format,
  forExport = false,
  theme = 'editorial',
  slideIndex,
  slideTotal,
  showCounter = false,
}: {
  slide: RenderableSlide;
  brandKit: RenderBrandKit;
  format: Format;
  /** Accepted for call-site compatibility; authored slides carry their own art. */
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
  // Fonts on demand — every render site (thumbs, review, export) goes through
  // this component, so this one hook covers them all.
  const { heading, body } = brandKit.fonts.render;
  useEffect(() => {
    ensureGoogleFonts([heading, body]);
  }, [heading, body]);

  const insets = safeInsets(format);
  const counter =
    showCounter && typeof slideIndex === 'number' && typeof slideTotal === 'number' && slideTotal > 1;

  const counterEl = counter ? (
    <div
      style={{
        position: 'absolute',
        // Top-right — Instagram's own carousel-count convention. A subtle
        // backdrop keeps it legible over any authored background.
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

  return (
    <RenderProvider value={{ forExport, theme }}>
      <SlideFrame format={format}>
        {slide.authored?.html && brandKit.recipe ? (
          <AuthoredSlide
            recipe={brandKit.recipe}
            authored={slide.authored}
            format={format}
            logoUrl={brandKit.logo?.url}
          />
        ) : (
          // No recipe/markup yet — a neutral branded field rather than a crash.
          <div style={{ position: 'absolute', inset: 0, background: brandKit.colors.background }} />
        )}
        {counterEl}
      </SlideFrame>
    </RenderProvider>
  );
}
