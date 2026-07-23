'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Slide, Format } from '@contentbuilder/shared';
import {
  listBusinesses,
  createBusiness,
  updateBusiness,
  deleteBusiness,
  listProjects,
  getProject,
  type BusinessSummary,
  type ProjectDetail,
} from './lib/api';
import { confirm } from './components/ConfirmDialog';
import { OverflowMenu } from './components/OverflowMenu';
import { SlideRenderer } from '../lib/render/SlideRenderer';
import { ScaledSlide } from '../lib/render/SlideFrame';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../lib/render/projectRender';

const ROLES = ['background', 'secondary', 'primary', 'accent', 'text'] as const;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Render one real slide at a small size (the live post thumbnail). */
function SlideThumb({ detail, slide, width }: { detail: ProjectDetail; slide: Slide; width: number }) {
  return (
    <ScaledSlide format={detail.format as Format} displayWidth={width}>
      <SlideRenderer
        slide={slide}
        brandKit={toRenderKit(detail.brandKit)}
        format={detail.format as Format}
        image={resolveSlideImage(slide, detail.media)}
        imageLayout={resolveImageLayout(slide, detail.media)}
        theme={slide.overrides?.theme ?? detail.settings?.theme ?? 'editorial'}
        forExport
      />
    </ScaledSlide>
  );
}

export default function DashboardPage() {
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, ProjectDetail | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setBusinesses(await listBusinesses());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Front each brand with its actual latest post (and drive the Continue rail).
  useEffect(() => {
    if (!businesses) return;
    let alive = true;
    for (const b of businesses) {
      if (!b.projectCount) {
        setPreviews((p) => ({ ...p, [b._id]: null }));
        continue;
      }
      (async () => {
        try {
          const projs = await listProjects(b._id);
          const newest = [...projs].sort(
            (x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
          )[0];
          const detail = newest ? await getProject(newest._id) : null;
          if (alive) setPreviews((p) => ({ ...p, [b._id]: detail }));
        } catch {
          if (alive) setPreviews((p) => ({ ...p, [b._id]: null }));
        }
      })();
    }
    return () => {
      alive = false;
    };
  }, [businesses]);

  const stats = useMemo(() => {
    const list = businesses ?? [];
    return {
      brands: list.length,
      projects: list.reduce((n, b) => n + (b.projectCount ?? 0), 0),
      approved: list.filter((b) => b.hasApprovedKit).length,
    };
  }, [businesses]);

  const recent = useMemo(
    () =>
      Object.values(previews)
        .filter((d): d is ProjectDetail => Boolean(d && d.slides.length))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4),
    [previews],
  );

  return (
    <div>
      <header className="dash-mast">
        <p className="eyebrow">Your studio</p>
        <h1>
          {greeting()}<span className="it">.</span>
        </h1>
        {businesses && businesses.length > 0 && (
          <div className="dash-stats">
            <div>
              <div className="n">{stats.brands}</div>
              <div className="l">Brands</div>
            </div>
            <div>
              <div className="n">{stats.projects}</div>
              <div className="l">Projects</div>
            </div>
            <div>
              <div className="n">{stats.approved}</div>
              <div className="l">Approved kits</div>
            </div>
          </div>
        )}
      </header>

      {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}

      {adding && (
        <div style={{ marginTop: 18 }}>
          <AddBusiness onCreated={() => { setAdding(false); void reload(); }} onCancel={() => setAdding(false)} onError={setError} />
        </div>
      )}

      {!businesses && !error && <p className="muted" style={{ marginTop: 20 }}>Loading…</p>}

      {businesses && businesses.length === 0 && !adding && (
        <div className="empty" style={{ marginTop: 20 }}>
          <strong>Welcome 👋</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Add your first brand — derive its kit from a website (or enter one manually), design its
            recipe, then compose on-brand posts with AI.
          </p>
          <button className="btn primary" onClick={() => setAdding(true)}>+ New brand</button>
        </div>
      )}

      {businesses && businesses.length > 0 && (
        <>
          <div className="sec-h" style={{ marginTop: 40 }}>
            <h2>Your brands</h2>
          </div>
          <div className="brand-grid">
            {businesses.map((b) => (
              <BrandCard key={b._id} biz={b} preview={previews[b._id]} onChanged={reload} onError={setError} />
            ))}
            {!adding && (
              <div className="newbrand-card" onClick={() => setAdding(true)}>
                <div>
                  <div className="pico">+</div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>New brand</div>
                </div>
              </div>
            )}
          </div>

          {recent.length > 0 && (
            <>
              <div className="sec-h" style={{ marginTop: 40 }}>
                <h2>Continue</h2>
              </div>
              <div className="dash-recent">
                {recent.map((d) => {
                  const ordered = [...d.slides].sort((a, b) => a.order - b.order);
                  const authored = ordered.every((s) => s.authored?.html);
                  return (
                    <Link key={d._id} href={`/projects/${d._id}/review`} className="rcard">
                      <div className="rc-strip">
                        {ordered.slice(0, 2).map((s) => (
                          <div className="rc-frame" key={s.id}>
                            <SlideThumb detail={d} slide={s} width={d.format === '1080x1920' ? 56 : 98} />
                          </div>
                        ))}
                      </div>
                      <div className="rc-cap">
                        <div className="t">{d.title}</div>
                        <div className="s">
                          <span className="st" style={{ color: authored ? 'var(--accent)' : 'var(--accent-2)' }}>
                            {authored ? 'On-brand' : 'Draft'}
                          </span>
                          <span style={{ color: 'var(--faint)' }}>·</span>
                          {ordered.length} slides
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function AddBusiness({
  onCreated,
  onCancel,
  onError,
}: {
  onCreated: () => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
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
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
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

function BrandCard({
  biz,
  preview,
  onChanged,
  onError,
}: {
  biz: BusinessSummary;
  preview: ProjectDetail | null | undefined;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
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
      onError(err instanceof Error ? err.message : String(err));
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
      onError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="brand-card" style={{ flexDirection: 'column', gap: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Website</label>
          <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <button className="btn primary sm" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
        </div>
      </div>
    );
  }

  const category = biz.profile?.category;
  const cover = preview ? [...preview.slides].sort((a, b) => a.order - b.order)[0] : undefined;
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
      {preview && cover ? (
        <div className="bc-thumb">
          <SlideThumb detail={preview} slide={cover} width={preview.format === '1080x1920' ? 82 : 104} />
        </div>
      ) : (
        <div className="bc-fallback">
          {ROLES.map((r) => (
            <span key={r} style={{ background: biz.kit?.colors[r] ?? 'var(--panel-2)' }} />
          ))}
        </div>
      )}
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
            {biz.projectCount} project{biz.projectCount === 1 ? '' : 's'}
          </span>
          <Link className="btn sm ghost" href={`/businesses/${biz._id}/brand-kit`} style={{ marginLeft: 'auto' }}>
            Brand kit →
          </Link>
        </div>
      </div>
    </div>
  );
}
