'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Format } from '@contentbuilder/shared';
import {
  createBusiness,
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
import DeckScroller from './DeckScroller';
import { ErrorState } from './ErrorState';
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

const KIT_ROLES = ['background', 'secondary', 'primary', 'accent', 'text'] as const;

function ago(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The board while it loads: four columns with a couple of ghost cards each. */
function DeskSkeleton() {
  return (
    <div className="desk" role="status" aria-label="Loading the desk">
      <header className="desk-head">
        <div>
          <Skeleton shape="line" w={64} h={10} />
          <Skeleton shape="block" w={300} h={38} style={{ marginTop: 14 }} />
        </div>
        <Skeleton shape="block" w={118} h={36} />
      </header>
      <div className="desk-board">
        {COLUMNS.map((c) => (
          <div className="desk-col" key={c.key}>
            <Skeleton shape="line" w={80} h={10} style={{ marginBottom: 14 }} />
            <Skeleton shape="block" h={71} style={{ marginBottom: 8 }} />
            <Skeleton shape="block" h={71} />
          </div>
        ))}
      </div>
      <div className="sec-h" style={{ marginTop: 36 }}>
        <Skeleton shape="line" w={72} h={16} />
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'nowrap', overflow: 'hidden' }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} shape="block" w={280} h={129} style={{ flex: '0 0 auto' }} />
        ))}
      </div>
    </div>
  );
}

/**
 * THE DESK — the one home screen: every post across every brand in the stage it
 * actually sits at, with the brand directory as a compact rail underneath.
 *
 * Cards move by an explicit menu (keyboard-accessible and touch-friendly);
 * export moves a post to Shipped on its own, and "posted" stays a manual tick
 * because the app cannot see Instagram. The brand rail carries each brand's
 * kit colours and status, links into the brand room, and adds new brands —
 * the old /brands page folded into the workspace.
 */
export default function Desk() {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // The board is ONE call; the brand directory is one more (it knows about
      // brands with zero posts and draft kits, which the board can't).
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

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!board || !businesses) return <DeskSkeleton />;

  const needsYou = byStage.idea.length + byStage.drafting.length;
  const approvedKits = businesses.filter((b) => b.hasApprovedKit).length;
  const totalPosts = businesses.reduce((n, b) => n + (b.projectCount ?? 0), 0);

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
          <Link className="btn primary" href="/projects/new">
            <Icon name="sparkle" /> New post
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
                            <Icon name="edit" size={14} />
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
                          <span style={{ color: 'var(--accent)' }}>
                            <Icon name="check" size={11} /> posted
                          </span>
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

      {/* ── The brand rail — the directory, folded into the workspace ── */}
      <section aria-label="Brands">
        <div className="sec-h" style={{ marginTop: 36 }}>
          <h2>Brands</h2>
          {businesses.length > 0 && (
            <span className="aside">
              {businesses.length} brand{businesses.length === 1 ? '' : 's'} · {totalPosts} post
              {totalPosts === 1 ? '' : 's'} · {approvedKits} approved kit{approvedKits === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {adding && (
          <AddBusiness
            onCreated={() => {
              setAdding(false);
              void reloadBrands();
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {businesses.length === 0 && !adding ? (
          <div className="empty">
            <strong>Welcome.</strong>
            <p className="muted" style={{ margin: '6px 0 12px' }}>
              Add your first brand — derive its kit from a website (or enter one manually), design its
              recipe, then compose on-brand posts with AI.
            </p>
            <button className="btn primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> New brand
            </button>
          </div>
        ) : (
          <DeckScroller className="brand-rail">
            {businesses.map((b) => (
              <BrandRailCard key={b._id} biz={b} onChanged={() => void reloadBrands()} />
            ))}
            {!adding && (
              <button type="button" className="newbrand-card" onClick={() => setAdding(true)}>
                <span>
                  <Icon name="plus" size={20} />
                  <span style={{ display: 'block', fontSize: 12.5, marginTop: 4 }}>New brand</span>
                </span>
              </button>
            )}
          </DeckScroller>
        )}
      </section>
    </div>
  );
}

function AddBusiness({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createBusiness({ name: name.trim(), websiteUrl: websiteUrl.trim() || undefined });
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <div className="section-label" style={{ marginTop: 0 }}>New brand</div>
      <div className="grid-2">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="biz-name">Business name *</label>
          <input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Apex Auto Detailing" autoFocus required />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="biz-url">Website URL (optional)</label>
          <input id="biz-url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" />
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={busy || !name.trim()} type="submit">
          {busy ? 'Adding…' : 'Add brand'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <span className="muted" style={{ fontSize: 13 }}>No website? Add it and enter a kit manually.</span>
      </div>
    </form>
  );
}

/** One brand on the rail: its kit colours, status, and door into the brand room. */
function BrandRailCard({ biz, onChanged }: { biz: BusinessSummary; onChanged: () => void }) {
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
    if (!(await confirm({
      title: 'Delete brand?',
      message: `Delete "${biz.name}"? This also deletes its brand kits and projects.`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    setBusy(true);
    try {
      await deleteBusiness(biz._id);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="brand-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Website</label>
          <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 2 }}>
          <button className="btn primary sm" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
        </div>
      </div>
    );
  }

  const category = biz.profile?.category;
  return (
    <div className="brand-card">
      <div className="bc-menu">
        <OverflowMenu
          items={[
            { label: 'Edit details', onClick: () => setEditing(true), disabled: busy },
            { label: busy ? 'Deleting…' : 'Delete brand', onClick: () => void remove(), danger: true, disabled: busy },
          ]}
        />
      </div>
      <div className="bc-fallback" aria-hidden>
        {KIT_ROLES.map((r) => (
          <span key={r} style={{ background: biz.kit?.colors[r] ?? 'var(--panel-2)' }} />
        ))}
      </div>
      <div className="bc-meta">
        <div className="bc-top">
          <div className="nm"><Link href={`/businesses/${biz._id}`}>{biz.name}</Link></div>
          {category && <div className="cat">{category}</div>}
        </div>
        <div className="bc-foot" style={{ marginTop: 'auto' }}>
          {biz.hasApprovedKit ? (
            <span className="badge ok"><span className="dot" /> Approved</span>
          ) : biz.hasDraftKit ? (
            <span className="badge warn"><span className="dot" /> Draft kit</span>
          ) : (
            <span className="badge"><span className="dot" /> No kit</span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            {biz.projectCount} post{biz.projectCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}
