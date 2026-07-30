'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AMBIENT_SECONDS, type AmbientSpec, type PhotoMove } from '@contentbuilder/shared';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How each move ARRIVES at this framing, said the way a person would say it. */
const MOVE_PHRASE: Record<Exclude<PhotoMove, 'auto'>, string> = {
  none: 'it holds still',
  zoom: 'it starts close on the dot and opens out to this',
  left: 'it slides in from the left and settles here',
  right: 'it slides in from the right and settles here',
  up: 'it slides in from above and settles here',
  down: 'it slides in from below and settles here',
};

/**
 * Choose which part of a photo survives the crop — and see where the motion
 * leaves it.
 *
 * A slot has a shape the DESIGN chose; your photo has whatever shape your
 * camera chose. When they disagree something has to go, and centring is only
 * the right answer by accident — a portrait in a wide slot loses a head. This
 * shows the whole picture and lets you put the crosshair on the part that
 * matters; the renderer feeds it to `background-position` / `object-position`.
 *
 * THERE IS ONLY ONE CROP. Video used to add a second one this picker had to
 * draw a brass frame for: ambient motion held at the END of its move, so a
 * push-in shipped a tighter framing than the one you set here. Motion now
 * lands at rest instead, in the clip's first few seconds, so what you choose
 * here is what the video holds and what the PNG exports. The move is described
 * in words below; there is nothing left to outline.
 */
export default function FocalPicker({
  url,
  value,
  onChange,
  move,
  ambient,
}: {
  url: string;
  value?: { x: number; y: number };
  onChange: (focal: { x: number; y: number }) => void;
  /** The move this photo really makes — already resolved out of 'auto'. */
  move?: Exclude<PhotoMove, 'auto'>;
  /** The brand's ambient setting; 'none' means the photo never moves at all. */
  ambient?: AmbientSpec;
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
    const onPointerMove = (e: PointerEvent) => {
      const p = at(e.clientX, e.clientY);
      if (p) setDraft(p);
    };
    const up = (e: PointerEvent) => {
      const p = at(e.clientX, e.clientY);
      setDragging(false);
      setDraft(null);
      if (p) onChange(p);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, at, onChange]);

  /**
   * What the motion does, in words. Every move ends on this framing, so the
   * sentence is about the FIRST few seconds and always closes the same way.
   */
  const still = !move || move === 'none' || ambient?.style === 'none';
  const motionHint = !move
    ? null
    : still
      ? 'It holds still in the video, so this framing is exactly what gets exported.'
      : `In the video ${MOVE_PHRASE[move]} over the first ${AMBIENT_SECONDS} seconds, then holds. Nothing beyond this framing is ever cropped away.`;

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
        {motionHint ? ` ${motionHint}` : ''}
      </p>
    </div>
  );
}
