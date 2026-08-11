'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { MediaAsset } from '@contentbuilder/shared';
import {
  getBusiness,
  getBrandKit,
  listMedia,
  deleteProject,
  createProject,
  type BusinessDetail,
} from '../../lib/api';
import ProfileCard from '../../components/ProfileCard';
import BrandLessons from '../../components/BrandLessons';
import { confirm } from '../../components/ConfirmDialog';
import { ErrorState } from '../../components/ErrorState';
import { resumeLabel, summaryStep } from '../../../lib/onboarding';
import { Icon } from '../../components/Icon';
import { OverflowMenu } from '../../components/OverflowMenu';
import { Skeleton } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { ProjectThumb, type ProjectThumbData } from '../../components/ProjectThumb';
import { toRenderKit } from '../../../lib/render/projectRender';

export default function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [biz, setBiz] = useState<BusinessDetail | null>(null);
  const [kitRaw, setKitRaw] = useState<Awaited<ReturnType<typeof getBrandKit>>['approved']>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'carousel' | 'story'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'rendered' | 'draft'>('all');
  // Same rule as /start and the Desk rail — one derivation, three surfaces.
  const setupStep = biz ? summaryStep(biz) : 'done';

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [b, k, m] = await Promise.all([
        getBusiness(id),
        getBrandKit(id).catch(() => ({ draft: null, approved: null })),
        listMedia(id).catch(() => []),
      ]);
      setBiz(b);
      setKitRaw(k.approved);
      setMedia(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const renderKit = useMemo(() => (kitRaw ? toRenderKit(kitRaw) : null), [kitRaw]);

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
      toast(e instanceof Error ? e.message : String(e), 'error');
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
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div>
      <p className="muted">
        <Link href="/">← Studio</Link>
      </p>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!biz && !error && (
        // The brand room's shape while it loads: name, status row, profile
        // card, then the project grid.
        <div role="status" aria-label="Loading the brand">
          <Skeleton shape="block" w={280} h={34} style={{ margin: '4px 0 14px' }} />
          <div className="row" style={{ marginBottom: 16 }}>
            <Skeleton shape="block" w={150} h={26} style={{ borderRadius: 'var(--radius-pill)' }} />
            <Skeleton shape="line" w={180} h={12} />
          </div>
          <Skeleton shape="block" h={140} style={{ marginBottom: 20 }} />
          <Skeleton shape="line" w={120} h={16} style={{ marginBottom: 14 }} />
          <div className="project-grid">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} shape="block" h={300} />
            ))}
          </div>
        </div>
      )}

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

          {/*
            The old "Getting started" here was a checklist of things to go and
            find: a numbered list that told you what was missing and left you to
            walk to each screen yourself. It is a link now, because the guided
            flow already knows which of those steps you are on and does them in
            order. This surface only has to notice that setup is unfinished.
          */}
          {setupStep !== 'done' && (
            <aside className="ob-resume" role="status" style={{ marginBottom: 16, maxWidth: 620 }}>
              <Icon name="sparkle" size={14} />
              <p>
                {setupStep === 'post'
                  ? `${biz.name} is designed and approved. One step left: its first post.`
                  : `${biz.name} isn’t set up yet — there’s no approved design system, so nothing can be composed against it.`}
              </p>
              <Link className="btn sm primary" href={`/start?b=${biz._id}`}>
                {resumeLabel(setupStep)}
              </Link>
            </aside>
          )}

          <ProfileCard businessId={biz._id} profile={biz.profile} onSaved={reload} />

          {/* What this brand has taught the copywriter, from its owner's own
              edits. Renders nothing at all until a correction has repeated. */}
          <BrandLessons businessId={biz._id} />

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
                  <Icon name="plus" size={13} /> New project
                </Link>
              ) : (
                <button className="btn sm" disabled title="Approve a brand kit first">
                  <Icon name="plus" size={13} /> New project
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
                    <Icon name="sparkle" /> Draft your first post
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
                    <Link href={`/projects/${p._id}/review`} aria-label={`Open ${p.title}`} className="project-card-thumb">
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
                      <Link href={`/projects/${p._id}/review`} className="project-card-title">
                        {p.title}
                      </Link>
                      <div className="badges" style={{ marginTop: 4 }}>
                        <span className="badge accent">{p.type === 'story' ? 'story' : 'carousel'}</span>
                        <span className="badge">{p.slides.length} slide{p.slides.length === 1 ? '' : 's'}</span>
                        <span className={`badge ${p.status === 'rendered' ? 'ok' : ''}`}>
                          {p.status === 'rendered' ? 'exported' : 'draft'}
                        </span>
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
