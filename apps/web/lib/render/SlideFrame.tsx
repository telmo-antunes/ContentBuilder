import type { CSSProperties, ReactNode } from 'react';
import type { AssetType, Format } from '@contentbuilder/shared';
import { dimensionsFor } from '@contentbuilder/shared';

export function assetTypeForFormat(format: Format): AssetType {
  return format === '1080x1920' ? 'story' : 'carousel';
}

/** A slide rendered at EXACT pixel dimensions (used by the /render export route). */
export function SlideFrame({
  format,
  children,
  style,
}: {
  format: Format;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { width, height } = dimensionsFor(format);
  return (
    <div
      data-slide-root
      style={{ position: 'relative', width, height, overflow: 'hidden', ...style }}
    >
      {children}
    </div>
  );
}

/** Scales a full-size slide down to `displayWidth` for previews/thumbnails. */
export function ScaledSlide({
  format,
  displayWidth,
  children,
  overlay,
}: {
  format: Format;
  displayWidth: number;
  children: ReactNode;
  /** Optional layer rendered above the slide in full-canvas pixel space (e.g. drag handles). */
  overlay?: ReactNode;
}) {
  const { width, height } = dimensionsFor(format);
  const scale = displayWidth / width;
  return (
    <div
      style={{
        width: displayWidth,
        height: Math.round(height * scale),
        flex: '0 0 auto', // never let a flex parent shrink this and clip the slide
        overflow: 'hidden',
        borderRadius: 10,
        boxShadow: '0 2px 14px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          position: 'relative',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width,
          height,
        }}
      >
        {children}
        {overlay}
      </div>
    </div>
  );
}
