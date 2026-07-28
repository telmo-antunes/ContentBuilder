'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockFrame, SlidePhoto } from '@contentbuilder/shared';

/** Nothing smaller than this fraction of the canvas — a 0-size image is unclickable. */
const MIN = 0.05;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Drag-and-resize handles for a slide's FLOATING images.
 *
 * Rendered through `ScaledSlide`'s overlay, so it lives inside the same
 * `transform: scale()` as the slide and can be positioned in canvas pixels —
 * which means a handle sits exactly on the picture at any preview size. The
 * pointer, however, moves in SCREEN pixels: every delta is divided by `scale`
 * before it becomes a frame fraction, or dragging would run away from the
 * cursor at anything other than 1:1.
 *
 * Frames are fractions of the canvas [0..1], so a placement made against a
 * 288px preview holds exactly on the 1080px export.
 */
export default function FreeImageOverlay({
  photos,
  canvasW,
  canvasH,
  scale,
  selectedId,
  onSelect,
  onCommit,
}: {
  photos: SlidePhoto[];
  canvasW: number;
  canvasH: number;
  /** displayWidth / canvasW — the factor the parent is scaling everything by. */
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Fires once per gesture, on release — not on every pointer move. */
  onCommit: (id: string, frame: BlockFrame) => void;
}) {
  // The frame being dragged lives here during a gesture so the handles track
  // the pointer at 60fps without a save round-trip on every move.
  const [draft, setDraft] = useState<{ id: string; frame: BlockFrame } | null>(null);
  const gesture = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    from: BlockFrame;
  } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      // Screen px → canvas px → fraction of the canvas.
      const dx = (e.clientX - g.startX) / scale / canvasW;
      const dy = (e.clientY - g.startY) / scale / canvasH;
      const f = g.from;
      const frame =
        g.mode === 'move'
          ? {
              // Keep the whole picture on the canvas while moving.
              x: clamp01(Math.min(f.x + dx, 1 - f.w)),
              y: clamp01(Math.min(f.y + dy, 1 - f.h)),
              w: f.w,
              h: f.h,
            }
          : {
              x: f.x,
              y: f.y,
              w: Math.max(MIN, Math.min(f.w + dx, 1 - f.x)),
              h: Math.max(MIN, Math.min(f.h + dy, 1 - f.y)),
            };
      setDraft({ id: g.id, frame });
    },
    [scale, canvasW, canvasH],
  );

  const onPointerUp = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    setDraft((d) => {
      if (g && d && d.id === g.id) onCommit(g.id, d.frame);
      return null;
    });
  }, [onCommit]);

  useEffect(() => {
    if (!draft) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [draft, onPointerMove, onPointerUp]);

  const begin = (e: React.PointerEvent, p: SlidePhoto, mode: 'move' | 'resize') => {
    if (!p.frame) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(p.id);
    gesture.current = { id: p.id, mode, startX: e.clientX, startY: e.clientY, from: p.frame };
    setDraft({ id: p.id, frame: p.frame });
  };

  // Handles are drawn inside the scale transform, so divide by it to keep
  // hairlines and grips a constant size on screen at any preview width.
  const px = (n: number) => n / scale;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {photos.map((p) => {
        const frame = draft?.id === p.id ? draft.frame : p.frame;
        if (!frame) return null;
        const selected = selectedId === p.id;
        return (
          <div
            key={p.id}
            onPointerDown={(e) => begin(e, p, 'move')}
            style={{
              position: 'absolute',
              left: `${frame.x * 100}%`,
              top: `${frame.y * 100}%`,
              width: `${frame.w * 100}%`,
              height: `${frame.h * 100}%`,
              cursor: 'move',
              // Only the selected picture takes the pointer, so clicking through
              // to the slide still works while you're editing copy.
              pointerEvents: selected ? 'auto' : 'none',
              outline: selected ? `${px(2)}px solid var(--accent)` : 'none',
              outlineOffset: px(2),
            }}
          >
            {selected && (
              <div
                onPointerDown={(e) => begin(e, p, 'resize')}
                title="Drag to resize"
                style={{
                  position: 'absolute',
                  right: px(-7),
                  bottom: px(-7),
                  width: px(14),
                  height: px(14),
                  borderRadius: px(3),
                  background: 'var(--accent)',
                  border: `${px(2)}px solid #fff`,
                  cursor: 'nwse-resize',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
