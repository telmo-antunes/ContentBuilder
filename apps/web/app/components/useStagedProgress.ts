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

/** The app's three long operations, with labels matched to the real pipeline. */
export const DRAFT_STAGES: ProgressStage[] = [
  { label: 'Arranging your copy into slides…', atMs: 0 },
  { label: 'Composing layouts…', atMs: 8000 },
  { label: 'Reviewing the design…', atMs: 25000 },
  { label: 'Writing the caption…', atMs: 45000 },
  { label: 'Almost there…', atMs: 75000 },
];

export const POLISH_STAGES: ProgressStage[] = [
  { label: 'Rendering slides…', atMs: 0 },
  { label: 'Reviewing the design…', atMs: 8000 },
  { label: 'Applying fixes…', atMs: 20000 },
  { label: 'Double-checking…', atMs: 35000 },
];

export const ANALYZE_STAGES: ProgressStage[] = [
  { label: 'Capturing the homepage…', atMs: 0 },
  { label: 'Reading colors & typography…', atMs: 12000 },
  { label: 'Listening for the brand voice…', atMs: 25000 },
  { label: 'Assembling the kit…', atMs: 40000 },
];
