'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Campaign, MediaAsset } from '@contentbuilder/shared';
import {
  getBusiness,
  getBrandKit,
  listMedia,
  deleteProject,
  createProject,
  listCampaigns,
  type BusinessDetail,
} from '../../lib/api';
import ProfileCard from '../../components/ProfileCard';
import { confirm } from '../../components/ConfirmDialog';
import { OverflowMenu } from '../../components/OverflowMenu';
import { ProjectThumb, type ProjectThumbData } from '../../components/ProjectThumb';
import { toRenderKit } from '../../../lib/render/projectRender';

export default function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [biz, setBiz] = useState<BusinessDetail | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [kitRaw, setKitRaw] = useState<Awaited<ReturnType<typeof getBrandKit>>['approved']>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'carousel' | 'story'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'rendered' | 'draft'>('all');

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [b, c, k, m] = await Promise.all([
        getBusiness(id),
        listCampaigns(id).catch(() => []),
        getBrandKit(id).catch(() => ({ draft: null, approved: null })),
        listMedia(id).catch(() => []),
      ]);
      setBiz(b);
      setCampaigns(c);
      setKitRaw(k.approved);
      setMedia(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const renderKit = useMemo(() => (kitRaw ? toRenderKit(kitRaw) : null), [kitRaw]);

  const campaignName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c._id, c.name);
    return m;
  }, [campaigns]);

  const visibleProjects = useMemo(() => {
    const list = (biz?.projects ?? []).filter(
      (p) =>
        (typeFilter === 'all' || p.type === typeFilter) &&
        (statusFilter === 'all' || (statusFilter === 'rendered' ? p.status === 'rendered' : p.status !== 'rendered')),
    );
    // Newest work first (the API already sorts, but filtering shouldn't rely on it).
    return [...list].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  }, [biz, typeFilter, statusFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const removeProject = async (pid: string, title: string) => {
    if (!(await confirm({
      title: 'Delete project?',
      message: `Delete project "${title}"?`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    try {
      await deleteProject(pid);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const duplicateProject = async (p: BusinessDetail['projects'][number]) => {
    try {
      await createProject({
        businessId: id,
        title: `${p.title} copy`,
        type: p.type,
        format: p.format,
        slides: p.slides,
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <p className="muted">
        <Link href="/">← Businesses</Link>
      </p>
      {error && <div className="error-box">{error}</div>}
      {!biz && !error && <p className="muted">Loading…</p>}

      {biz && (
        <>
          <h1>{biz.name}</h1>
          <div className="row" style={{ marginBottom: 8 }}>
            {biz.hasApprovedKit ? (
              <span className="badge ok">
                <span className="dot" /> Approved brand kit
              </span>
            ) : biz.hasDraftKit ? (
              <span className="badge warn">
                <span className="dot" /> Draft kit — needs approval
              </span>
            ) : (
              <span className="badge">
                <span className="dot" /> No brand kit
              </span>
            )}
            {biz.websiteUrl && (
              <a href={biz.websiteUrl} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 13 }}>
                {biz.websiteUrl}
              </a>
            )}
            <Link className="btn sm" href={`/businesses/${biz._id}/brand-kit`} style={{ marginLeft: 'auto' }}>
              {biz.hasApprovedKit || biz.hasDraftKit ? 'Brand kit' : 'Create brand kit'}
            </Link>
          </div>

          {!biz.hasApprovedKit && (
            <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
              <strong style={{ display: 'block', marginBottom: 8 }}>Getting started</strong>
              <ol className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                <li className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span
                    aria-hidden="true"
                    style={{ color: biz.hasProfile ? 'var(--ok)' : 'var(--muted)' }}
                  >
                    {biz.hasProfile ? '✓' : '○'}
                  </span>
                  <span style={biz.hasProfile ? { color: 'var(--muted)' } : undefined}>
                    1. Business profile{biz.hasProfile ? '' : ' — fill it in below'}
                  </span>
                </li>
                <li className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
                    ○
                  </span>
                  <span>
                    2. Approve a brand kit{' '}
                    <Link className="btn sm" href={`/businesses/${biz._id}/brand-kit`} style={{ marginLeft: 4 }}>
                      {biz.hasDraftKit ? 'Open brand kit' : 'Create brand kit'}
                    </Link>
                  </span>
                </li>
                <li className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
                    ○
                  </span>
                  <span className="muted">3. Create a project (unlocks after a kit is approved)</span>
                </li>
              </ol>
            </div>
          )}

          <ProfileCard businessId={biz._id} profile={biz.profile} onSaved={reload} />

          {biz.hasApprovedKit && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <h2 style={{ margin: 0 }}>Campaigns ({campaigns.length})</h2>
                <Link className="btn sm" href={`/campaigns/new?businessId=${biz._id}`}>
                  ✦ New campaign
                </Link>
              </div>
              {campaigns.length === 0 ? (
                <div className="empty" style={{ marginTop: 12 }}>
                  Plan a themed series of posts from a single brief.
                </div>
              ) : (
                <div className="list" style={{ marginTop: 12 }}>
                  {campaigns.map((c) => {
                    const drafted = c.concepts.filter((x) => x.projectId).length;
                    return (
                      <div className="item" key={c._id}>
                        <div className="grow">
                          <div className="title">
                            <Link href={`/campaigns/${c._id}`}>{c.name}</Link>
                          </div>
                          <div className="badges">
                            <span className="badge accent">{c.type}</span>
                            <span className="badge">{c.concepts.length} posts</span>
                            <span className={`badge ${drafted === c.concepts.length ? 'ok' : ''}`}>
                              {drafted} drafted
                            </span>
                          </div>
                        </div>
                        <Link className="btn sm" href={`/campaigns/${c._id}`}>
                          Open
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ margin: 0 }}>Projects ({biz.projects.length})</h2>
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {biz.projects.length > 3 && (
                <>
                  {(
                    [
                      ['all', 'All'],
                      ['carousel', 'Carousels'],
                      ['story', 'Stories'],
                    ] as const
                  ).map(([v, label]) => (
                    <button key={v} className={`btn sm ${typeFilter === v ? 'primary' : 'ghost'}`} onClick={() => setTypeFilter(v)}>
                      {label}
                    </button>
                  ))}
                  <span className="muted" aria-hidden="true">·</span>
                  {(
                    [
                      ['all', 'Any status'],
                      ['rendered', 'Exported'],
                      ['draft', 'Drafts'],
                    ] as const
                  ).map(([v, label]) => (
                    <button key={v} className={`btn sm ${statusFilter === v ? 'primary' : 'ghost'}`} onClick={() => setStatusFilter(v)}>
                      {label}
                    </button>
                  ))}
                </>
              )}
              {biz.hasApprovedKit ? (
                <Link className="btn primary sm" href={`/projects/new?businessId=${biz._id}`}>
                  + New project
                </Link>
              ) : (
                <button className="btn sm" disabled title="Approve a brand kit first">
                  + New project
                </button>
              )}
            </div>
          </div>

          {biz.projects.length === 0 ? (
            <div className="empty" style={{ marginTop: 12, textAlign: 'center', padding: '28px 16px' }}>
              {biz.hasApprovedKit ? (
                <>
                  <p style={{ margin: '0 0 6px', fontSize: 16 }}>
                    <strong>Nothing here yet — let&rsquo;s change that.</strong>
                  </p>
                  <p className="muted" style={{ margin: '0 0 14px' }}>
                    Paste a paragraph and AI arranges it into on-brand slides, polishes the layout,
                    and writes the caption.
                  </p>
                  <Link className="btn primary" href={`/projects/new?businessId=${biz._id}`}>
                    ✦ Draft your first post
                  </Link>
                </>
              ) : (
                <>
                  No projects yet.{' '}
                  <Link href={`/businesses/${biz._id}/brand-kit`}>Approve a brand kit</Link> to unlock
                  projects.
                </>
              )}
            </div>
          ) : (
            <>
              {visibleProjects.length === 0 && (
                <p className="muted" style={{ marginTop: 12 }}>No projects match these filters.</p>
              )}
              <div className="project-grid" style={{ marginTop: 12 }}>
                {visibleProjects.map((p) => (
                  <div className="project-card" key={p._id}>
                    <Link href={`/projects/${p._id}`} aria-label={`Open ${p.title}`} className="project-card-thumb">
                      <ProjectThumb project={p as ProjectThumbData} kit={renderKit} media={media} width={200} />
                    </Link>
                    <div className="project-card-menu">
                      <OverflowMenu
                        items={[
                          { label: 'Duplicate', onClick: () => void duplicateProject(p) },
                          { label: 'Delete project', onClick: () => void removeProject(p._id, p.title), danger: true },
                        ]}
                      />
                    </div>
                    <div className="project-card-body">
                      <Link href={`/projects/${p._id}`} className="project-card-title">
                        {p.title}
                      </Link>
                      <div className="badges" style={{ marginTop: 4 }}>
                        <span className="badge accent">{p.type === 'story' ? 'story' : 'carousel'}</span>
                        <span className="badge">{p.slides.length} slide{p.slides.length === 1 ? '' : 's'}</span>
                        <span className={`badge ${p.status === 'rendered' ? 'ok' : ''}`}>
                          {p.status === 'rendered' ? 'exported' : 'draft'}
                        </span>
                        {p.campaignId && campaignName.get(String(p.campaignId)) && (
                          <Link href={`/campaigns/${p.campaignId}`} className="badge" title="Part of a campaign">
                            ✦ {campaignName.get(String(p.campaignId))}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
