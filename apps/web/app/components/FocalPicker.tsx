'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Choose which part of a photo survives the crop.
 *
 * A slot has a shape the DESIGN chose; your photo has whatever shape your
 * camera chose. When they disagree something has to go, and centring is only
 * the right answer by accident — a portrait in a wide slot loses a head. This
 * shows the whole picture and lets you put the crosshair on the part that
 * matters; the renderer feeds it to `background-position` / `object-position`.
 */
export default function FocalPicker({
  url,
  value,
  onChange,
}: {
  url: string;
  value?: { x: number; y: number };
  onChange: (focal: { x: number; y: number }) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const focal = draft ?? value ?? { x: 0.5, y: 0.5 };

  const at = useCallback((clientX: number, clientY: number) => {
    const el = boxRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const p = at(e.clientX, e.clientY);
      if (p) setDraft(p);
    };
    const up = (e: PointerEvent) => {
      const p = at(e.clientX, e.clientY);
      setDragging(false);
      setDraft(null);
      if (p) onChange(p);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, at, onChange]);

  return (
    <div className="fp">
      <div
        ref={boxRef}
        className="fp-box"
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
          const p = at(e.clientX, e.clientY);
          if (p) setDraft(p);
        }}
      >
        <img src={url} alt="" />
        <span className="fp-dot" style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} />
      </div>
      <p className="fp-hint">
        Drag to choose what stays in frame when this photo is cropped to its box.
      </p>
    </div>
  );
}
