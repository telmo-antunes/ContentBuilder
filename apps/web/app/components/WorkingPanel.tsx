'use client';

import { useStagedProgress, type ProgressStage } from './useStagedProgress';

/**
 * A cinematic "the AI is working" panel for the app's long operations (brand
 * extraction, recipe authoring). Instead of a frozen spinner it narrates the
 * real pipeline stages, animates a brand-toned aurora, and ghosts a preview of
 * what's coming (a palette + a slide taking shape) — so the wait builds
 * anticipation. Renders nothing when inactive.
 */
export function WorkingPanel({
  active,
  stages,
  title,
  sub,
  bare = false,
}: {
  active: boolean;
  stages: ProgressStage[];
  title: string;
  sub: string;
  /** Drop the panel's own border/background — for nesting inside another card. */
  bare?: boolean;
}) {
  const label = useStagedProgress(active, stages);
  if (!active) return null;
  return (
    <div className={`work${bare ? ' work-bare' : ''}`} role="status" aria-live="polite">
      <span className="work-aura a" aria-hidden />
      <span className="work-aura b" aria-hidden />
      <span className="work-grain" aria-hidden />
      <div className="work-in">
        <div className="work-head">
          <span className="work-dot" />
          <span className="work-title">{title}</span>
        </div>
        {/* key on the label so each new stage re-triggers the rise-in animation */}
        <p className="work-label" key={label ?? ''}>
          {label ?? '…'}
        </p>
        <div className="work-bar">
          <span />
        </div>
        <div className="work-preview" aria-hidden>
          <div className="work-swatches">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ animationDelay: `${i * 0.18}s` }} />
            ))}
          </div>
          <div className="work-slide">
            <span className="work-ln sm" />
            <span className="work-ln lg" />
            <span className="work-ln md" />
          </div>
        </div>
        <p className="work-sub">{sub}</p>
      </div>
    </div>
  );
}
