'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { BrandKit, Format } from '@contentbuilder/shared';
import {
  deleteBusiness,
  getBoard,
  listBusinesses,
  setProjectStage,
  updateBusiness,
  type BoardCard,
  type BoardResponse,
  type BusinessSummary,
} from '../lib/api';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../lib/render/SlideFrame';
import { toRenderKit } from '../../lib/render/projectRender';
import { confirm } from './ConfirmDialog';
import { ErrorState } from './ErrorState';
import { summaryStep } from '../../lib/onboarding';
import { Icon } from './Icon';
import { OverflowMenu } from './OverflowMenu';
import { Skeleton } from './Skeleton';
import { toast } from './Toast';

type Stage = BoardCard['stage'];

const COLUMNS: Array<{ key: Stage; label: string; empty: string }> = [
  { key: 'idea', label: 'Ideas', empty: 'Park a prompt here and compose it when you’re ready.' },
  { key: 'drafting', label: 'Drafting', empty: 'Posts being written and arranged.' },
  { key: 'ready', label: 'Ready', empty: 'On-brand and waiting to go out.' },
  { key: 'shipped', label: 'Shipped', empty: 'Exported and posted work lands here.' },
];

/** Stage → segment/dot colour, light-to-dark along the pipeline. */
const STAGE_COLOR: Record<Stage, string> = {
  idea: '#c9cdf9',
  drafting: '#9b9bf5',
  ready: 'var(--mo-indigo)',
  shipped: 'var(--mo-ink)',
};

// The desk nags only when waiting has a cost. Fresh drafts and just-parked
// ideas are healthy; these are the thresholds where they stop being.
const DRAFT_COLD_DAYS = 3;
const IDEA_STALE_DAYS = 7;
const BRAND_QUIET_DAYS = 7;

