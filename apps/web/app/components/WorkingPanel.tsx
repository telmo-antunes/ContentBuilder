'use client';

import { useStagedProgressState, type ProgressStage } from './useStagedProgress';

/**
 * A cinematic "the AI is working" panel for the app's long operations (brand
 * extraction, recipe authoring). Instead of a frozen spinner it narrates the
 * real pipeline stages, animates a brand-toned aurora, and ghosts a preview of
 * what's coming — so the wait builds anticipation. Renders nothing when inactive.
 *
 * The ghost preview is deliberately SPECIFIC to the job in hand. Authoring two
 * design directions ghosts two cards, not one, because the shape of the wait
 * should tell you what is being made; and it ghosts them in the brand's OWN
 * colours, which are already known by the time a recipe is authored. A generic
 * grey skeleton wastes the one moment the user is definitely looking.
 */
export function WorkingPanel({
  active,
  stages,
  title,
  sub,
  bare = false,
  count = 1,
  notes,
  palette,
}: {
  active: boolean;
  stages: ProgressStage[];
  title: string;
  sub: string;
  /** Drop the panel's own border/background — for nesting inside another card. */
  bare?: boolean;
  /** How many things are being made; ghosts one card each (e.g. 2 directions). */
  count?: number;
  /** Optional per-card labels, e.g. ['Faithful', 'Bolder']. */
  notes?: string[];
  /** The brand's real colours, so the ghost is this brand and not any brand. */
  palette?: string[];
}) {
  const { label, index, seconds } = useStagedProgressState(active, stages);
  if (!active) return null;
  const cards = Array.from({ length: Math.max(1, count) }, (_, i) => i);
  const swatches = (palette && palette.length ? palette : [null, null, null, null, null]).slice(0, 5);
  return (
    <div className={`work${bare ? ' work-bare' : ''}`} role="status" aria-live="polite">
      <span className="work-aura a" aria-hidden />
      <span className="work-aura b" aria-hidden />
      <span className="work-grain" aria-hidden />
      <div className="work-in">
        <div className="work-head">
          <span className="work-dot" />
          <span className="work-title">{title}</span>
          {/* Measured, so it can be stated as fact. */}
          <span className="work-elapsed mono">{fmt(seconds)}</span>
        </div>
        {/* key on the label so each new stage re-triggers the rise-in animation */}
        <p className="work-label" key={label ?? ''}>
          {label ?? '…'}
        </p>
        {/* A rail of named phases rather than a percentage: the stage timing is
            an estimate, and a number would dress it up as telemetry. */}
        <div className="work-rail" aria-hidden>
          {stages.map((s, i) => (
            <span
              key={s.label}
              className={`work-tick${i < index ? ' done' : ''}${i === index ? ' now' : ''}`}
            />
          ))}
        </div>
        <div className="work-preview" aria-hidden>
          <div className="work-swatches">
            {swatches.map((hex, i) => (
              <span
                key={i}
                className={hex ? 'has' : ''}
                style={{
                  animationDelay: `${i * 0.18}s`,
                  ...(hex ? { background: hex } : null),
                }}
              />
            ))}
          </div>
          <div className="work-cards">
            {cards.map((i) => (
              <div className="work-slide" key={i} style={{ animationDelay: `${i * 0.5}s` }}>
                {notes?.[i] ? <span className="work-note">{notes[i]}</span> : null}
                <span className="work-ln sm" style={{ animationDelay: `${i * 0.5}s` }} />
                <span className="work-ln lg" style={{ animationDelay: `${i * 0.5 + 0.12}s` }} />
                <span className="work-ln md" style={{ animationDelay: `${i * 0.5 + 0.24}s` }} />
              </div>
            ))}
          </div>
        </div>
        <p className="work-sub">{sub}</p>
      </div>
    </div>
  );
}

/** m:ss once past a minute — these waits routinely cross it. */
function fmt(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
