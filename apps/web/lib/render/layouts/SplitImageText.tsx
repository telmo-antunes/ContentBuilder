'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { AccentRule, ImageSlot, safeInsets, surface, vScale, SAFE_PADDING } from '../primitives';
import { assetTypeForFormat } from '../SlideFrame';
import { useRenderCtx } from '../RenderContext';

/**
 * Image and text split across the slide. The `split` override controls both the
 * orientation (left/right = side-by-side; top/bottom = stacked) and the order:
 *   image-left  → image | text     image-top    → image / text
 *   image-right → text | image     image-bottom → text / image
 * Defaults: carousel = image-left, story = image-top.
 */
export default function SplitImageText({
  brandKit,
  blocks,
  image,
  imageLayout,
  format,
  onOverflow,
}: LayoutProps) {
  const { theme } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);

  const split = imageLayout?.split ?? (assetTypeForFormat(format) === 'story' ? 'image-top' : 'image-left');
  const vertical = split === 'image-top' || split === 'image-bottom';
  const imageFirst = split === 'image-left' || split === 'image-top';

  const imageHalf = (
    <div style={{ position: 'relative', flex: '1 1 50%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <ImageSlot image={image} kit={brandKit} fit={imageLayout?.fit} />
    </div>
  );

  // Gradient seam between the two halves.
  const divider = (
    <div
      style={{
        flex: '0 0 auto',
        ...(vertical ? { height: 6, width: '100%' } : { width: 6, height: '100%' }),
        background: `linear-gradient(${vertical ? '90deg' : '180deg'}, ${brandKit.colors.primary}, ${brandKit.colors.accent})`,
      }}
    />
  );

  const textHalf = (
    <div
      style={{
        flex: '1 1 50%',
        minWidth: 0,
        minHeight: 0,
        background: surface(brandKit, theme),
        display: 'flex',
        flexDirection: 'column',
        gap: vScale(format, 22),
        padding: vertical
          ? `${vScale(format, 50)}px ${insets.left}px ${insets.bottom}px`
          : `${insets.top}px ${SAFE_PADDING}px ${insets.bottom}px ${SAFE_PADDING}px`,
      }}
    >
      <AccentRule kit={brandKit} width={vScale(format, 64)} style={{ flex: '0 0 auto' }} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <FitStack
          blocks={blocks}
          brandKit={brandKit}
          format={format}
          bg={bg}
          align="start"
          justify="center"
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: bg,
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
      }}
    >
      {imageFirst ? imageHalf : textHalf}
      {divider}
      {imageFirst ? textHalf : imageHalf}
    </div>
  );
}
