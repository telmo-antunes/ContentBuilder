'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { ImageSlot, rgba, safeInsets } from '../primitives';
import { IMAGE_SCRIM_OPACITY } from '../color';

/** Full-bleed image with a brand-colored gradient scrim; text blocks on top. */
export default function BackgroundImage({ brandKit, blocks, image, format, onOverflow }: LayoutProps) {
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);
  return (
    <div style={{ position: 'absolute', inset: 0, background: bg, overflow: 'hidden' }}>
      <ImageSlot image={image} kit={brandKit} />
      {/* Subtle brand duotone tint over the photo for a cohesive look. */}
      <div style={{ position: 'absolute', inset: 0, background: rgba(brandKit.colors.secondary, 0.22), mixBlendMode: 'multiply' }} />
      {/* Bottom-heavy scrim so text at the bottom reads against the brand bg color. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(to top, ${rgba(bg, 0.96)} 0%, ${rgba(bg, IMAGE_SCRIM_OPACITY)} 34%, ${rgba(bg, 0.12)} 66%, ${rgba(bg, 0)} 100%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: insets.top,
          left: insets.left,
          right: insets.right,
          bottom: insets.bottom,
        }}
      >
        <FitStack
          blocks={blocks}
          brandKit={brandKit}
          format={format}
          bg={bg}
          align="start"
          justify="end"
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );
}
