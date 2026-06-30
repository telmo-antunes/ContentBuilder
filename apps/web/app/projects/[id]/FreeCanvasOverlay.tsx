'use client';

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Slide } from '@contentbuilder/shared';
import { BLOCK_LABELS } from '@contentbuilder/shared';

type Frame = { x: number; y: number; w: number; h: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';

const MIN = 0.05;
const SNAP = 0.01; // snap threshold in canvas fractions (~10px on a 1080 canvas)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const fallback = (i: number): Frame => ({ x: 0.1, y: 0.1 + (i % 4) * 0.04, w: 0.8, h: 0.18 });

/** Snap any of `lines` to the nearest of `targets` within SNAP; returns the shift + the matched guide line. */
function snapAxis(lines: number[], targets: number[], enabled: boolean): { delta: number; guide: number | null } {
  if (!enabled) return { delta: 0, guide: null };
  let best = { delta: 0, guide: null as number | null, dist: SNAP };
  for (const line of lines) {
    for (const t of targets) {
      const dist = Math.abs(t - line);
      if (dist < best.dist) best = { delta: t - line, guide: t, dist };
    }
  }
  return best;
}

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
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  // Snap candidates (canvas edges/centers + the other elements' edges/centers),
  // captured at drag start so the moving element never snaps to itself.
  const snapTargets = useRef<{ v: number[]; h: number[] }>({ v: [], h: [] });

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
  (slide.overrides?.imageObjects ?? []).forEach((o, i) => {
    targets.push({ id: `obj-${i}`, label: `Image ${i + 1}`, frame: o.frame, isImage: true });
  });

  const blockIndex = (id: string) => Number(id.slice(1));

  // Capture snap lines from the canvas (0/0.5/1) and every OTHER element's edges + centers.
  const buildTargets = (excludeId: string) => {
    const v = [0, 0.5, 1];
    const h = [0, 0.5, 1];
    for (const t of targets) {
      if (t.id === excludeId) continue;
      const f = t.frame;
      v.push(f.x, f.x + f.w / 2, f.x + f.w);
      h.push(f.y, f.y + f.h / 2, f.y + f.h);
    }
    snapTargets.current = { v, h };
  };

  const commitFrame = (id: string, frame: Frame) => {
    if (id === 'image') {
      onChange((s) => ({ ...s, overrides: { ...s.overrides, imageFrame: frame } }));
    } else if (id.startsWith('obj-')) {
      const i = Number(id.slice(4));
      onChange((s) => ({
        ...s,
        overrides: {
          ...s.overrides,
          imageObjects: (s.overrides?.imageObjects ?? []).map((o, oi) => (oi === i ? { ...o, frame } : o)),
        },
      }));
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
    const enabled = !e.altKey; // hold Alt to bypass snapping
    const T = snapTargets.current;
    if (drag.kind === 'move') {
      const { w, h } = drag.start;
      let x = drag.start.x + (p.x - drag.startPx);
      let y = drag.start.y + (p.y - drag.startPy);
      // Snap the element's left/center/right (and top/middle/bottom) to nearby lines.
      const sx = snapAxis([x, x + w / 2, x + w], T.v, enabled);
      const sy = snapAxis([y, y + h / 2, y + h], T.h, enabled);
      x = Math.max(0, Math.min(1 - w, x + sx.delta));
      y = Math.max(0, Math.min(1 - h, y + sy.delta));
      setLive({ id: drag.id, frame: { x, y, w, h } });
      setGuides({ x: sx.guide != null ? [sx.guide] : [], y: sy.guide != null ? [sy.guide] : [] });
    } else {
      // Snap the dragged corner to nearby lines.
      const sx = snapAxis([p.x], T.v, enabled);
      const sy = snapAxis([p.y], T.h, enabled);
      const cx = p.x + sx.delta;
      const cy = p.y + sy.delta;
      const left = Math.min(drag.anchorX, cx);
      const right = Math.max(drag.anchorX, cx);
      const top = Math.min(drag.anchorY, cy);
      const bottom = Math.max(drag.anchorY, cy);
      const w = Math.max(MIN, right - left);
      const h = Math.max(MIN, bottom - top);
      const x = Math.max(0, Math.min(left, 1 - w));
      const y = Math.max(0, Math.min(top, 1 - h));
      setLive({ id: drag.id, frame: { x, y, w, h } });
      setGuides({ x: sx.guide != null ? [sx.guide] : [], y: sy.guide != null ? [sy.guide] : [] });
    }
  };

  const endDrag = () => {
    if (drag && live && live.id === drag.id) commitFrame(drag.id, live.frame);
    setDrag(null);
    setLive(null);
    setGuides({ x: [], y: [] });
  };

  const startMove = (e: ReactPointerEvent, t: Target) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected(t.id);
    buildTargets(t.id);
    const p = ptrFrac(e.clientX, e.clientY);
    setDrag({ kind: 'move', id: t.id, startPx: p.x, startPy: p.y, start: t.frame });
  };

  const startResize = (e: ReactPointerEvent, t: Target, corner: Corner) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected(t.id);
    buildTargets(t.id);
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
      {/* Snap guide lines (only visible mid-drag). */}
      {guides.x.map((g, i) => (
        <div
          key={`vg${i}`}
          style={{ position: 'absolute', left: `${g * 100}%`, top: 0, bottom: 0, width: Math.max(1, px), marginLeft: -px / 2, background: 'rgba(255,86,140,0.9)', pointerEvents: 'none', zIndex: 60 }}
        />
      ))}
      {guides.y.map((g, i) => (
        <div
          key={`hg${i}`}
          style={{ position: 'absolute', top: `${g * 100}%`, left: 0, right: 0, height: Math.max(1, px), marginTop: -px / 2, background: 'rgba(255,86,140,0.9)', pointerEvents: 'none', zIndex: 60 }}
        />
      ))}
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
