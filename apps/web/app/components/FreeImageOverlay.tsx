'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockFrame, SlidePhoto } from '@contentbuilder/shared';

/** Nothing smaller than this fraction of the canvas — a 0-size image is unclickable. */
const MIN = 0.05;
/** Snap when an edge or centre lands within this fraction of a guide. */
const SNAP = 0.012;
/** Where a picture usually wants to sit: the canvas edges, its margins, its centre. */
const GUIDES = [0, 0.08, 0.5, 0.92, 1];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The eight grips, as the fraction of the box each one sits at. */
const HANDLES: Array<{ hx: 0 | 0.5 | 1; hy: 0 | 0.5 | 1; cursor: string }> = [
  { hx: 0, hy: 0, cursor: 'nwse-resize' },
  { hx: 0.5, hy: 0, cursor: 'ns-resize' },
  { hx: 1, hy: 0, cursor: 'nesw-resize' },
  { hx: 1, hy: 0.5, cursor: 'ew-resize' },
  { hx: 1, hy: 1, cursor: 'nwse-resize' },
  { hx: 0.5, hy: 1, cursor: 'ns-resize' },
  { hx: 0, hy: 1, cursor: 'nesw-resize' },
  { hx: 0, hy: 0.5, cursor: 'ew-resize' },
];

