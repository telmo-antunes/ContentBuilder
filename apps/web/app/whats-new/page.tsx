'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TOUCHPOINT_REGISTRY, currentVersion } from '@contentbuilder/shared';
import { ReleaseList, TOUCHPOINT_ORDER } from '../components/PromptUpdates';

/**
 * WHAT THE AI LEARNED — the prompts' changelog as a timeline rail (batch 7).
 *
 * Six models write everything this app produces, and each one has been
 * revised. Each touchpoint is one node on the rail: its plain-words role, its
 * current version, and its releases newest-first. Entirely static — the
 * registry lives in shared and version numbers cannot drift from the prompts
 * (a test hashes every prompt and fails when text changes without a bump).
 */
export default function WhatsNewPage() {
  const [only, setOnly] = useState<'all' | 'brand' | 'post'>('all');
  const shown = TOUCHPOINT_ORDER.filter(
    (id) => only === 'all' || TOUCHPOINT_REGISTRY[id].affects === only,
  );

  return (
    <div className="mo-page mo-kit mo-log" style={{ margin: '0 auto' }}>
      <p className="mo-crumb"><Link href="/">Home</Link> / AI learnings</p>
      <div className="lh">
        <h1 style={{ fontFamily: 'var(--mo-disp)', fontWeight: 600, fontSize: 27, letterSpacing: '-0.03em', margin: 0 }}>
          The AI got better while you worked.
        </h1>
        <p>
          Every part of this app that writes or designs something runs a prompt, and those prompts get
          revised. Your brand kits and posts carry the version that made them — when a change would
          improve something you already have, the app says so where you can see it.
        </p>
      </div>
      <div className="filters" role="tablist" aria-label="Filter by what it affects">
        {(
          [
            ['all', 'Everything'],
            ['brand', 'Your brands'],
            ['post', 'Your posts'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={only === v} className={only === v ? 'on' : undefined} onClick={() => setOnly(v)}>
            {label}
          </button>
        ))}
      </div>

      {shown.map((id) => {
        const t = TOUCHPOINT_REGISTRY[id];
        return (
          <div className="mo-lrow" key={id}>
            <span className="dot">v{currentVersion(id)}</span>
            <span className="rl" aria-hidden />
            <section className="mo-lcard">
              <div className="t">
                {t.label}
                <span className="vtag">v{currentVersion(id)}</span>
                <span className="aff">{t.affects === 'brand' ? 'lives on a brand kit' : 'lives on a post'}</span>
              </div>
              <p className="role">{t.role}</p>
              {/* Newest first: on a changelog you scan for what is new. */}
              <div className="pu-rel">
                <ReleaseList releases={[...t.releases].reverse()} />
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
