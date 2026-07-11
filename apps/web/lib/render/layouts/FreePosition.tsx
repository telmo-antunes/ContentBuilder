'use client';

import { useRef } from 'react';
import type { CSSProperties } from 'react';
import { dimensionsFor, type Format, type SlideDecoration } from '@contentbuilder/shared';
import type { LayoutProps, RenderBrandKit } from '../types';
import { FitStack } from '../blocks';
import { AccentRule, ImageSlot, LogoMark, rgba, safeInsets, surface } from '../primitives';
import { resolveTextColor } from '../color';
import { useRenderCtx } from '../RenderContext';

/** Brand chrome painted from data (what preset layouts draw in JSX). */
function DecorationView({
  d,
  kit,
  format,
  bg,
}: {
  d: SlideDecoration;
  kit: RenderBrandKit;
  format: Format;
  bg: string;
}) {
  const dims = dimensionsFor(format);
  const box: CSSProperties = {
    position: 'absolute',
    left: `${d.frame.x * 100}%`,
    top: `${d.frame.y * 100}%`,
    width: `${d.frame.w * 100}%`,
    height: `${d.frame.h * 100}%`,
    zIndex: d.z ?? 0,
    pointerEvents: 'none',
  };
  if (d.kind === 'logo') {
    return (
      <div style={box}>
        <LogoMark kit={kit} height={d.frame.h * dims.height} bg={bg} style={{ maxWidth: '100%' }} />
      </div>
    );
  }
  if (d.kind === 'rule') {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center' }}>
        <AccentRule kit={kit} width={d.frame.w * dims.width} height={Math.max(4, d.frame.h * dims.height)} />
      </div>
    );
  }
  if (d.kind === 'divider') {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '100%', height: 2, background: rgba(resolveTextColor(bg, kit), 0.16) }} />
      </div>
    );
  }
  // scrim — dark edge fading to transparent, for text legibility over photos.
  // Stops mirror the BackgroundImage layout's scrim so a converted slide keeps
  // its exact legibility profile. Data stores 'to-top'; CSS wants 'to top'.
  const dir = (d.direction ?? 'to-top').replace('-', ' ');
  const peak = d.opacity ?? 0.55;
  return (
    <div
      style={{
        ...box,
        background: `linear-gradient(${dir}, ${rgba(bg, peak)} 0%, ${rgba(bg, peak * 0.4)} 34%, ${rgba(bg, Math.min(0.12, peak))} 66%, ${rgba(bg, 0)} 100%)`,
      }}
    />
  );
}

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

  // Aggregate per-block overflow — and report BOTH transitions. (The old
  // report-true-only version left the editor's warning stale after a fix, and
  // would have kept the frame auto-grow loop from terminating.)
  const overflowMap = useRef(new Map<number, boolean>());
  const liveIdx = new Set(ordered.map(({ i }) => i));
  for (const k of overflowMap.current.keys()) if (!liveIdx.has(k)) overflowMap.current.delete(k);
  const reportOverflow = (i: number, o: boolean) => {
    overflowMap.current.set(i, o);
    onOverflow?.([...overflowMap.current.values()].some(Boolean));
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: surface(brandKit, theme) }}>
      {fullBleed && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
          <ImageSlot image={fullBleed} kit={brandKit} fit={imageLayout?.fit} />
          {/* Subtle scrim so positioned text stays legible over the photo — unless
              a scrim decoration handles legibility (converted BackgroundImage). */}
          {!(imageLayout?.decorations ?? []).some((d) => d.kind === 'scrim') && (
            <div style={{ position: 'absolute', inset: 0, background: rgba(bg, 0.28) }} />
          )}
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
      {(imageLayout?.decorations ?? []).map((d, i) => (
        <DecorationView key={`decor-${i}`} d={d} kit={brandKit} format={format} bg={bg} />
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
            // The editor's frame auto-grow measures this box against its content.
            data-frame-idx={i}
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
              onOverflow={(o) => reportOverflow(i, o)}
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