/** Snap a value to the nearest guide, reporting which one caught it. */
function snap(v: number, extra: number[] = []): { v: number; guide: number | null } {
  let best: number | null = null;
  let bestD = SNAP;
  for (const g of [...GUIDES, ...extra]) {
    const d = Math.abs(v - g);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best === null ? { v, guide: null } : { v: best, guide: best };
}

/**
 * Direct manipulation for a slide's FLOATING images.
 *
 * Rendered through `ScaledSlide`'s overlay, so it lives inside the same
 * `transform: scale()` as the slide and can be positioned in canvas pixels —
 * a handle therefore sits exactly on the picture at any preview size. The
 * pointer, however, moves in SCREEN pixels: every delta is divided by `scale`
 * before it becomes a frame fraction, or dragging would run away from the
 * cursor at anything other than 1:1.
 *
 * Frames are fractions of the canvas [0..1], so a placement made against a
 * 288px preview holds exactly on the 1080px export.
 *
 * The first version of this had a single grip on the bottom-right corner, no
 * aspect lock, no keyboard, no snapping, and — worst — `pointer-events: none`
 * until the photo was already selected, so you could not click a picture on
 * the preview at all. You had to find its card in the side panel and toggle a
 * mode first. Everything here exists to undo that.
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
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [hover, setHover] = useState<string | null>(null);
  const gesture = useRef<{
    id: string;
    handle: { hx: number; hy: number } | null; // null = moving the whole picture
    startX: number;
    startY: number;
    from: BlockFrame;
    /** Pixel aspect of the box when the gesture began, for the corner lock. */
    ratio: number;
    free: boolean;
  } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      // Screen px → canvas px → fraction of the canvas.
      const dx = (e.clientX - g.startX) / scale / canvasW;
      const dy = (e.clientY - g.startY) / scale / canvasH;
      const f = g.from;
      let frame: BlockFrame;
      let gx: number | null = null;
      let gy: number | null = null;

      if (!g.handle) {
        // MOVE. Snap whichever of the three horizontal references is closest —
        // left edge, centre, right edge — so a picture can be centred or flushed
        // to a margin exactly, which is impossible to hit by hand at this scale.
        let x = clamp01(Math.min(Math.max(f.x + dx, 0), 1 - f.w));
        let y = clamp01(Math.min(Math.max(f.y + dy, 0), 1 - f.h));
        const sx = [snap(x), snap(x + f.w / 2), snap(x + f.w)];
        const hit = sx.findIndex((s) => s.guide !== null);
        if (hit === 0) x = sx[0]!.v;
        else if (hit === 1) x = sx[1]!.v - f.w / 2;
        else if (hit === 2) x = sx[2]!.v - f.w;
        if (hit >= 0) gx = sx[hit]!.guide;

        const sy = [snap(y), snap(y + f.h / 2), snap(y + f.h)];
        const hity = sy.findIndex((s) => s.guide !== null);
        if (hity === 0) y = sy[0]!.v;
        else if (hity === 1) y = sy[1]!.v - f.h / 2;
        else if (hity === 2) y = sy[2]!.v - f.h;
        if (hity >= 0) gy = sy[hity]!.guide;

        frame = { x: clamp01(x), y: clamp01(y), w: f.w, h: f.h };
      } else {
        // RESIZE, anchored to the OPPOSITE corner or edge. The old version only
        // ever grew down-and-right, so nudging the top edge meant moving the
        // whole picture and resizing it back.
        const { hx, hy } = g.handle;
        let x = f.x;
        let y = f.y;
        let w = f.w;
        let h = f.h;
        if (hx === 0) {
          const nx = Math.min(f.x + dx, f.x + f.w - MIN);
          const s = snap(nx);
          x = clamp01(s.v);
          gx = s.guide;
          w = f.x + f.w - x;
        } else if (hx === 1) {
          const right = Math.max(f.x + f.w + dx, f.x + MIN);
          const s = snap(right);
          gx = s.guide;
          w = clamp01(s.v) - f.x;
        }
        if (hy === 0) {
          const ny = Math.min(f.y + dy, f.y + f.h - MIN);
          const s = snap(ny);
          y = clamp01(s.v);
          gy = s.guide;
          h = f.y + f.h - y;
        } else if (hy === 1) {
          const bottom = Math.max(f.y + f.h + dy, f.y + MIN);
          const s = snap(bottom);
          gy = s.guide;
          h = clamp01(s.v) - f.y;
        }
        // A CORNER keeps the picture's proportions unless you hold Shift —
        // dragging a corner and watching the photo squash is the thing that
        // made the old handle feel broken.
        if (hx !== 0.5 && hy !== 0.5 && !g.free) {
          const wPx = w * canvasW;
          const derivedH = wPx / g.ratio / canvasH;
          if (hy === 0) y = f.y + f.h - derivedH;
          h = derivedH;
          gy = null;
        }
        frame = {
          x: clamp01(x),
          y: clamp01(y),
          w: Math.max(MIN, Math.min(w, 1 - clamp01(x))),
          h: Math.max(MIN, Math.min(h, 1 - clamp01(y))),
        };
      }
      setGuides({ x: gx, y: gy });
      setDraft({ id: g.id, frame });
    },
    [scale, canvasW, canvasH],
  );

  const onPointerUp = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    setGuides({ x: null, y: null });
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

  /** Arrow keys for the last few pixels a mouse can't hit at this preview size. */
  useEffect(() => {
    if (!selectedId) return;
    const photo = photos.find((p) => p.id === selectedId);
    if (!photo?.frame) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'Escape') return onSelect(null);
      const step = e.shiftKey ? 0.02 : 0.004;
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = d[e.key];
      if (!move) return;
      e.preventDefault();
      const f = photo.frame!;
      onCommit(selectedId, {
        ...f,
        x: clamp01(Math.min(Math.max(f.x + move[0], 0), 1 - f.w)),
        y: clamp01(Math.min(Math.max(f.y + move[1], 0), 1 - f.h)),
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, photos, onCommit, onSelect]);

  const begin = (
    e: React.PointerEvent,
    p: SlidePhoto,
    handle: { hx: number; hy: number } | null,
  ) => {
    if (!p.frame) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(p.id);
    gesture.current = {
      id: p.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      from: p.frame,
      ratio: (p.frame.w * canvasW) / (p.frame.h * canvasH),
      free: e.shiftKey,
    };
    setDraft({ id: p.id, frame: p.frame });
  };

  // Handles are drawn inside the scale transform, so divide by it to keep
  // hairlines and grips a constant size on screen at any preview width.
  const px = (n: number) => n / scale;
  const active = draft?.id ?? null;

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      // Clicking bare canvas drops the selection, the way every editor behaves.
      onPointerDown={() => onSelect(null)}
    >
      {/* Alignment guides, only while a drag is actually snapped to one. */}
      {guides.x !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${guides.x * 100}%`,
            top: 0,
            bottom: 0,
            width: px(1),
            background: 'var(--accent)',
            opacity: 0.9,
            pointerEvents: 'none',
          }}
        />
      )}
      {guides.y !== null && (
        <div
          style={{
            position: 'absolute',
            top: `${guides.y * 100}%`,
            left: 0,
            right: 0,
            height: px(1),
            background: 'var(--accent)',
            opacity: 0.9,
            pointerEvents: 'none',
          }}
        />
      )}

      {photos.map((p) => {
        const frame = draft?.id === p.id ? draft.frame : p.frame;
        if (!frame) return null;
        const selected = selectedId === p.id;
        const showing = selected || hover === p.id;
        return (
          <div
            key={p.id}
            onPointerDown={(e) => begin(e, p, null)}
            onPointerEnter={() => setHover(p.id)}
            onPointerLeave={() => setHover((h) => (h === p.id ? null : h))}
            style={{
              position: 'absolute',
              left: `${frame.x * 100}%`,
              top: `${frame.y * 100}%`,
              width: `${frame.w * 100}%`,
              height: `${frame.h * 100}%`,
              cursor: selected ? 'move' : 'pointer',
              // Every floating picture is hit-testable, so one click on the
              // preview selects it. Previously this was off until selected,
              // which made the preview unusable as a way IN.
              pointerEvents: 'auto',
              outline: showing
                ? `${px(selected ? 2 : 1.5)}px ${selected ? 'solid' : 'dashed'} var(--accent)`
                : 'none',
              outlineOffset: px(2),
            }}
          >
            {selected &&
              HANDLES.map((h) => (
                <div
                  key={`${h.hx}-${h.hy}`}
                  onPointerDown={(e) => begin(e, p, { hx: h.hx, hy: h.hy })}
                  title={
                    h.hx !== 0.5 && h.hy !== 0.5
                      ? 'Drag to resize · hold Shift to stretch freely'
                      : 'Drag to resize this side'
                  }
                  style={{
                    position: 'absolute',
                    left: `${h.hx * 100}%`,
                    top: `${h.hy * 100}%`,
                    width: px(12),
                    height: px(12),
                    marginLeft: px(-6),
                    marginTop: px(-6),
                    borderRadius: px(3),
                    background: 'var(--accent)',
                    border: `${px(2)}px solid #fff`,
                    boxShadow: `0 0 0 ${px(1)}px rgba(0,0,0,.35)`,
                    cursor: h.cursor,
                  }}
                />
              ))}

            {/* Live size readout — the preview is ~290px, so "how big is this
                actually going to be" is otherwise pure guesswork. */}
            {active === p.id && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: `100%`,
                  transform: 'translate(-50%, 0)',
                  marginTop: px(10),
                  padding: `${px(4)}px ${px(9)}px`,
                  borderRadius: px(6),
                  background: 'rgba(0,0,0,.82)',
                  color: '#fff',
                  fontSize: px(15),
                  fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {Math.round(frame.w * canvasW)} × {Math.round(frame.h * canvasH)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
