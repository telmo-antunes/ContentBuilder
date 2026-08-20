'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { BrandKit, MediaAsset } from '@contentbuilder/shared';
import {
  getBusiness,
  getBrandKit,
  listMedia,
  deleteProject,
  createProject,
  analyzeBusiness,
  createManualKit,
  type BusinessDetail,
} from '../../lib/api';
import ProfileCard from '../../components/ProfileCard';
import BrandLessons from '../../components/BrandLessons';
import { confirm } from '../../components/ConfirmDialog';
import { ErrorState } from '../../components/ErrorState';
import { OverflowMenu } from '../../components/OverflowMenu';
import { Skeleton } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { ProjectThumb, type ProjectThumbData } from '../../components/ProjectThumb';
import { toRenderKit } from '../../../lib/render/projectRender';

/** Strip Next.js's internal font tokens for the type line. */
function cleanFontName(raw: string): string {
  return raw
    .split(',')[0]!
    .replace(/^__/, '')
    .replace(/_[0-9a-f]{6}$/i, '')
    .replace(/_/g, ' ')
    .replace(/["']/g, '')
    .trim();
}

/** The identity lines' staged status while the site is being read. */
const FILL_LABELS: Array<{ atMs: number; palette: string; type: string; logo: string; voice: string }> = [
  { atMs: 0, palette: 'reading the site’s styles…', type: 'queued', logo: 'queued', voice: 'queued' },
  { atMs: 9000, palette: 'reading the site’s styles…', type: 'matching fonts…', logo: 'queued', voice: 'queued' },
  { atMs: 17000, palette: 'assigning roles…', type: 'matching fonts…', logo: 'looking…', voice: 'queued' },
  { atMs: 26000, palette: 'assigning roles…', type: 'verifying…', logo: 'looking…', voice: 'reading the copy…' },
];

/**
 * THE DOSSIER — the brand room and /start's later steps as ONE surface.
 *
 * A brand is a document: identity (palette, type, logo, voice), profile,
 * lessons, work. During setup the document fills itself line by line as the
 * analysis reads the site; afterwards this same page is the brand room, every
 * line a receipt with its Edit. An unfinished dossier simply still has queued
 * lines — "resume setup" is not a feature, it's the state of the document.
 */
export default function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [biz, setBiz] = useState<BusinessDetail | null>(null);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [kitIsDraft, setKitIsDraft] = useState(false);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'carousel' | 'story'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'rendered' | 'draft'>('all');
  const [profileOpen, setProfileOpen] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Set when an analysis just landed — the identity lines animate in, staggered. */
  const [justFilled, setJustFilled] = useState(false);
  /** Which staged fill-labels apply right now (index into FILL_LABELS). */
  const [fillStage, setFillStage] = useState(0);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [b, k, m] = await Promise.all([
        getBusiness(id),
        getBrandKit(id).catch(() => ({ draft: null, approved: null })),
        listMedia(id).catch(() => []),
      ]);
      setBiz(b);
      setKit(k.draft ?? k.approved ?? null);
      setKitIsDraft(Boolean(k.draft));
      setMedia(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Walk the staged labels while an analysis runs, so the queued lines narrate
  // what is being read rather than showing one frozen "working" state.
  useEffect(() => {
    if (busy !== 'analyze') return;
    setFillStage(0);
    const start = Date.now();
    const t = setInterval(() => {
      const elapsed = Date.now() - start;
      setFillStage(FILL_LABELS.reduce((acc, s, i) => (elapsed >= s.atMs ? i : acc), 0));
    }, 1000);
    return () => clearInterval(t);
  }, [busy]);

  const analyze = async () => {
    if (
      biz?.hasApprovedKit &&
      !(await confirm({
        title: 'Replace brand kit?',
        message: 'This will replace the current approved brand kit. Continue?',
        confirmText: 'Replace',
      }))
    ) {
      return;
    }
    setBusy('analyze');
    try {
      await analyzeBusiness(id);
      await reload();
      // The reveal: freshly-read lines rise in one after another.
      setJustFilled(true);
      window.setTimeout(() => setJustFilled(false), 1600);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const manual = async () => {
    setBusy('manual');
    try {
      await createManualKit(id);
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const renderKit = useMemo(() => (kit && !kitIsDraft ? toRenderKit(kit) : kit ? toRenderKit(kit) : null), [kit, kitIsDraft]);

  const visibleProjects = useMemo(() => {
    const list = (biz?.projects ?? []).filter(
      (p) =>
        (typeFilter === 'all' || p.type === typeFilter) &&
        (statusFilter === 'all' || (statusFilter === 'rendered' ? p.status === 'rendered' : p.status !== 'rendered')),
    );
    // Newest work first (the API already sorts, but filtering shouldn't rely on it).
    return [...list].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  }, [biz, typeFilter, statusFilter]);

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

  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!biz) {
    return (
      <div className="mo-page mo-kit mo-dossier-page" role="status" aria-label="Loading the brand">
        <Skeleton shape="line" w={140} h={12} style={{ marginBottom: 14 }} />
        <Skeleton shape="block" w={320} h={34} style={{ marginBottom: 18 }} />
        <Skeleton shape="block" h={420} style={{ borderRadius: 22 }} />
      </div>
    );
  }

  const analyzing = busy === 'analyze';
  const fill = FILL_LABELS[fillStage]!;
  const hasKit = Boolean(kit);
  const recipe = (kit as { recipe?: { signature?: { name?: string } } } | null)?.recipe;
  const hasRecipe = Boolean(recipe);
  const voice = (kit?.voice ?? '').trim();
  const canRead = Boolean(biz.websiteUrl) && biz.hasProfile;
  const postCount = biz.projects.length;

  // The status line: where this dossier is on its road, and the one next door.
  const status: { tone: 'ok' | 'warn' | 'wait'; text: string; action?: { label: string; href?: string; onClick?: () => void } } =
    !hasKit
      ? {
          tone: 'wait',
          text: analyzing
            ? 'Reading the site — the lines below fill in as it learns.'
            : 'Not set up yet — read the website and the identity lines fill themselves.',
          action: analyzing ? undefined : canRead ? { label: 'Read the website', onClick: () => void analyze() } : undefined,
        }
      : kitIsDraft
        ? { tone: 'warn', text: 'Kit drafted — review it and approve in the Passport.', action: { label: 'Open the Passport →', href: `/businesses/${id}/brand-kit` } }
        : !hasRecipe
          ? { tone: 'warn', text: 'Kit approved — now design the look (the recipe every post composes against).', action: { label: 'Design the look →', href: `/businesses/${id}/brand-kit` } }
          : postCount === 0
            ? { tone: 'warn', text: 'Designed and approved. One line left in this dossier: the first post.', action: { label: 'Compose the first post →', href: `/projects/new?businessId=${id}` } }
            : { tone: 'ok', text: `Kit approved · recipe live · ${postCount} post${postCount === 1 ? '' : 's'}.`, action: { label: 'Passport →', href: `/businesses/${id}/brand-kit` } };

  return (
    <div className="mo-page mo-kit mo-dossier-page">
      <p className="mo-crumb">
        <Link href="/">Home</Link>
        {' / '}
        {biz.name}
      </p>

      <header className="mo-shead" style={{ paddingBottom: 14 }}>
        <div>
          <div className="htitle">
            <h1 style={{ fontFamily: 'var(--mo-disp)', fontWeight: 600, fontSize: 27, letterSpacing: '-0.03em', margin: 0 }}>
              {biz.name}
            </h1>
          </div>
        </div>
        <div className="side">
          <div className="actions">
            <Link className="mo-btn sm" href={`/businesses/${id}/brand-kit`}>
              {hasKit ? 'Brand kit' : 'Create brand kit'}
            </Link>
            {biz.hasApprovedKit ? (
              <Link className="mo-btn sm prim" href={`/projects/new?businessId=${id}`}>
                ＋ New post
              </Link>
            ) : (
              <button className="mo-btn sm prim" disabled title="Approve a brand kit first">
                ＋ New post
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mo-dossier">
        <div className="mo-dhead">
          <span className="k">
            {kit?.logo?.url ? (
              // A dead asset URL should degrade to the monogram, not a broken glyph.
              <img
                src={kit.logo.url}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).parentElement!.append(biz.name.trim().charAt(0).toUpperCase());
                }}
              />
            ) : (
              biz.name.trim().charAt(0).toUpperCase()
            )}
          </span>
          <div>
            <div className="t">The {biz.name} dossier</div>
            <div className="s">
              {biz.profile?.category ? `${biz.profile.category} · ` : ''}
              {biz.websiteUrl ? (
                <a href={biz.websiteUrl} target="_blank" rel="noreferrer">
                  {biz.websiteUrl.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                'no website on file'
              )}
            </div>
          </div>
          {analyzing && (
            <span className="live" role="status">
              <i />
              reading the site…
            </span>
          )}
        </div>

        {/* ── Status: where this dossier is, and its one next door ── */}
        <div className="mo-drow">
          <span className="l">Status</span>
          <span className="v" style={status.tone === 'ok' ? { color: 'var(--mo-green)', fontWeight: 600 } : undefined}>
            {status.text}
            {!hasKit && !analyzing && (
              <span className="actrow">
                {canRead && (
                  <button className="mo-btn sm prim" onClick={() => void analyze()} disabled={busy !== null}>
                    Read the website
                  </button>
                )}
                <button className="mo-btn sm" onClick={() => void manual()} disabled={busy !== null}>
                  {busy === 'manual' ? 'Creating…' : 'Enter the kit by hand'}
                </button>
                {!biz.hasProfile && (
                  <button className="mo-btn sm" onClick={() => setProfileOpen(true)}>
                    Complete the profile first
                  </button>
                )}
              </span>
            )}
          </span>
          {status.action?.href ? (
            <Link className="edit" href={status.action.href}>
              {status.action.label}
            </Link>
          ) : status.action ? (
            <button className="edit" onClick={status.action.onClick}>
              {status.action.label}
            </button>
          ) : (
            <span />
          )}
        </div>

        {/* ── Identity lines: filled by the analysis, edited in the Passport ── */}
        <div className={`mo-drow${!hasKit && !analyzing ? ' pending' : ''}${justFilled ? ' filling' : ''}`} style={justFilled ? { animationDelay: '0.05s' } : undefined}>
          <span className="l">Palette</span>
          <span className="v">
            {hasKit ? (
              <>
                {(['background', 'secondary', 'primary', 'accent', 'text'] as const).map((r) => (
                  <span key={r} className="sw" style={{ background: kit!.colors[r] }} />
                ))}
              </>
            ) : analyzing ? (
              <span className="shimmer" />
            ) : (
              'Lands when the site is read'
            )}
          </span>
          {hasKit ? (
            <span className="side">
              <span className="mo-dst ok">
                ✓ {kit!.provenance?.colors === 'computed' ? 'from the site’s real styles' : kit!.provenance?.colors === 'sampled' ? 'sampled from a screenshot' : 'entered manually'}
              </span>
              <Link className="edit" href={`/businesses/${id}/brand-kit`}>Edit</Link>
            </span>
          ) : (
            <span className={`mo-dst ${analyzing ? 'busy' : 'wait'}`}>{analyzing ? fill.palette : 'queued'}</span>
          )}
        </div>

        <div className={`mo-drow${!hasKit && !analyzing ? ' pending' : ''}${justFilled ? ' filling' : ''}`} style={justFilled ? { animationDelay: '0.2s' } : undefined}>
          <span className="l">Type</span>
          <span className="v">
            {hasKit ? (
              <>
                <b>{kit!.fonts.render.heading}</b> headlines · {kit!.fonts.render.body} body
                {kit!.fonts.detected?.heading ? (
                  <span className="chp">site uses {cleanFontName(kit!.fonts.detected.heading)}</span>
                ) : null}
              </>
            ) : analyzing ? (
              <span className="shimmer" style={{ width: 180 }} />
            ) : (
              'Matched from the site'
            )}
          </span>
          {hasKit ? (
            <span className="side">
              <Link className="edit" href={`/businesses/${id}/brand-kit`}>Edit</Link>
            </span>
          ) : (
            <span className={`mo-dst ${analyzing && fillStage >= 1 ? 'busy' : 'wait'}`}>{analyzing ? fill.type : 'queued'}</span>
          )}
        </div>

        <div className={`mo-drow${!hasKit && !analyzing ? ' pending' : ''}${justFilled ? ' filling' : ''}`} style={justFilled ? { animationDelay: '0.35s' } : undefined}>
          <span className="l">Logo</span>
          <span className="v">
            {hasKit && kit!.logo?.url ? (
              <img
                className="logoth"
                src={kit!.logo.url}
                alt="logo"
                onError={(e) => ((e.target as HTMLImageElement).outerHTML = 'On file — preview unavailable')}
              />
            ) : hasKit ? (
              'None found — upload one in the Passport'
            ) : analyzing ? (
              <span className="shimmer" style={{ width: 120 }} />
            ) : (
              'Found on the site, if it has one'
            )}
          </span>
          {hasKit ? (
            <span className="side">
              {kit!.logo?.url && kit!.provenance?.logo === 'dom' && <span className="mo-dst ok">✓ found on the site</span>}
              <Link className="edit" href={`/businesses/${id}/brand-kit`}>Edit</Link>
            </span>
          ) : (
            <span className={`mo-dst ${analyzing && fillStage >= 2 ? 'busy' : 'wait'}`}>{analyzing ? fill.logo : 'queued'}</span>
          )}
        </div>

        <div className={`mo-drow${!hasKit && !analyzing ? ' pending' : ''}${justFilled ? ' filling' : ''}`} style={justFilled ? { animationDelay: '0.5s' } : undefined}>
          <span className="l">Voice</span>
          <span className="v" style={hasKit && !voice ? { color: 'var(--mo-amber)' } : undefined}>
            {hasKit ? (
              voice ? `“${voice.slice(0, 110)}${voice.length > 110 ? '…' : ''}”` : 'Not written yet — the copywriter falls back to a generic register'
            ) : analyzing ? (
              <span className="shimmer" style={{ width: 260 }} />
            ) : (
              'Drafted from the homepage copy'
            )}
          </span>
          {hasKit ? (
            <span className="side">
              <Link className="edit" href={`/businesses/${id}/brand-kit`}>{voice ? 'Edit' : 'Write it'}</Link>
            </span>
          ) : (
            <span className={`mo-dst ${analyzing && fillStage >= 3 ? 'busy' : 'wait'}`}>{analyzing ? fill.voice : 'queued'}</span>
          )}
        </div>

        {/* ── Profile: who this brand is for, in the owner's words ── */}
        <div className={`mo-drow${biz.hasProfile ? '' : ' pending'}`}>
          <span className="l">Profile</span>
          <span className="v" style={!biz.hasProfile ? { color: 'var(--mo-amber)' } : undefined}>
            {biz.hasProfile ? (
              <>
                {biz.profile?.category}
                {biz.profile?.audience ? ` · ${biz.profile.audience}` : ''}
                {(biz.profile?.tone ?? []).slice(0, 4).map((t) => (
                  <span key={t} className="chp">{t}</span>
                ))}
              </>
            ) : (
              'Not filled in — AI extraction and composing are locked until it is'
            )}
          </span>
          <button className="edit" onClick={() => setProfileOpen((v) => !v)}>
            {profileOpen ? 'Close' : biz.hasProfile ? 'Edit' : 'Fill it in'}
          </button>
          {profileOpen && (
            <div className="mo-drow-body">
              <ProfileCard businessId={biz._id} profile={biz.profile} onSaved={reload} />
            </div>
          )}
        </div>

        {/* ── Lessons: what this brand's owner has taught the copywriter ── */}
        <div className="mo-drow">
          <span className="l">Learned</span>
          <span className="v" style={{ color: 'var(--mo-muted)' }}>
            What the AI has learned from your edits — corrections that repeated become standing lessons.
          </span>
          <button className="edit" onClick={() => setLessonsOpen((v) => !v)}>
            {lessonsOpen ? 'Close' : 'Review'}
          </button>
          {lessonsOpen && (
            <div className="mo-drow-body">
              <BrandLessons businessId={biz._id} />
            </div>
          )}
        </div>

        {/* ── The work, at the document's foot ── */}
        <div className="mo-dwork">
          <div className="wh">
            <span className="t">The work</span>
            <span className="b">{postCount} post{postCount === 1 ? '' : 's'}</span>
          </div>
          {postCount > 3 && (
            <div className="filters">
              {(
                [
                  ['all', 'All'],
                  ['carousel', 'Carousels'],
                  ['story', 'Stories'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={typeFilter === v ? 'on' : undefined} onClick={() => setTypeFilter(v)}>
                  {label}
                </button>
              ))}
              {(
                [
                  ['all', 'Any status'],
                  ['rendered', 'Exported'],
                  ['draft', 'Drafts'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={statusFilter === v ? 'on' : undefined} onClick={() => setStatusFilter(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {postCount === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--mo-muted)', margin: 0 }}>
              {biz.hasApprovedKit ? (
                <>
                  Nothing here yet.{' '}
                  <Link href={`/projects/new?businessId=${biz._id}`}>Compose the first post</Link> — paste a
                  paragraph and the AI arranges it into on-brand slides.
                </>
              ) : (
                <>The work lands here once the kit above is approved.</>
              )}
            </p>
          ) : visibleProjects.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--mo-faint)', margin: 0 }}>No posts match these filters.</p>
          ) : (
            <div className="grid">
              {visibleProjects.map((p) => (
                <div className="mo-dpost" key={p._id}>
                  <Link href={`/projects/${p._id}/review`} aria-label={`Open ${p.title}`} className="thumb">
                    <ProjectThumb project={p as ProjectThumbData} kit={renderKit} media={media} width={200} />
                  </Link>
                  <div className="menu">
                    <OverflowMenu
                      items={[
                        { label: 'Duplicate', onClick: () => void duplicateProject(p) },
                        { label: 'Delete project', onClick: () => void removeProject(p._id, p.title), danger: true },
                      ]}
                    />
                  </div>
                  <Link href={`/projects/${p._id}/review`} className="tt">
                    {p.title}
                  </Link>
                  <div className="tm">
                    {p.type === 'story' ? 'story' : 'carousel'} · {p.slides.length} slide{p.slides.length === 1 ? '' : 's'} ·{' '}
                    <span className={`fl ${p.status === 'rendered' ? 'ok' : 'warn'}`}>
                      {p.status === 'rendered' ? 'exported' : 'draft'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
