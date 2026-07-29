'use client';

import { useEffect, useState } from 'react';

export interface ProgressStage {
  /** Label shown once `atMs` has elapsed since the operation started. */
  label: string;
  atMs: number;
}

/**
 * Staged progress text for long AI operations. The server doesn't stream
 * progress, but the pipeline's stages and their typical timing are known — so
 * advance an honest, descriptive label on a timer instead of freezing on one
 * spinner word for a minute. Returns null when inactive.
 */
export function useStagedProgress(active: boolean, stages: ProgressStage[]): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setLabel(null);
      return;
    }
    setLabel(stages[0]?.label ?? null);
    const timers = stages
      .filter((s) => s.atMs > 0)
      .map((s) => setTimeout(() => setLabel(s.label), s.atMs));
    return () => timers.forEach(clearTimeout);
    // Stage arrays are declared inline at call sites; keying on `active` alone
    // avoids re-arming timers every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return label;
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
