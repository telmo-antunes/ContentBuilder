'use client';

import { useState } from 'react';
import { TOUCHPOINT_REGISTRY, currentVersion } from '@contentbuilder/shared';
import { ReleaseList, TOUCHPOINT_ORDER } from '../components/PromptUpdates';

/**
 * WHAT THE AI LEARNED — the changelog for the prompts themselves.
 *
 * Six models write everything this app produces, and each one has been revised.
 * Without this page a version number on a brand kit is a bare integer; with it,
 * "your recipe was designed by v2" is a paragraph you can read and judge.
 *
 * It is entirely static — the registry it renders lives in shared and is
 * imported straight into the bundle, so there is no endpoint and nothing to
 * fetch. The version numbers cannot drift from the prompts either: a test hashes
 * every prompt and fails when its text changes without a bump.
 */
export default function WhatsNewPage() {
  const [only, setOnly] = useState<'all' | 'brand' | 'post'>('all');
  const shown = TOUCHPOINT_ORDER.filter(
    (id) => only === 'all' || TOUCHPOINT_REGISTRY[id].affects === only,
  );

  return (
    <div className="wn">
        <header className="wn-head">
          <h1>What the AI learned</h1>
          <p>
            Every part of this app that writes or designs something runs a prompt, and those prompts
            get revised. Each revision is numbered here, with what actually changed about the result.
            Your brand kits and posts carry the version that made them — when one of these changes
            would improve something you already have, the app says so where you can see it.
          </p>
          <div className="wn-filter" role="tablist" aria-label="Filter by what it affects">
            {(
              [
                ['all', 'Everything'],
                ['brand', 'Your brands'],
                ['post', 'Your posts'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={only === v}
                className={`btn sm${only === v ? ' primary' : ' ghost'}`}
                onClick={() => setOnly(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {shown.map((id) => {
          const t = TOUCHPOINT_REGISTRY[id];
          return (
            <section key={id} className="wn-tp">
              <div className="wn-tp-head">
                <h2>{t.label}</h2>
                <span className="pu-vers">v{currentVersion(id)}</span>
                <span className="wn-affects">
                  {t.affects === 'brand' ? 'lives on a brand kit' : 'lives on a post'}
                </span>
              </div>
              <p className="wn-role">{t.role}</p>
              {/* Newest first here: on a changelog you scan for what is new. */}
              <ReleaseList releases={[...t.releases].reverse()} />
            </section>
          );
        })}
    </div>
  );
}
