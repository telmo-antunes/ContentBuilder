'use client';

import { useEffect, useState } from 'react';

export interface ProgressStage {
  /** Label shown once `atMs` has elapsed since the operation started. */
  label: string;
  atMs: number;
}

export interface StagedProgress {
  /** The current stage's label, or null when inactive. */
  label: string | null;
  /** Index of the current stage — drives the phase rail. -1 when inactive. */
  index: number;
  /** Whole seconds since the operation started. Measured, not estimated. */
  seconds: number;
}

/**
 * Staged progress for long AI operations.
 *
 * The server doesn't stream progress, but the pipeline's stages and their
 * typical timing are known — so advance an honest, descriptive label on a timer
 * instead of freezing on one spinner word for a minute.
 *
 * Two different kinds of number come out of here, and the difference matters
 * for how they may be shown. `index` is an ESTIMATE (a timer against typical
 * durations), so it drives a rail of named phases and never a percentage —
 * "phase 3 of 7" would claim a precision we don't have. `seconds` is MEASURED,
 * so it can be displayed as fact.
 */
export function useStagedProgressState(active: boolean, stages: ProgressStage[]): StagedProgress {
  const [index, setIndex] = useState(-1);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(-1);
      setSeconds(0);
      return;
    }
    setIndex(0);
    setSeconds(0);
    const startedAt = performance.now();
    const timers = stages
      .map((s, i) => (s.atMs > 0 ? setTimeout(() => setIndex(i), s.atMs) : null))
      .filter((t): t is ReturnType<typeof setTimeout> => t !== null);
    // A 1s tick is enough for a seconds read-out and stays cheap over a minute.
    const ticker = setInterval(() => {
      setSeconds(Math.floor((performance.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(ticker);
    };
    // Stage arrays are declared inline at call sites; keying on `active` alone
    // avoids re-arming timers every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { label: index >= 0 ? (stages[index]?.label ?? null) : null, index, seconds };
}

/** Label-only view of {@link useStagedProgressState}, for simple callers. */
export function useStagedProgress(active: boolean, stages: ProgressStage[]): string | null {
  return useStagedProgressState(active, stages).label;
}

/** The app's long AI operations, with labels matched to the real pipeline. */
export const ANALYZE_STAGES: ProgressStage[] = [
  { label: 'Capturing the homepage…', atMs: 0 },
  { label: 'Sampling the colours…', atMs: 9000 },
  { label: 'Matching the typography…', atMs: 18000 },
  { label: 'Listening for the brand voice…', atMs: 28000 },
  { label: 'Assembling the kit…', atMs: 38000 },
];

/**
 * Re-analysing an existing brand. Same pipeline as the first pass, plus the
 * image harvest that `POST /analyze` runs — and it ends by saying the kit
 * arrives as a draft, because the approved one is NOT replaced until you
 * approve, and that is the first question anyone has while waiting.
 */
export const REANALYZE_STAGES: ProgressStage[] = [
  { label: 'Re-opening your site…', atMs: 0 },
  { label: 'Re-sampling the colours…', atMs: 9000 },
  { label: 'Re-reading the typography…', atMs: 18000 },
  { label: 'Listening for the brand voice…', atMs: 27000 },
  { label: 'Collecting photos from your site…', atMs: 36000 },
  { label: 'Assembling a fresh draft…', atMs: 45000 },
];

export const RECIPE_STAGES: ProgressStage[] = [
  { label: 'Studying your brand…', atMs: 0 },
  { label: 'Rationing the palette…', atMs: 9000 },
  { label: 'Setting the type system…', atMs: 18000 },
  { label: 'Designing the signature move…', atMs: 28000 },
  { label: 'Composing the backgrounds…', atMs: 40000 },
  { label: 'Refining against the bar…', atMs: 55000 },
  { label: 'Almost there…', atMs: 72000 },
];
