'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Format } from '@contentbuilder/shared';
import {
  getBoard,
  setProjectStage,
  type BoardCard,
  type BoardResponse,
} from '../lib/api';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../lib/render/SlideFrame';
import { toRenderKit } from '../../lib/render/projectRender';
import { OverflowMenu } from './OverflowMenu';
import { toast } from './Toast';

type Stage = BoardCard['stage'];

const COLUMNS: Array<{ key: Stage; label: string; empty: string }> = [
  { key: 'idea', label: 'Ideas', empty: 'Park a prompt here and compose it when you’re ready.' },
  { key: 'drafting', label: 'Drafting', empty: 'Posts being written and arranged.' },
  { key: 'ready', label: 'Ready', empty: 'On-brand and waiting to go out.' },
  { key: 'shipped', label: 'Shipped', empty: 'Exported and posted work lands here.' },
];

function ago(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * THE DESK — the home screen as a workspace rather than a directory.
 *
 * Every post across every brand, in the stage it actually sits at, so the
 * question "what should I do next?" is answered by looking. Cards move by an
 * explicit menu (keyboard-accessible and touch-friendly); export moves a post to
 * Shipped on its own, and "posted" stays a manual tick because the app cannot
 * see Instagram.
 */
export default function Desk() {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await getBoard());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byStage = useMemo(() => {
    const m: Record<Stage, BoardCard[]> = { idea: [], drafting: [], ready: [], shipped: [] };
    for (const c of board?.cards ?? []) m[c.stage]?.push(c);
    return m;
  }, [board]);

  const brandName = useCallback(
    (id: string) => board?.businesses.find((b) => b._id === id)?.name ?? 'Brand',
    [board],
  );

  const move = useCallback(
    async (card: BoardCard, stage: Stage, posted?: boolean) => {
      setMoving(card._id);
      // Optimistic: the board is a working surface, so it should feel immediate.
      setBoard((b) =>
        b
          ? {
              ...b,
              cards: b.cards.map((c) =>
                c._id === card._id
                  ? { ...c, stage, postedAt: posted ? new Date().toISOString() : stage === 'shipped' ? c.postedAt : null }
                  : c,
              ),
            }
          : b,
      );
      try {
        await setProjectStage(card._id, stage, posted);
      } catch {
        toast('Could not move that post', 'error');
        void load();
      } finally {
        setMoving(null);
      }
    },
    [load],
  );

  if (error) return <div className="error-box">{error}</div>;
  if (!board) return <p className="muted">Loading the desk…</p>;

  const needsYou = byStage.idea.length + byStage.drafting.length;

  return (
    <div className="desk">
      <header className="desk-head">
        <div>
          <p className="eyebrow">Studio</p>
          <h1>
            {needsYou > 0 ? (
              <>
                {needsYou} post{needsYou === 1 ? '' : 's'} need{needsYou === 1 ? 's' : ''} you
                <span className="it">.</span>
              </>
            ) : (
              <>
                All caught up<span className="it">.</span>
              </>
            )}
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn" href="/brands">
            Brands
          </Link>
          <Link className="btn primary" href="/projects/new">
            ✦ New post
          </Link>
        </div>
      </header>

      <div className="desk-board">
        {COLUMNS.map((col) => {
          const cards = byStage[col.key];
          return (
            <section className="desk-col" key={col.key} aria-label={col.label}>
              <h2>
                {col.label}
                <em>{cards.length}</em>
              </h2>
              {cards.length === 0 ? (
                <p className="desk-empty">{col.empty}</p>
              ) : (
                cards.map((c) => {
                  const kit = board.kits[c.businessId];
                  const isIdea = c.stage === 'idea' || !c.authored;
                  return (
                    <article className={`dcard${moving === c._id ? ' busy' : ''}`} key={c._id}>
                      <div className="dcard-thumb">
                        {c.authored && kit ? (
                          <ScaledSlide format={c.format as Format} displayWidth={44}>
                            <SlideRenderer
                              slide={{ authored: c.authored }}
                              brandKit={toRenderKit(kit)}
                              format={c.format as Format}
                              forExport
                            />
                          </ScaledSlide>
                        ) : (
                          <span className="dcard-idea" aria-hidden>
                            ✎
                          </span>
                        )}
                      </div>
                      <Link
                        className="dcard-t"
                        href={isIdea ? `/projects/new?ideaFrom=${c._id}` : `/projects/${c._id}/review`}
                      >
                        {c.title}
                      </Link>
                      <div className="dcard-s">
                        <span className="dcard-brand">{brandName(c.businessId)}</span>
                        <span className="dcard-sep">·</span>
                        {c.postedAt ? (
                          <span style={{ color: 'var(--accent)' }}>✓ posted</span>
                        ) : c.exportedAt ? (
                          <span>exported {ago(c.exportedAt)}</span>
                        ) : isIdea ? (
                          <span>idea</span>
                        ) : (
                          <span>
                            {c.slideCount} slide{c.slideCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <div className="dcard-menu">
                        <OverflowMenu
                          items={[
                            ...COLUMNS.filter((x) => x.key !== c.stage).map((x) => ({
                              label: `Move to ${x.label}`,
                              onClick: () => void move(c, x.key),
                            })),
                            ...(c.stage === 'shipped'
                              ? [
                                  {
                                    label: c.postedAt ? 'Un-mark as posted' : 'Mark as posted',
                                    onClick: () => void move(c, 'shipped', !c.postedAt),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </div>
                    </article>
                  );
                })
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