function daysSince(iso?: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function ago(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** One thing waiting on the owner, with the verb that clears it. */
interface NeedRow {
  card: BoardCard;
  kind: 'ship' | 'cold' | 'stale';
}

const NEED_ORDER: NeedRow['kind'][] = ['ship', 'cold', 'stale'];

function deriveNeeds(cards: BoardCard[]): NeedRow[] {
  const rows: NeedRow[] = [];
  for (const c of cards) {
    if (c.stage === 'ready' && c.exportedAt && !c.postedAt) rows.push({ card: c, kind: 'ship' });
    else if (c.stage === 'drafting' && daysSince(c.updatedAt) >= DRAFT_COLD_DAYS)
      rows.push({ card: c, kind: 'cold' });
    else if (c.stage === 'idea' && daysSince(c.updatedAt) >= IDEA_STALE_DAYS)
      rows.push({ card: c, kind: 'stale' });
  }
  return rows.sort((a, b) => NEED_ORDER.indexOf(a.kind) - NEED_ORDER.indexOf(b.kind));
}

/** A 44px live render of slide 1, or the pencil sketch for unwritten ideas. */
function Thumb({ card, kit, size = 44 }: { card: BoardCard; kit?: BrandKit; size?: number }) {
  if (card.authored && kit) {
    return (
      <span className="mo-thumb" style={{ width: size, height: size }}>
        <ScaledSlide format={card.format as Format} displayWidth={size}>
          <SlideRenderer
            slide={{ authored: card.authored }}
            brandKit={toRenderKit(kit)}
            format={card.format as Format}
            forExport
          />
        </ScaledSlide>
      </span>
    );
  }
  return (
    <span className="mo-sketch" style={{ width: size, height: size }} aria-hidden>
      <Icon name="edit" size={14} />
    </span>
  );
}

function DeskSkeleton() {
  return (
    <div className="mo-page" role="status" aria-label="Loading the desk">
      <div className="mo-greet">
        <div>
          <Skeleton shape="line" w={120} h={10} />
          <Skeleton shape="block" w={420} h={38} style={{ marginTop: 14 }} />
        </div>
        <Skeleton shape="block" w={230} h={34} />
      </div>
      <div className="mo-bento">
        <div className="mo-tile mo-t-today"><Skeleton shape="block" h={220} /></div>
        <div className="mo-tile mo-t-pipe"><Skeleton shape="block" h={220} /></div>
        <div className="mo-tile mo-t-new"><Skeleton shape="block" h={130} /></div>
        <div className="mo-tile mo-t-work"><Skeleton shape="block" h={130} /></div>
      </div>
    </div>
  );
}

/**
 * THE DESK — Momentum: the home is a bento of answers, not a wall of cards.
 * One tile per question: what needs me (with the verb that clears each row),
 * how the pipeline is flowing (the four-column board one toggle away), start
 * something, the latest renders, and each brand's health. The header frames
 * the day as a progress bar that fills as the needs-you list empties.
 */
export default function Desk() {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  // The momentum bar animates from 0 to today's value after first paint.
  const [barMounted, setBarMounted] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, biz] = await Promise.all([getBoard(), listBusinesses()]);
      setBoard(b);
      setBusinesses(biz);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (board) {
      const id = requestAnimationFrame(() => setBarMounted(true));
      return () => cancelAnimationFrame(id);
    }
  }, [board]);

  const reloadBrands = useCallback(async () => {
    try {
      setBusinesses(await listBusinesses());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, []);

  const byStage = useMemo(() => {
    const m: Record<Stage, BoardCard[]> = { idea: [], drafting: [], ready: [], shipped: [] };
    for (const c of board?.cards ?? []) m[c.stage]?.push(c);
    return m;
  }, [board]);

  const needs = useMemo(() => deriveNeeds(board?.cards ?? []), [board]);

  const brandName = useCallback(
    (id: string) => board?.businesses.find((b) => b._id === id)?.name ?? 'Brand',
    [board],
  );

  const move = useCallback(
    async (card: BoardCard, stage: Stage, posted?: boolean) => {
      setMoving(card._id);
      // Optimistic: the desk is a working surface, so it should feel immediate.
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

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!board || !businesses) return <DeskSkeleton />;

  const active = byStage.idea.length + byStage.drafting.length + byStage.ready.length;
  // Momentum = the share of in-flight work NOT waiting on you. Clearing the
  // needs-you list drives it to 100 — that is the whole contract of the bar.
  const momentum = active === 0 ? 100 : Math.round(100 * (1 - needs.length / active));
  const shippedThisWeek = byStage.shipped.filter(
    (c) => daysSince(c.postedAt ?? c.exportedAt) <= 7,
  ).length;

  const shipCount = needs.filter((n) => n.kind === 'ship').length;
  const coldCount = needs.filter((n) => n.kind === 'cold').length;
  const staleCount = needs.filter((n) => n.kind === 'stale').length;
  const noteParts = [
    shipCount > 0 && `${shipCount} export${shipCount === 1 ? '' : 's'} ready to ship`,
    coldCount > 0 && `${coldCount} draft${coldCount === 1 ? '' : 's'} going cold`,
    staleCount > 0 && `${staleCount} idea${staleCount === 1 ? '' : 's'} going stale`,
  ].filter(Boolean);

  const latest = board.cards
    .filter((c) => c.authored)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const composable = businesses.filter((b) => b.hasApprovedKit);
  const inPipeByBrand = new Map<string, number>();
  const lastShipByBrand = new Map<string, string>();
  for (const c of board.cards) {
    if (c.stage !== 'shipped') {
      inPipeByBrand.set(c.businessId, (inPipeByBrand.get(c.businessId) ?? 0) + 1);
    }
    const when = c.postedAt ?? c.exportedAt;
    if (when && when > (lastShipByBrand.get(c.businessId) ?? '')) {
      lastShipByBrand.set(c.businessId, when);
    }
  }

  return (
    <div className="mo-page">
      <header className="mo-greet mo-rise">
        <div>
          <p className="eyebrow" style={{ color: 'var(--mo-faint)' }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1>
            {needs.length > 0 ? (
              <>
                {greeting()} — <span className="g">{needs.length === 1 ? 'one thing' : `${needs.length} things`}</span> and
                you&rsquo;re clear.
              </>
            ) : (
              <>
                {greeting()} — <span className="g">all clear</span>.
              </>
            )}
          </h1>
          <p className="note">
            {noteParts.length > 0 ? `${noteParts.join(', ')}.` : 'Nothing is waiting on you.'}
          </p>
        </div>
        <div className="mo-prog" aria-label={`Today's momentum: ${momentum}%`}>
          <div className="lbl">
            <span>Today&rsquo;s momentum</span>
            <b>{momentum}%</b>
          </div>
          <div className="mo-pbar">
            <i style={{ width: barMounted ? `${momentum}%` : 0 }} />
          </div>
        </div>
      </header>

      {businesses.length === 0 ? (
        <div className="mo-tile mo-rise" style={{ maxWidth: 520 }}>
          <div className="mo-th"><span className="t">Welcome</span></div>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--mo-muted)' }}>
            Setting up a brand takes four steps: name it, read its website, pick a design
            direction, and write the first post. It walks you through all four.
          </p>
          <Link className="mo-go" href="/start" style={{ display: 'inline-block' }}>
            ＋ Set up your first brand
          </Link>
        </div>
      ) : (
        <div className="mo-bento">
          {/* ── Needs you: each row ends in the verb that clears it ── */}
          <section className="mo-tile mo-t-today mo-rise" aria-label="Needs you">
            <div className="mo-th">
              <span className="t">Needs you</span>
              <span className="b">{needs.length}</span>
            </div>
            {needs.length === 0 ? (
              <div className="mo-clear">
                <span className="tick"><Icon name="check" size={13} /></span>
                All clear — nothing on the desk is waiting on you.
              </div>
            ) : (
              needs.map(({ card, kind }) => {
                const kit = board.kits[card.businessId];
                const isIdea = card.stage === 'idea' || !card.authored;
                const openHref = isIdea ? `/projects/new?ideaFrom=${card._id}` : `/projects/${card._id}/review`;
                return (
                  <div className="mo-task" key={card._id}>
                    <Thumb card={card} kit={kit} />
                    <div>
                      <div className="tt">
                        <Link href={openHref}>{card.title}</Link>
                        {kind === 'ship' && <span className="mo-why info">Ready to ship</span>}
                        {kind === 'cold' && <span className="mo-why warn"><i />Going cold</span>}
                        {kind === 'stale' && <span className="mo-why warn"><i />Idea waiting</span>}
                      </div>
                      <div className="tm">
                        {brandName(card.businessId)}
                        {kind === 'ship' && ` · exported ${ago(card.exportedAt)} ago, never posted`}
                        {kind === 'cold' && ` · ${card.type} · untouched for ${ago(card.updatedAt)}`}
                        {kind === 'stale' && ` · idea parked ${ago(card.updatedAt)} ago`}
                      </div>
                    </div>
                    {kind === 'ship' ? (
                      <button
                        className="mo-go"
                        disabled={moving === card._id}
                        onClick={() => void move(card, 'shipped', true)}
                      >
                        {moving === card._id ? 'Saving…' : 'Mark posted'}
                      </button>
                    ) : (
                      <Link className={`mo-go${kind === 'cold' ? ' soft' : ''}`} href={openHref}>
                        {kind === 'cold' ? 'Resume' : 'Compose'}
                      </Link>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* ── Pipeline: counts + flags; the classic board one toggle away ── */}
          <section className="mo-tile mo-t-pipe mo-rise" aria-label="Pipeline">
            <div className="mo-th">
              <span className="t">Pipeline</span>
              <span className="b">{board.cards.length} post{board.cards.length === 1 ? '' : 's'}</span>
              <button className="r" onClick={() => setBoardOpen((v) => !v)}>
                {boardOpen ? 'Hide board ↑' : 'Board view →'}
              </button>
            </div>
            <div className="mo-seg" aria-hidden>
              {COLUMNS.map((col) => (
                <i key={col.key} style={{ flex: Math.max(byStage[col.key].length, 0.4) }} />
              ))}
            </div>
            <div>
              {COLUMNS.map((col) => {
                const n = byStage[col.key].length;
                const flag =
                  col.key === 'idea' && staleCount > 0 ? (
                    <span className="fl">{staleCount} stale</span>
                  ) : col.key === 'drafting' && coldCount > 0 ? (
                    <span className="fl">{coldCount} going cold</span>
                  ) : col.key === 'ready' && shipCount > 0 ? (
                    <span className="fl ok">ship window open</span>
                  ) : col.key === 'shipped' && shippedThisWeek > 0 ? (
                    <span className="fl ok">{shippedThisWeek} this week</span>
                  ) : (
                    <span className="fl dim">—</span>
                  );
                return (
                  <div className="mo-prow" key={col.key}>
                    <span className="dot" style={{ background: STAGE_COLOR[col.key] }} />
                    <span className="nm">{col.label}</span>
                    {flag}
                    <span className="ct">{n}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── The classic four columns, when asked for ── */}
          {boardOpen && (
            <section className="mo-board mo-rise" aria-label="Board">
              {COLUMNS.map((col) => {
                const cards = byStage[col.key];
                return (
                  <div className="mo-col" key={col.key}>
                    <h2>
                      {col.label}
                      <em>{cards.length}</em>
                    </h2>
                    {cards.length === 0 ? (
                      <p className="empty-note">{col.empty}</p>
                    ) : (
                      cards.map((c) => {
                        const isIdea = c.stage === 'idea' || !c.authored;
                        return (
                          <article className={`mo-dcard${moving === c._id ? ' busy' : ''}`} key={c._id}>
                            <span className="thumb">
                              <Thumb card={c} kit={board.kits[c.businessId]} />
                            </span>
                            <Link
                              className="t"
                              href={isIdea ? `/projects/new?ideaFrom=${c._id}` : `/projects/${c._id}/review`}
                            >
                              {c.title}
                            </Link>
                            <div className="s">
                              {brandName(c.businessId)} ·{' '}
                              {c.postedAt
                                ? 'posted'
                                : c.exportedAt
                                  ? `exported ${ago(c.exportedAt)} ago`
                                  : isIdea
                                    ? 'idea'
                                    : `${c.slideCount} slide${c.slideCount === 1 ? '' : 's'}`}
                            </div>
                            <div className="menu">
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
                  </div>
                );
              })}
            </section>
          )}

          {/* ── Start something: the composer, pre-loaded with a brand ── */}
          <section className="mo-tile mo-t-new mo-rise" aria-label="Start something">
            <div className="mo-th"><span className="t">Start something</span></div>
            <p className="big">What are we making today?</p>
            <p className="sub">Pick a brand — the composer opens with its recipe loaded.</p>
            <div className="mo-qb">
              <Link className="prim" href="/projects/new">
                <Icon name="sparkle" size={13} /> Blank brief
              </Link>
              {composable.map((b) => (
                <Link key={b._id} href={`/projects/new?businessId=${b._id}`}>
                  <span
                    className="k"
                    style={{
                      background: `linear-gradient(135deg, ${b.kit?.colors.background ?? 'var(--mo-line-strong)'} 60%, ${b.kit?.colors.primary ?? 'var(--mo-faint)'})`,
                    }}
                  />
                  For {b.name.split(' ')[0]}
                </Link>
              ))}
            </div>
          </section>

          {/* ── Latest work: renders drifting by; hover pauses ── */}
          {latest.length > 0 && (
            <section className="mo-tile mo-t-work mo-rise" aria-label="Latest work">
              <div className="mo-th">
                <span className="t">Latest work</span>
                <span className="b">rendered live</span>
              </div>
              <div className="mo-mq">
                {/* The strip is doubled so the loop is seamless; aria-hidden on
                    the copy keeps screen readers to one pass. */}
                <div className="in">
                  {[false, true].map((copy) => (
                    <div
                      key={copy ? 'copy' : 'first'}
                      aria-hidden={copy || undefined}
                      style={{ display: 'flex', gap: 12 }}
                    >
                      {latest.map((c) => (
                        <Link
                          className="mo-wk"
                          key={`${c._id}${copy ? '-b' : ''}`}
                          href={`/projects/${c._id}/review`}
                          tabIndex={copy ? -1 : undefined}
                        >
                          <span className="art" style={{ display: 'block' }}>
                            <Thumb card={c} kit={board.kits[c.businessId]} size={96} />
                          </span>
                          <span className="cap">
                            {c.title} · {brandName(c.businessId)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Brand tiles: each wears its own kit ── */}
          {businesses.map((b) => (
            <BrandTile
              key={b._id}
              biz={b}
              inPipe={inPipeByBrand.get(b._id) ?? 0}
              lastShip={lastShipByBrand.get(b._id)}
              onChanged={() => void reloadBrands()}
            />
          ))}
          <Link className="mo-tile mo-t-newbrand mo-rise" href="/start">
            <span>
              <span className="plus">＋</span>
              New brand
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

/** One brand's tile: kit-gradient header, cadence state, counts, and doors. */
function BrandTile({
  biz,
  inPipe,
  lastShip,
  onChanged,
}: {
  biz: BusinessSummary;
  inPipe: number;
  lastShip?: string;
  onChanged: () => void;
}) {
  const step = summaryStep(biz);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(biz.name);
  const [websiteUrl, setWebsiteUrl] = useState(biz.websiteUrl ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await updateBusiness(biz._id, { name: name.trim(), websiteUrl: websiteUrl.trim() });
      setEditing(false);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: 'Delete brand?',
        message: `Delete "${biz.name}"? This also deletes its brand kits and projects.`,
        confirmText: 'Delete',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await deleteBusiness(biz._id);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      setBusy(false);
    }
  };

  const colors = biz.kit?.colors;
  const headBg = colors
    ? `linear-gradient(120deg, ${colors.background} 45%, ${colors.secondary} 70%, ${colors.primary})`
    : 'linear-gradient(120deg, var(--mo-faint), var(--mo-line-strong))';
  const quietDays = daysSince(lastShip);
  const category = biz.profile?.category;

  return (
    <section className="mo-tile mo-t-brand mo-rise" aria-label={biz.name}>
      <div className="head" style={{ background: headBg }}>
        <span className="bn">
          <Link href={`/businesses/${biz._id}`}>{biz.name}</Link>
        </span>
        <span className="menu">
          <OverflowMenu
            items={[
              { label: 'Edit details', onClick: () => setEditing(true), disabled: busy },
              { label: busy ? 'Deleting…' : 'Delete brand', onClick: () => void remove(), danger: true, disabled: busy },
            ]}
          />
        </span>
      </div>
      {editing ? (
        <div className="edit">
          <div>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label>Website</label>
            <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button className="mo-go" onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="mo-go soft" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="body">
          <div className="meta">
            {category && <span>{category}</span>}
            {!lastShip ? (
              <span className="mo-st dim"><i />No posts shipped yet</span>
            ) : quietDays >= BRAND_QUIET_DAYS ? (
              <span className="mo-st w"><i />Quiet {Math.floor(quietDays)} days</span>
            ) : (
              <span className="mo-st"><i />On cadence</span>
            )}
          </div>
          <div className="nums">
            <div>
              <div className="n">{biz.projectCount}</div>
              <div className="l">post{biz.projectCount === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="n">{inPipe}</div>
              <div className="l">in pipeline</div>
            </div>
            <div>
              <div className="n">{step === 'done' ? '✓' : '…'}</div>
              <div className="l">{step === 'done' ? 'kit approved' : 'setup unfinished'}</div>
            </div>
          </div>
          {step !== 'done' ? (
            <Link className="cta" href={`/start?b=${biz._id}`}>
              {step === 'post' ? 'Write the first post →' : 'Finish setup →'}
            </Link>
          ) : (
            <Link className="cta" href={`/businesses/${biz._id}`}>
              Open brand →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
