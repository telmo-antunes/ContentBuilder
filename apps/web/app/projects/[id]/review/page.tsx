'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  REFINE_INTENTS,
  FORMAT_LABELS,
  contrastRatio,
  type RefineIntent,
  type BrandRecipe,
  type Format,
} from '@contentbuilder/shared';
import {
  getProject,
  refineProjectSlide,
  getShareInfo,
  listBusinesses,
  type ProjectDetail,
  type BusinessSummary,
} from '../../../lib/api';
import { api } from '../../../lib/config';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../../../../lib/render/projectRender';
import { toast } from '../../../components/Toast';

function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/**
 * The Studio — the design-first review workspace. An editorial masthead, the
 * brand recipe the slides were composed against, the live carousel, and a
 * right inspector to refine the selected slide by intent (copy is never touched).
 */
export default function ReviewPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sel, setSel] = useState(0);
  const [brands, setBrands] = useState<BusinessSummary[]>([]);

  useEffect(() => {
    let alive = true;
    getProject(projectId)
      .then((p) => alive && setProject(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load project'));
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    listBusinesses()
      .then(setBrands)
      .catch(() => {});
  }, []);

  const applyIntent = useCallback(
    async (slideId: string, intent: RefineIntent) => {
      setBusy(`${slideId}:${intent}`);
      try {
        const res = await refineProjectSlide(projectId, slideId, intent);
        // The endpoint returns the bare project; keep the joined brandKit/media
        // (unchanged by a refine) and swap in only the updated slides.
        setProject((prev) => (prev ? { ...prev, slides: res.project.slides } : prev));
        toast(res.note, res.changed ? 'ok' : undefined);
      } catch {
        toast('Could not apply that change', 'error');
      } finally {
        setBusy(null);
      }
    },
    [projectId],
  );

  const exportZip = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(api(`/projects/${projectId}/export`), { method: 'POST' });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const name = (res.headers.get('Content-Disposition') ?? '').match(/filename="?([^"]+)"?/)?.[1] ?? 'project.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('ZIP downloaded', 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }, [projectId]);

  const share = useCallback(async () => {
    try {
      const info = await getShareInfo(projectId);
      await navigator.clipboard.writeText(info.url);
      toast('Interactive preview link copied', 'ok');
    } catch {
      toast('Could not get a share link', 'error');
    }
  }, [projectId]);

  if (error) {
    return (
      <div className="container">
        <div className="error-box">{error}</div>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="container">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const kit = toRenderKit(project.brandKit);
  const recipe = (project.brandKit as { recipe?: BrandRecipe } | undefined)?.recipe;
  const slides = [...project.slides].sort((a, b) => a.order - b.order);
  const cardW = project.format === '1080x1920' ? 208 : 296;
  const authored = slides.length > 0 && slides.every((s) => s.authored?.html);
  const selected = slides[Math.min(sel, slides.length - 1)];
  const contrast =
    recipe && recipe.tokens.ink && recipe.tokens.ground
      ? contrastRatio(recipe.tokens.ink, recipe.tokens.ground)
      : null;

  return (
    <div className="container">
      {/* top bar */}
      <div className="row" style={{ alignItems: 'center', marginBottom: 18 }}>
        <Link href={`/businesses/${project.businessId}`} style={{ fontSize: 13 }}>
          ← {project.brandKit ? 'Back to brand' : 'Back'}
        </Link>
        <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          {slides.length > 0 && (
            <>
              <a className="btn" href={`/preview/${projectId}`} target="_blank" rel="noopener noreferrer">
                ▶ Preview
              </a>
              <button className="btn" onClick={share}>
                Share
              </button>
              <button className="btn primary" onClick={exportZip} disabled={exporting}>
                {exporting ? 'Exporting…' : '⬇ Export'}
              </button>
            </>
          )}
          {!authored && (
            <Link className="btn ghost" href={`/projects/${projectId}`}>
              Editor →
            </Link>
          )}
        </div>
      </div>

      {slides.length === 0 ? (
        <div className="empty">
          This project has no slides yet.{' '}
          <Link href={`/projects/${projectId}`}>Open the editor</Link> to build it, or start a{' '}
          <Link href="/projects/new">new AI-composed project</Link>.
        </div>
      ) : (
        <div className="studio">
          {/* ── brand switcher ── */}
          <aside className="studio-brandlist">
            <h4>Your brands</h4>
            {brands.map((b) => (
              <Link
                key={b._id}
                href={`/businesses/${b._id}`}
                className={`brow${b._id === project.businessId ? ' on' : ''}`}
              >
                <span
                  className="bdot"
                  style={{ background: b.kit?.colors.accent ?? b.kit?.colors.primary ?? 'var(--accent)' }}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="bnm">{b.name}</div>
                  {b.profile?.category && <div className="bmt">{b.profile.category}</div>}
                </div>
                <span className="bco">{b.projectCount}</span>
              </Link>
            ))}
          </aside>

          {/* ── main ── */}
          <div className="studio-main">
            <header className="studio-mast">
              <div className="st-hero">
                <span className="aur x" style={{ background: recipe?.tokens.accent ?? kit.colors.accent }} />
                <span
                  className="aur y"
                  style={{ background: recipe?.tokens.groundAlt ?? recipe?.tokens.ground ?? kit.colors.primary }}
                />
                <span className="gr" />
                <p className="studio-eyebrow">Studio · {project.type === 'story' ? 'story' : 'carousel'}</p>
                <h1>{project.title}</h1>
                <div className="studio-meta">
                  <div>
                    <div className="k">Format</div>
                    <div className="v">{FORMAT_LABELS[project.format as Format] ?? project.format}</div>
                  </div>
                  <div>
                    <div className="k">Slides</div>
                    <div className="v">{slides.length}</div>
                  </div>
                  <div>
                    <div className="k">Status</div>
                    <div className={`v${authored ? ' ok' : ''}`}>{authored ? 'On-brand ✓' : 'Draft'}</div>
                  </div>
                  <div>
                    <div className="k">Updated</div>
                    <div className="v">{timeAgo(project.updatedAt)}</div>
                  </div>
                </div>
              </div>
            </header>

            {recipe && (
              <section className="studio-recipe">
                <div className="rh">
                  <span className="lab">Brand recipe</span>
                  <span className="muted" style={{ fontSize: 11 }}>drives every slide</span>
                  <Link href={`/businesses/${project.businessId}/brand-kit`}>Edit recipe →</Link>
                </div>
                <div className="studio-rgrid">
                  <div>
                    <div className="k">Palette</div>
                    <div className="v">
                      <span className="studio-sw" style={{ background: recipe.tokens.ground }} />
                      <span className="studio-sw" style={{ background: recipe.tokens.accent }} />
                      {recipe.tokens.ink && <span className="studio-sw" style={{ background: recipe.tokens.ink }} />}
                    </div>
                  </div>
                  <div>
                    <div className="k">Type</div>
                    <div className="v">{recipe.tokens.displayFamily}</div>
                  </div>
                  <div>
                    <div className="k">Signature</div>
                    <div className="v">{recipe.signature.name}</div>
                  </div>
                  <div>
                    <div className="k">Voice</div>
                    <div className="v">{recipe.voice.description || '—'}</div>
                  </div>
                </div>
              </section>
            )}

            <div className="studio-sec">
              <h2>{project.type === 'story' ? 'The story' : 'The carousel'}</h2>
              <span className="count">{slides.length} slides</span>
              <span className="live">Rendered live</span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 4px' }}>
              Click a slide to select it, then refine on the right — bounded to the brand and safe area, copy untouched.
            </p>

            <div className="studio-deck">
              {slides.map((slide, i) => (
                <div
                  key={slide.id}
                  className={`studio-pcard${i === sel ? ' sel' : ''}`}
                  onClick={() => setSel(i)}
                >
                  <span className="num">{i + 1}</span>
                  <ScaledSlide format={project.format} displayWidth={cardW}>
                    <SlideRenderer
                      slide={slide}
                      brandKit={kit}
                      format={project.format}
                      image={resolveSlideImage(slide, project.media)}
                      imageLayout={resolveImageLayout(slide, project.media)}
                      theme={slide.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
                      forExport
                    />
                  </ScaledSlide>
                </div>
              ))}
            </div>
          </div>

          {/* ── inspector ── */}
          <aside className="studio-inspector">
            <p className="studio-eyebrow">Slide {sel + 1} of {slides.length}</p>
            {selected && (
              <div style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <ScaledSlide format={project.format} displayWidth={288}>
                  <SlideRenderer
                    slide={selected}
                    brandKit={kit}
                    format={project.format}
                    image={resolveSlideImage(selected, project.media)}
                    imageLayout={resolveImageLayout(selected, project.media)}
                    theme={selected.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
                    forExport
                  />
                </ScaledSlide>
              </div>
            )}

            <h5>Refine this slide</h5>
            <p className="muted" style={{ fontSize: 11.5 }}>Bounded to the brand &amp; safe area. Copy is never touched.</p>
            <div className="intents">
              {REFINE_INTENTS.map(({ intent, label, hint }) => (
                <button
                  key={intent}
                  className="btn sm"
                  title={hint}
                  disabled={busy !== null || !selected}
                  onClick={() => selected && applyIntent(selected.id, intent)}
                >
                  {selected && busy === `${selected.id}:${intent}` ? '…' : label}
                </button>
              ))}
            </div>

            {recipe && (
              <>
                <div className="studio-divln" />
                <div className="k" style={{ fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>
                  Brand tokens
                </div>
                <div className="studio-tok">
                  <span className="lab">Ground</span>
                  <span className="val"><span className="studio-sw" style={{ background: recipe.tokens.ground, margin: 0 }} />{recipe.tokens.ground}</span>
                </div>
                <div className="studio-tok">
                  <span className="lab">Accent</span>
                  <span className="val"><span className="studio-sw" style={{ background: recipe.tokens.accent, margin: 0 }} />{recipe.tokens.accent}</span>
                </div>
                <div className="studio-tok">
                  <span className="lab">Display</span>
                  <span className="val">{recipe.tokens.displayFamily}</span>
                </div>
                {contrast !== null && (
                  <div className="studio-tok">
                    <span className="lab">Contrast</span>
                    <span className="val" style={{ color: contrast >= 4.5 ? 'var(--accent)' : 'var(--warn)' }}>
                      {contrast.toFixed(1)} : 1 {contrast >= 4.5 ? '✓' : '⚠'}
                    </span>
                  </div>
                )}
              </>
            )}

            {authored ? (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 18 }}>
                Fine-grained free-canvas editing for AI-composed slides is coming soon. For now, refine
                by intent above, or re-compose from a new idea.
              </p>
            ) : (
              <Link className="btn" href={`/projects/${projectId}`} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
                Open in editor
              </Link>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
