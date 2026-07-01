'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { ImageSlot, rgba, safeInsets, surface } from '../primitives';
import { useRenderCtx } from '../RenderContext';

/** Fallback frame for a block that has no placement yet (e.g. added via the inspector). */
function fallbackFrame(i: number) {
  return { x: 0.1, y: 0.1 + (i % 4) * 0.04, w: 0.8, h: 0.18 };
}

/**
 * Free canvas — every block is placed absolutely from its own `frame` (fractions
 * of the canvas) and painted in `z` order. Each block lives in its own FitStack so
 * text still auto-fits its box. Identical under export (no editor-only chrome).
 */
export default function FreePosition({ brandKit, blocks, image, imageLayout, format, onOverflow }: LayoutProps) {
  const { theme, forExport } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);
  // A dedicated background image (backgroundUrl) is independent of the region
  // image, so both can show. Legacy `background` reused the slide image full-bleed
  // and therefore suppressed the region image — keep that behaviour for old slides.
  const bgUrl = imageLayout?.backgroundUrl;
  const legacyBg = !bgUrl && (imageLayout?.background ?? false);
  const fullBleed = bgUrl ? { url: bgUrl } : legacyBg ? image : null;
  const imageFrame = legacyBg ? undefined : imageLayout?.imageFrame;
  const objects = imageLayout?.objects ?? [];

  // Stable paint order: explicit z, falling back to array index.
  const ordered = blocks
    .map((b, i) => ({ b, i }))
    .sort((a, c) => (a.b.z ?? a.i) - (c.b.z ?? c.i));

  let overflowed = false;

  return (
    <div style={{ position: 'absolute', inset: 0, background: surface(brandKit, theme) }}>
      {fullBleed && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
          <ImageSlot image={fullBleed} kit={brandKit} fit={imageLayout?.fit} />
          {/* Subtle scrim so positioned text stays legible over the photo. */}
          <div style={{ position: 'absolute', inset: 0, background: rgba(bg, 0.28) }} />
        </div>
      )}
      {objects.map((o, i) => (
        <div
          key={`obj-${i}`}
          style={{
            position: 'absolute',
            left: `${o.frame.x * 100}%`,
            top: `${o.frame.y * 100}%`,
            width: `${o.frame.w * 100}%`,
            height: `${o.frame.h * 100}%`,
            borderRadius: 16,
            overflow: 'hidden',
            zIndex: 0,
          }}
        >
          <ImageSlot image={o.url ? { url: o.url, focalPoint: o.focalPoint, zoom: o.zoom } : null} kit={brandKit} fit={o.fit} />
        </div>
      ))}
      {imageFrame && (
        <div
          style={{
            position: 'absolute',
            left: `${imageFrame.x * 100}%`,
            top: `${imageFrame.y * 100}%`,
            width: `${imageFrame.w * 100}%`,
            height: `${imageFrame.h * 100}%`,
            borderRadius: 20,
            overflow: 'hidden',
            zIndex: 0,
          }}
        >
          <ImageSlot image={image} kit={brandKit} fit={imageLayout?.fit} />
        </div>
      )}
      {ordered.map(({ b, i }) => {
        const f = b.frame ?? fallbackFrame(i);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${f.x * 100}%`,
              top: `${f.y * 100}%`,
              width: `${f.w * 100}%`,
              height: `${f.h * 100}%`,
              zIndex: b.z ?? i,
              overflow: 'hidden',
            }}
          >
            <FitStack
              blocks={[b]}
              brandKit={brandKit}
              format={format}
              bg={bg}
              align="start"
              justify="start"
              onOverflow={(o) => {
                if (o && !overflowed) {
                  overflowed = true;
                  onOverflow?.(true);
                }
              }}
            />
          </div>
        );
      })}

      {/* Safe-area guide — editor aid only, never rendered in export. */}
      {!forExport && (
        <div
          style={{
            position: 'absolute',
            top: insets.top,
            left: insets.left,
            right: insets.right,
            bottom: insets.bottom,
            border: '2px dashed rgba(127,127,127,0.35)',
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        />
      )}
    </div>
  );
}
