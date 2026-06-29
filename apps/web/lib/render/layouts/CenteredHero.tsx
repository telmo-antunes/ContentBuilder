'use client';

import { dimensionsFor } from '@contentbuilder/shared';
import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { ImageSlot, paddingCss, rgba, safeInsets, surface, vScale } from '../primitives';
import { useRenderCtx } from '../RenderContext';

/** Width / height ratio for each aspect option. */
const ASPECT_RATIO = { square: 1, landscape: 4 / 3, wide: 16 / 9, portrait: 3 / 4 } as const;
/** Fraction of the available width the framed image occupies, per size. */
const SIZE_FRACTION = { sm: 0.62, md: 0.82, lg: 1 } as const;

/** Centered framed image (product/device/app screenshot) with text blocks below it.
 *  The image's aspect ratio, size, and fit are configurable per slide. */
export default function CenteredHero({ brandKit, blocks, image, imageLayout, format, onOverflow }: LayoutProps) {
  const { theme } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);
  const { width, height } = dimensionsFor(format);

  const aspect = imageLayout?.aspect ?? 'square';
  const size = imageLayout?.size ?? 'md';
  const ratio = ASPECT_RATIO[aspect];

  const availW = width - insets.left - insets.right;
  const availH = height - insets.top - insets.bottom;
  let boxW = availW * SIZE_FRACTION[size];
  let boxH = boxW / ratio;
  // Don't let the frame eat the whole slide — leave room for the text below.
  const maxH = availH * (aspect === 'portrait' ? 0.72 : 0.6);
  if (boxH > maxH) {
    boxH = maxH;
    boxW = boxH * ratio;
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: surface(brandKit, theme),
        padding: paddingCss(insets),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: vScale(format, 48),
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          width: boxW,
          height: boxH,
          borderRadius: 28,
          overflow: 'hidden',
          position: 'relative',
          background: rgba(brandKit.colors.secondary, 0.4),
          boxShadow: `0 30px 70px rgba(0,0,0,0.4), 0 0 0 1px ${rgba(brandKit.colors.text, 0.1)}, 0 0 0 10px ${rgba(brandKit.colors.primary, 0.14)}`,
        }}
      >
        <ImageSlot image={image} kit={brandKit} fit={imageLayout?.fit} />
      </div>
      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        <FitStack
          blocks={blocks}
          brandKit={brandKit}
          format={format}
          bg={bg}
          align="center"
          justify="center"
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );
}
