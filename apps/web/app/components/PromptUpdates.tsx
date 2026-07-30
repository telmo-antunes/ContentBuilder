'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  TOUCHPOINT_REGISTRY,
  type PromptRelease,
  type TouchpointId,
  type UpdateStatus,
} from '@contentbuilder/shared';
import { Icon } from './Icon';

/**
 * "THE AI GOT BETTER SINCE THIS WAS MADE" — said only when it is both true and
 * demonstrable.
 *
 * The rule that keeps this worth reading lives in the API: a strip appears only
 * when the artifact is behind AND a detector found the specific thing in it a
 * newer prompt would fix. So the headline is never "you are on v2, v5 exists" —
 * it is "your call to action is 32px, which is 11.6pt on a phone".
 *
 * Nothing here has a one-click apply, deliberately. Re-authoring a recipe costs
 * money and moves a design that was approved; re-composing a slide rewrites
 * words that may have been edited by hand. The strip tells you, points at the
 * button that already exists for doing it, and stops.
 */
export default function PromptUpdates({
  status,
  /** What re-running this touchpoint is called here, e.g. "Design directions". */
  action,
  className,
}: {
  status: UpdateStatus | null | undefined;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!status?.flagged) return null;

  return (
    <aside className={`pu${className ? ` ${className}` : ''}`} role="status">
      <div className="pu-head">
        <Icon name="sparkle" size={14} />
        <p className="pu-msg">
          The AI has improved since this was made
          {status.findings.length === 1 ? ', and one thing here would change:' : ':'}
        </p>
        <button className="btn sm ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Less' : "What's changed"}
        </button>
        {action && (
          <button className="btn sm" onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </button>
        )}
      </div>

      {/* The evidence, always visible — it is the whole reason the strip is here. */}
      <ul className="pu-findings">
        {status.findings.map((f, i) => (
          <li key={`${f.detector}-${i}`}>{f.message}</li>
        ))}
      </ul>

      {open && (
        <div className="pu-releases">
          {status.behind.map((b) => (
            <section key={b.touchpoint}>
              <h4>
                {TOUCHPOINT_REGISTRY[b.touchpoint].label}
                <span className="pu-vers">
                  {b.from === 0 ? 'before versions' : `v${b.from}`} → v{b.to}
                </span>
              </h4>
              <ReleaseList releases={b.releases} from={b.from} />
            </section>
          ))}
          <p className="pu-more">
            <Link href="/whats-new">Every change, touchpoint by touchpoint →</Link>
          </p>
        </div>
      )}
    </aside>
  );
}

/**
 * The releases an artifact missed. Rendered newest-last, the way a changelog
 * reads forwards — this is a story of what got better, not a list of versions.
 */
export function ReleaseList({ releases, from = 0 }: { releases: PromptRelease[]; from?: number }) {
  return (
    <ol className="pu-rel">
      {releases.map((r) => (
        <li key={r.version} className={r.version <= from ? 'has' : ''}>
          <div className="pu-rel-head">
            <span className="pu-rel-v">v{r.version}</span>
            <strong>{r.summary}</strong>
            <time dateTime={r.date}>{r.date}</time>
          </div>
          <ul>
            {r.improves.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** Ordered so the reader meets the touchpoints in the order they run. */
export const TOUCHPOINT_ORDER: TouchpointId[] = [
  'vision',
  'recipeAuthor',
  'recipeCritique',
  'parse',
  'compose',
  'caption',
];
