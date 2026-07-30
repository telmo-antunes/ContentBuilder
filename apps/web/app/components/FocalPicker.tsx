'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hasSettledShift,
  settledViewport,
  type AmbientLayer,
  type AmbientSpec,
  type PhotoMove,
} from '@contentbuilder/shared';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** What each move does, said the way a person would say it. */
const MOVE_PHRASE: Record<Exclude<PhotoMove, 'auto'>, string> = {
  none: 'holds still',
  in: 'slowly closes in on the dot',
  out: 'slowly pulls back',
  left: 'drifts left',
  right: 'drifts right',
  up: 'drifts up',
  down: 'drifts down',
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
 * THE SECOND CROP. Video adds one the still preview never showed: ambient
 * motion holds at the END of its move, so a push-in ships the framing it
 * settles into, not the one you see at rest. Framing against the resting box
 * therefore quietly lost the edges. `settledViewport` says exactly how much,
 * and the brass frame below draws it — everything scrimmed is gone by the time
 * the clip lands.
 */
export default function FocalPicker({
  url,
  value,
  onChange,
  move,
  layer,
  ambient,
}: {
  url: string;
  value?: { x: number; y: number };
  onChange: (focal: { x: number; y: number }) => void;
  /** The move this photo really makes — already resolved out of 'auto'. */
  move?: Exclude<PhotoMove, 'auto'>;
  /** Which depth it moves at: background, slot, or a floating overlay. */
  layer?: AmbientLayer;
  /** The brand's ambient setting. Without all three, no guide is drawn. */
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

  // The motion is anchored on the focal point, so the guide has to follow the
  // LIVE dot — including mid-drag — or it would describe the previous framing.
  const shifts = Boolean(move && layer && ambient && hasSettledShift(move, layer, ambient));
  const settled =
    move && layer && ambient && shifts ? settledViewport(move, layer, ambient, focal) : null;

  /**
   * What the motion does to the framing, in words. A full-box result gets a
   * sentence instead of a rectangle: an outline around the entire picture says
   * nothing, and drawing one would imply something is being trimmed.
   */
  const motionHint = !move
    ? null
    : !shifts
      ? move === 'out'
        ? 'In the video it starts close and pulls back to the whole box, so nothing further is lost by the end.'
        : 'It holds still in the video, so this framing is exactly what gets exported.'
      : `In the video it ${MOVE_PHRASE[move]}, and stops there — only what is inside the brass frame is still showing at the end. Everything shaded has gone.`;

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
        {settled && (
          <span
            className="fp-settled"
            aria-hidden
            style={{
              left: `${settled.x * 100}%`,
              top: `${settled.y * 100}%`,
              width: `${settled.w * 100}%`,
              height: `${settled.h * 100}%`,
            }}
          />
        )}
        <span className="fp-dot" style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} />
      </div>
      <p className="fp-hint">
        Drag to choose what stays in frame when this photo is cropped to its box.
        {motionHint ? ` ${motionHint}` : ''}
      </p>
    </div>
  );
}
