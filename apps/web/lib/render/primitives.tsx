'use client';

import type { CSSProperties } from 'react';
import type { Format, ThemePreset } from '@contentbuilder/shared';
import { dimensionsFor } from '@contentbuilder/shared';
import type { LayoutImage, RenderBrandKit } from './types';
import { mix, rgba, luminance } from './color';
import { assetTypeForFormat } from './SlideFrame';
import { useRenderCtx } from './RenderContext';
import { themeTokens } from './theme';

export { rgba };

export const SAFE_PADDING = 80;
export const STORY_UI_RESERVE = 250;

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

export function paddingCss(insets: Insets): string {
  return `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`;
}

/** Hook: the active theme's decor tokens. */
export function useTheme() {
  return themeTokens(useRenderCtx().theme);
}

/**
 * Brand-driven background, varied by the active theme preset. Glows/gradients
 * stay subtle enough that text contrast is still measured against the base
 * background color, which dominates.
 */
export function surface(kit: RenderBrandKit, theme: ThemePreset = 'editorial'): string {
  return themeTokens(theme).surface(kit);
}

/**
 * Short accent bar in layout headers — shape follows the theme (thin line /
 * thick block / rounded pill), or hidden entirely for the minimal theme.
 */
export function AccentRule({
  kit,
  width = 64,
  height = 5,
  style,
}: {
  kit: RenderBrandKit;
  width?: number;
  height?: number;
  style?: CSSProperties;
}) {
  const { rule } = useTheme();
  if (rule === 'none') return null;
  const h = rule === 'block' ? Math.max(height, 12) : height;
  const w = rule === 'block' ? Math.min(width, 52) : width;
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: rule === 'line' ? h : rule === 'pill' ? 999 : 3,
        background: `linear-gradient(90deg, ${kit.colors.primary}, ${kit.colors.accent})`,
        flex: '0 0 auto',
        ...style,
      }}
    />
  );
}

function focalCss(fp?: { x: number; y: number }): string {
  if (!fp) return 'center';
  return `${(fp.x * 100).toFixed(1)}% ${(fp.y * 100).toFixed(1)}%`;
}

/** Image filling its slot honoring the focal point; placeholder when absent.
 *  `fit='contain'` shows the whole image (e.g. a full app screenshot) instead of cropping. */
export function ImageSlot({
  image,
  kit,
  style,
  fit = 'cover',
}: {
  image?: LayoutImage | null;
  kit: RenderBrandKit;
  style?: CSSProperties;
  fit?: 'cover' | 'contain';
}) {
  if (image?.url) {
    const treatment = image.treatment ?? 'none';
    const img = (
      <img
        src={image.url}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: fit,
          objectPosition: focalCss(image.focalPoint),
          // Duotone: desaturate the photo, then re-color via the overlay below.
          filter: treatment === 'duotone' ? 'grayscale(1) contrast(1.05)' : undefined,
          ...style,
        }}
      />
    );
    if (treatment === 'none') return img;
    // Brand-colored overlay for cohesion (tint = light wash, duotone = two-tone map).
    const overlay: CSSProperties =
      treatment === 'duotone'
        ? {
            background: `linear-gradient(150deg, ${kit.colors.secondary}, ${kit.colors.primary})`,
            mixBlendMode: 'screen',
            opacity: 0.5,
          }
        : { background: rgba(kit.colors.primary, 0.28), mixBlendMode: 'multiply' };
    return (
      <>
        {img}
        <div style={{ position: 'absolute', inset: 0, ...overlay }} />
      </>
    );
  }
  return <ImagePlaceholder kit={kit} style={style} />;
}

/**
 * Shown when an image layout has no image yet. In the EDITOR it shows a helpful
 * "Add image" hint; for EXPORT it falls back to a clean brand gradient with NO
 * text, so a missing image never bakes a placeholder word into the deliverable.
 */
function ImagePlaceholder({ kit, style }: { kit: RenderBrandKit; style?: CSSProperties }) {
  const { forExport } = useRenderCtx();
  const a = kit.colors.secondary;
  const b = mix(kit.colors.background, kit.colors.secondary, 0.5);
  const base: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: `linear-gradient(135deg, ${a}, ${b})`,
    ...style,
  };
  if (forExport) return <div style={base} />;
  return (
    <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          color: rgba('#ffffff', 0.6),
          fontFamily: `'${kit.fonts.render.body}', sans-serif`,
        }}
      >
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" stroke="none" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '0.04em' }}>Add image</span>
      </div>
    </div>
  );
}

export function LogoMark({
  kit,
  height,
  bg,
  style,
}: {
  kit: RenderBrandKit;
  height: number;
  /** Slide background, used to pick a light/dark knockout for mono logos. */
  bg?: string;
  style?: CSSProperties;
}) {
  if (!kit.logo?.url) return null;
  // 'mono' knocks the logo out to a single color that contrasts the background
  // (white on dark, near-black on light) so it reads on any slide.
  let filter: string | undefined;
  if (kit.logoTreatment === 'mono') {
    const onDark = luminance(bg ?? kit.colors.background) < 0.4;
    filter = onDark ? 'brightness(0) invert(1)' : 'brightness(0)';
  }
  return (
    <img
      src={kit.logo.url}
      alt=""
      style={{ height, width: 'auto', maxWidth: '55%', objectFit: 'contain', display: 'block', filter, ...style }}
    />
  );
}

/** Convenience: scale a px value by the slide height relative to a 1350 baseline. */
export function vScale(format: Format, px: number): number {
  const { height } = dimensionsFor(format);
  return Math.round((px * height) / 1350);
}
