'use client';

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Slide } from '@contentbuilder/shared';
import { BLOCK_LABELS } from '@contentbuilder/shared';

type Frame = { x: number; y: number; w: number; h: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';

const MIN = 0.05;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const fallback = (i: number): Frame => ({ x: 0.1, y: 0.1 + (i % 4) * 0.04, w: 0.8, h: 0.18 });

/** A draggable element on the canvas: a text block (`b<i>`) or the image (`image`). */
type Target = { id: string; label: string; frame: Frame; isImage: boolean };

type DragState =
  | { kind: 'move'; id: string; startPx: number; startPy: number; start: Frame }
  | { kind: 'resize'; id: string; anchorX: number; anchorY: number }
  | null;

/**
 * Editor-only drag layer for FreePosition slides. Rendered inside ScaledSlide's
 * scaled wrapper (full-canvas pixel space) so positions are plain percentages and
 * the parent transform handles display scaling. Drives both the text blocks and
 * the image region (overrides.imageFrame). Handle/label sizes are counter-scaled.
 */
export function FreeCanvasOverlay({
  slide,
  scale,
  onChange,
}: {
  slide: Slide;
  scale: number;
  onChange: (fn: (s: Slide) => Slide) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [live, setLive] = useState<{ id: string; frame: Frame } | null>(null);

  const px = 1 / scale; // a displayed pixel expressed in canvas units
  const HANDLE = 12 * px;

  const targets: Target[] = slide.blocks.map((b, i) => ({
    id: `b${i}`,
    label: BLOCK_LABELS[b.type],
    frame: b.frame ?? fallback(i),
    isImage: false,
  }));
  // A full-bleed background image isn't positioned, so it gets no drag box.
  if (slide.overrides?.imageFrame && !slide.overrides?.imageBackground) {
    targets.push({ id: 'image', label: 'Image', frame: slide.overrides.imageFrame, isImage: true });
  }

  const blockIndex = (id: string) => Number(id.slice(1));

  const commitFrame = (id: string, frame: Frame) => {
    if (id === 'image') {
      onChange((s) => ({ ...s, overrides: { ...s.overrides, imageFrame: frame } }));
    } else {
      const i = blockIndex(id);
      onChange((s) => ({ ...s, blocks: s.blocks.map((b, bi) => (bi === i ? { ...b, frame } : b)) }));
    }
  };

  const ptrFrac = (clientX: number, clientY: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  };

  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = ptrFrac(e.clientX, e.clientY);
    if (drag.kind === 'move') {
      const { w, h } = drag.start;
      const x = Math.max(0, Math.min(1 - w, drag.start.x + (p.x - drag.startPx)));
      const y = Math.max(0, Math.min(1 - h, drag.start.y + (p.y - drag.startPy)));
      setLive({ id: drag.id, frame: { x, y, w, h } });
    } else {
      const left = Math.min(drag.anchorX, p.x);
      const right = Math.max(drag.anchorX, p.x);
      const top = Math.min(drag.anchorY, p.y);
      const bottom = Math.max(drag.anchorY, p.y);
      const w = Math.max(MIN, right - left);
      const h = Math.max(MIN, bottom - top);
      const x = Math.max(0, Math.min(left, 1 - w));
      const y = Math.max(0, Math.min(top, 1 - h));
      setLive({ id: drag.id, frame: { x, y, w, h } });
    }
  };

  const endDrag = () => {
    if (drag && live && live.id === drag.id) commitFrame(drag.id, live.frame);
    setDrag(null);
    setLive(null);
  };

  const startMove = (e: ReactPointerEvent, t: Target) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected(t.id);
    const p = ptrFrac(e.clientX, e.clientY);
    setDrag({ kind: 'move', id: t.id, startPx: p.x, startPy: p.y, start: t.frame });
  };

  const startResize = (e: ReactPointerEvent, t: Target, corner: Corner) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected(t.id);
    const f = t.frame;
    const anchorX = corner === 'nw' || corner === 'sw' ? f.x + f.w : f.x;
    const anchorY = corner === 'nw' || corner === 'ne' ? f.y + f.h : f.y;
    setDrag({ kind: 'resize', id: t.id, anchorX, anchorY });
  };

  const setZ = (id: string, toFront: boolean) => {
    const i = blockIndex(id);
    const zs = slide.blocks.map((b, k) => b.z ?? k);
    const z = toFront ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
    onChange((s) => ({ ...s, blocks: s.blocks.map((b, bi) => (bi === i ? { ...b, z } : b)) }));
  };

  return (
    <div
      ref={rootRef}
      onPointerDown={() => setSelected(null)}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      style={{ position: 'absolute', inset: 0, zIndex: 50 }}
    >
      {targets.map((t) => {
        const f = live && live.id === t.id ? live.frame : t.frame;
        const isSel = selected === t.id;
        const rgb = t.isImage ? '54,214,195' : '90,140,255'; // teal = image, blue = text
        return (
          <div
            key={t.id}
            onPointerDown={(e) => startMove(e, t)}
            style={{
              position: 'absolute',
              left: `${f.x * 100}%`,
              top: `${f.y * 100}%`,
              width: `${f.w * 100}%`,
              height: `${f.h * 100}%`,
              border: `${1.5 * px}px ${isSel ? 'solid' : 'dashed'} rgba(${rgb},${isSel ? 0.95 : 0.5})`,
              background: isSel ? `rgba(${rgb},0.08)` : 'transparent',
              cursor: 'move',
              boxSizing: 'border-box',
            }}
          >
            {isSel && (
              <div
                style={{
                  position: 'absolute',
                  top: -26 * px,
                  left: 0,
                  display: 'flex',
                  gap: 6 * px,
                  alignItems: 'center',
                  fontFamily: 'system-ui, sans-serif',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    background: `rgb(${rgb})`,
                    color: '#06231f',
                    padding: `${2 * px}px ${7 * px}px`,
                    borderRadius: 4 * px,
                    fontSize: 12 * px,
                    fontWeight: 600,
                  }}
                >
                  {t.label}
                </span>
                {!t.isImage && (
                  <>
                    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setZ(t.id, true)} style={zBtn(px)}>
                      front
                    </button>
                    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setZ(t.id, false)} style={zBtn(px)}>
                      back
                    </button>
                  </>
                )}
              </div>
            )}
            {isSel &&
              (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
                <div
                  key={c}
                  onPointerDown={(e) => startResize(e, t, c)}
                  style={{
                    position: 'absolute',
                    width: HANDLE,
                    height: HANDLE,
                    background: `rgb(${rgb})`,
                    borderRadius: 2 * px,
                    ...(c[0] === 'n' ? { top: -HANDLE / 2 } : { bottom: -HANDLE / 2 }),
                    ...(c[1] === 'w' ? { left: -HANDLE / 2 } : { right: -HANDLE / 2 }),
                    cursor: `${c}-resize`,
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function zBtn(px: number): CSSProperties {
  return {
    background: '#2a2f3a',
    color: '#e6e6e6',
    border: 'none',
    padding: `${2 * px}px ${7 * px}px`,
    borderRadius: 4 * px,
    fontSize: 12 * px,
    cursor: 'pointer',
  };
}
