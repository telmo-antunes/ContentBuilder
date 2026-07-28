'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FORMAT_LABELS,
  authoredSlots,
  contrastRatio,
  dimensionsFor,
  type BlockFrame,
  type BrandRecipe,
  type Format,
  type MediaAsset,
  type Slide,
  type SlidePhoto,
} from '@contentbuilder/shared';
import {
  getProject,
  updateProject,
  getShareInfo,
  getSlideVariants,
  saveSlidePhotos,
  tweakSlide,
  type ProjectDetail,
} from '../../../lib/api';
import { api } from '../../../lib/config';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import {
  toRenderKit,
  resolveSlideImage,
  resolveImageLayout,
  resolveSlidePhotos,
} from '../../../../lib/render/projectRender';
import { parseAuthored, buildAuthored, type AuthoredEl } from '../../../../lib/authoredEdit';
import { toast } from '../../../components/Toast';
import SlidePhotoPanel from '../../../components/SlidePhotoPanel';
import FreeImageOverlay from '../../../components/FreeImageOverlay';


/** Text elements where the brand's signature emphasis (accent phrase) applies. */
const EMPH_CLASSES = new Set(['headline', 'tagline', 'quote', 'body', 'lead', 'sub']);
const canEmphasize = (el: AuthoredEl) =>
  el.emphasis !== undefined || EMPH_CLASSES.has(el.className.split(/\s+/)[0] ?? '');

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
 * right inspector to surgically edit the selected authored slide (copy, order,
 * and the brand's accent emphasis) without ever degrading the brand design.
 */
export default function ReviewPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'zip' | 'video' | null>(null);
  /** Timestamp of the last "play motion" press — remounts the slide to replay it. */
  const [playing, setPlaying] = useState<number | null>(null);
  /** Real 0–100 progress of a running video export. */
  const [videoPct, setVideoPct] = useState(0);
  const [sel, setSel] = useState(0);
  // Surgical editing of the selected AUTHORED slide (copy / order / emphasis),
  // kept in the recipe's own markup so nothing about the brand design degrades.
  const [editId, setEditId] = useState<string | null>(null);
  const [editEls, setEditEls] = useState<AuthoredEl[]>([]);
  const [saving, setSaving] = useState(false);
  // Slides whose composition exceeds the canvas — surfaced so a broken export
  // can't ship silently (authored slides had no text-fit guard at all).
  const [overflow, setOverflow] = useState<Record<string, boolean>>({});
  // Alternative arrangements for the selected slide — shown side by side, applied
  // only on click, so a single weak slide no longer means re-composing the deck.
  const [variants, setVariants] = useState<Array<{ html: string; bg?: string; role?: string }> | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  /** The floating image currently grabbable on the preview. */
  const [freeSel, setFreeSel] = useState<string | null>(null);

  /**
   * Persist a slide's photos. Applied to local state FIRST so the preview moves
   * with the pointer, then written — a drag that waited on the network would
   * feel broken. A failed write reloads the project so what you see is the
   * truth rather than an optimistic lie.
   */
  const savePhotos = useCallback(
    async (slideId: string, photos: SlidePhoto[], uploaded?: MediaAsset) => {
      setProject((p) =>
        p
          ? {
              ...p,
              slides: p.slides.map((s) => (s.id === slideId ? { ...s, photos } : s)),
              // A freshly uploaded asset isn't in the media list this page
              // loaded with, and the renderer resolves photos BY asset — so
              // without this the picture simply doesn't appear until a reload.
              media: uploaded && !p.media.some((m) => m._id === uploaded._id)
                ? [uploaded, ...p.media]
                : p.media,
            }
          : p,
      );
      try {
        await saveSlidePhotos(projectId, slideId, photos);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not save the photo', 'error');
        getProject(projectId).then(setProject).catch(() => {});
      }
    },
    [projectId],
  );

  useEffect(() => {
    let alive = true;
    getProject(projectId)
      .then((p) => alive && setProject(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load project'));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // ── Authored-slide editing ────────────────────────────────────────────────
  const startEdit = useCallback((slide: Slide) => {
    setEditId(slide.id);
    setEditEls(parseAuthored(slide.authored?.html ?? ''));
  }, []);
  const cancelEdit = useCallback(() => {
    setEditId(null);
    setEditEls([]);
  }, []);
  const patchEl = useCallback((key: string, patch: Partial<AuthoredEl>) => {
    setEditEls((els) => els.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }, []);
  const moveEl = useCallback((key: string, dir: -1 | 1) => {
    setEditEls((els) => {
      const i = els.findIndex((e) => e.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= els.length) return els;
      const next = [...els];
      const a = next[i]!;
      next[i] = next[j]!;
      next[j] = a;
      return next;
    });
  }, []);
  const removeEl = useCallback((key: string) => {
    setEditEls((els) => els.filter((e) => e.key !== key));
  }, []);

  const saveEdit = useCallback(
    async (allSlides: Slide[]) => {
      if (!editId) return;
      setSaving(true);
      try {
        const nextSlides = allSlides.map((s) =>
          s.id === editId ? { ...s, authored: { ...s.authored, html: buildAuthored(editEls) } } : s,
        );
        const updated = await updateProject(projectId, { slides: nextSlides as Slide[] });
        setProject((prev) => (prev ? { ...prev, slides: updated.slides } : prev));
        toast('Slide updated', 'ok');
        setEditId(null);
        setEditEls([]);
      } catch {
        toast('Could not save the slide', 'error');
      } finally {
        setSaving(false);
      }
    },
    [editId, editEls, projectId],
  );

  /** Ask for alternative arrangements of the selected slide (copy untouched). */
  const askVariants = useCallback(
    async (slideId: string) => {
      setWorking('variants');
      setVariants(null);
      try {
        const res = await getSlideVariants(projectId, slideId, 2);
        setVariants(res.variants);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not get alternatives', 'error');
      } finally {
        setWorking(null);
      }
    },
    [projectId],
  );

  /** Apply one candidate to the slide. */
  const applyVariant = useCallback(
    async (slideId: string, v: { html: string; bg?: string; role?: string }, allSlides: Slide[]) => {
      setWorking('apply');
      try {
        const next = allSlides.map((s) =>
          s.id === slideId ? { ...s, authored: { ...s.authored, ...v } } : s,
        );
        const updated = await updateProject(projectId, { slides: next as Slide[] });
        setProject((prev) => (prev ? { ...prev, slides: updated.slides } : prev));
        setVariants(null);
        toast('Arrangement applied', 'ok');
      } catch {
        toast('Could not apply that arrangement', 'error');
      } finally {
        setWorking(null);
      }
    },
    [projectId],
  );

  /** Instant deterministic tweaks — no AI, no waiting. */
  const applyTweak = useCallback(
    async (slideId: string, tweak: 'bigger-headline' | 'smaller-headline' | 'invert' | 'un-invert') => {
      setWorking(tweak);
      try {
        const updated = await tweakSlide(projectId, slideId, tweak);
        setProject((prev) => (prev ? { ...prev, slides: updated.slides } : prev));
      } catch {
        toast('Could not apply that change', 'error');
      } finally {
        setWorking(null);
      }
    },
    [projectId],
  );

  /** Save a fetched blob response as a download. */
  const saveBlob = useCallback(async (res: Response, fallback: string) => {
    const blob = await res.blob();
    const name =
      (res.headers.get('Content-Disposition') ?? '').match(/filename="?([^"]+)"?/)?.[1] ?? fallback;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  /**
   * Export the project. The PNG zip streams straight back; the VIDEO takes
   * ~1–2 min (longer than any proxy will hold a request), so it runs as a job:
   * start it, poll until it's rendered, then download.
   */
  const runExport = useCallback(
    async (kind: 'zip' | 'video') => {
      setExporting(kind);
      try {
        if (kind === 'zip') {
          const res = await fetch(api(`/projects/${projectId}/export`), { method: 'POST' });
          if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
          await saveBlob(res, 'project.zip');
          toast('ZIP downloaded', 'ok');
          return;
        }

        const start = await fetch(api(`/projects/${projectId}/export-video`), { method: 'POST' });
        if (!start.ok) {
          const msg = await start.json().catch(() => null);
          throw new Error(msg?.error ?? `Video export failed (HTTP ${start.status})`);
        }
        const { jobId } = (await start.json()) as { jobId: string };
        setVideoPct(0);
        toast('Rendering one video per slide…');

        // Poll until the job produces the clips (or fails), tracking real progress.
        for (let i = 0; i < 220; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const poll = await fetch(api(`/projects/${projectId}/export-video/${jobId}`));
          if (!poll.ok) {
            const msg = await poll.json().catch(() => null);
            throw new Error(msg?.error ?? `Video export failed (HTTP ${poll.status})`);
          }
          const type = poll.headers.get('Content-Type') ?? '';
          // A zip (several slides) or a lone mp4 means it's finished.
          if (type.startsWith('video/') || type.includes('zip')) {
            setVideoPct(100);
            await saveBlob(poll, type.includes('zip') ? 'videos.zip' : 'project.mp4');
            toast(slides.length > 1 ? `${slides.length} slide videos downloaded` : 'Video downloaded', 'ok');
            return;
          }
          const body = (await poll.json().catch(() => null)) as { percent?: number } | null;
          if (typeof body?.percent === 'number') setVideoPct(body.percent);
        }
        throw new Error('Video export timed out.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Export failed', 'error');
      } finally {
        setExporting(null);
      }
    },
    [projectId, saveBlob],
  );

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
  const inspectorW = 288;
  const inspectorScale = inspectorW / dimensionsFor(project.format).width;
  const recipe = (project.brandKit as { recipe?: BrandRecipe } | undefined)?.recipe;
  const slides = [...project.slides].sort((a, b) => a.order - b.order);
  const cardW = project.format === '1080x1920' ? 208 : 296;
  const authored = slides.length > 0 && slides.every((s) => s.authored?.html);
  const selected = slides[Math.min(sel, slides.length - 1)];
  // Live-edited view: while editing, swap the selected slide's authored HTML for
  // the in-progress rebuild so the deck + preview reflect edits before saving.
  const editingHtml = editId ? buildAuthored(editEls) : null;
  const workingSlides =
    editId && editingHtml !== null
      ? slides.map((s) => (s.id === editId ? { ...s, authored: { ...s.authored, html: editingHtml } } : s))
      : slides;
  const selectedWorking = workingSlides[Math.min(sel, workingSlides.length - 1)];
  /** Slots the composer left that still have no photo — a blank panel on export. */
  const unfilledSlots = (s: Slide) => {
    const filled = new Set((s.photos ?? []).filter((p) => p.placement === 'slot').map((p) => p.slot));
    return authoredSlots(s.authored?.html ?? '').filter((n) => !filled.has(n)).length;
  };
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
              {authored && (
                <button
                  className="btn"
                  onClick={() => runExport('video')}
                  disabled={exporting !== null}
                  title={`Render each slide as its own animated MP4 (${slides.length} clip${slides.length === 1 ? '' : 's'})`}
                >
                  {exporting === 'video' ? `Rendering… ${videoPct}%` : '🎬 Video'}
                </button>
              )}
              <button className="btn primary" onClick={() => runExport('zip')} disabled={exporting !== null}>
                {exporting === 'zip' ? 'Exporting…' : '⬇ Export'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Determinate loader — real render progress, one clip per slide. */}
      {exporting === 'video' && (
        <div className="vid-prog" role="status" aria-live="polite">
          <div className="vid-prog-top">
            <span className="lbl">
              Rendering {slides.length} slide video{slides.length === 1 ? '' : 's'}
            </span>
            <span className="pct">{videoPct}%</span>
          </div>
          <div
            className="vid-prog-bar"
            role="progressbar"
            aria-valuenow={videoPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${Math.max(2, videoPct)}%` }} />
          </div>
          <p className="vid-prog-sub">
            Each slide becomes its own MP4 — on Instagram the viewer decides when to advance, so the
            clips stay independent. Capturing the motion frame by frame; this takes a minute.
          </p>
        </div>
      )}

      {slides.length === 0 ? (
        <div className="empty">
          This project has no slides yet. Start a{' '}
          <Link href="/projects/new">new AI-composed project</Link>.
        </div>
      ) : (
        <div className="studio">
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
              Click a slide to select it, then edit it on the right — copy, order, and the brand&apos;s accent, all kept in the recipe&apos;s own design.
            </p>

            <div className="studio-deck">
              {workingSlides.map((slide, i) => (
                <div
                  key={slide.id}
                  className={`studio-pcard${i === sel ? ' sel' : ''}${slide.id === editId ? ' editing' : ''}`}
                  onClick={() => {
                    if (editId && slide.id !== editId) cancelEdit(); // discard unsaved edits when switching
                    setSel(i);
                  }}
                >
                  <span className="num">{i + 1}</span>
                  {unfilledSlots(slide) > 0 && (
                    <span className="needsphoto" title="This slide has an image slot you haven't filled — it exports as a blank panel.">
                      ⬚ Needs photo
                    </span>
                  )}
                  {overflow[slide.id] && (
                    <span className="ovf" title="This slide's content is taller than the canvas — shorten the copy.">
                      ⚠ Overflows
                    </span>
                  )}
                  <ScaledSlide format={project.format} displayWidth={cardW}>
                    <SlideRenderer
                      onOverflow={(o) =>
                        setOverflow((m) => (m[slide.id] === o ? m : { ...m, [slide.id]: o }))
                      }
                      slide={slide}
                      brandKit={kit}
                      format={project.format}
                      image={resolveSlideImage(slide, project.media)}
                      imageLayout={resolveImageLayout(slide, project.media)}
                      photos={resolveSlidePhotos(slide, project.media)}
                      editing
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
            {selectedWorking && (
              <>
                <div style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <ScaledSlide
                    format={project.format}
                    displayWidth={inspectorW}
                    overlay={
                      <FreeImageOverlay
                        photos={(selectedWorking.photos ?? []).filter((p) => p.placement === 'free')}
                        canvasW={dimensionsFor(project.format).width}
                        canvasH={dimensionsFor(project.format).height}
                        scale={inspectorScale}
                        selectedId={freeSel}
                        onSelect={setFreeSel}
                        onCommit={(id, frame: BlockFrame) =>
                          void savePhotos(
                            selectedWorking.id,
                            (selectedWorking.photos ?? []).map((p) => (p.id === id ? { ...p, frame } : p)),
                          )
                        }
                      />
                    }
                  >
                    <SlideRenderer
                      // Remounting on `playing` restarts the CSS reveal, so the
                      // button replays the exact motion the video will export.
                      key={playing ? `motion-${playing}` : 'still'}
                      slide={selectedWorking}
                      brandKit={kit}
                      format={project.format}
                      image={resolveSlideImage(selectedWorking, project.media)}
                      imageLayout={resolveImageLayout(selectedWorking, project.media)}
                      photos={resolveSlidePhotos(selectedWorking, project.media)}
                      editing
                      theme={selectedWorking.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
                      forExport
                      motion={playing !== null}
                    />
                  </ScaledSlide>
                </div>
                {authored && (
                  <button
                    className="btn sm ghost"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    onClick={() => setPlaying(Date.now())}
                    title="Play the motion this slide will have in a video export"
                  >
                    ▶ Play motion
                  </button>
                )}
              </>
            )}

            {editId && selectedWorking?.id === editId ? (
              <div className="aed">
                <div className="aed-head">
                  <h5 style={{ margin: 0 }}>Edit slide</h5>
                  <span className="muted" style={{ fontSize: 11 }}>copy · order · accent</span>
                </div>
                <p className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  Edits stay in the brand&apos;s design — the styling never changes.
                </p>
                <div className="aed-list">
                  {editEls.map((el, i) => (
                    <div className="aed-row" key={el.key}>
                      <div className="aed-rowtop">
                        <span className="aed-tag">{el.label}</span>
                        <div className="aed-ctl">
                          <button title="Move up" disabled={i === 0} onClick={() => moveEl(el.key, -1)}>↑</button>
                          <button title="Move down" disabled={i === editEls.length - 1} onClick={() => moveEl(el.key, 1)}>↓</button>
                          <button title="Remove" className="del" onClick={() => removeEl(el.key)}>✕</button>
                        </div>
                      </div>
                      {el.kind === 'text' ? (
                        <>
                          <textarea
                            className="aed-text"
                            rows={Math.min(4, Math.max(1, Math.ceil(el.text.length / 30)))}
                            value={el.text}
                            onChange={(e) => patchEl(el.key, { text: e.target.value })}
                          />
                          {canEmphasize(el) && (
                            <input
                              className="aed-emph"
                              placeholder="accent phrase (the brand signature) — optional"
                              value={el.emphasis ?? ''}
                              onChange={(e) => patchEl(el.key, { emphasis: e.target.value || undefined })}
                            />
                          )}
                        </>
                      ) : (
                        <div className="aed-struct">{el.label} — kept exactly as designed</div>
                      )}
                    </div>
                  ))}
                  {editEls.length === 0 && (
                    <p className="muted" style={{ fontSize: 12 }}>Nothing left on this slide — cancel to restore it.</p>
                  )}
                </div>
                <div className="aed-actions">
                  <button className="btn primary sm" disabled={saving} onClick={() => saveEdit(slides)}>
                    {saving ? 'Saving…' : 'Save slide'}
                  </button>
                  <button className="btn ghost sm" disabled={saving} onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
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

                {/* Your own photography: fill the AI's placeholders, set a
                    background, or drop images anywhere on the canvas. */}
                {selected?.authored?.html && (
                  <>
                    <div className="studio-divln" />
                    <div className="k studio-klbl">Images</div>
                    <SlidePhotoPanel
                      slide={selected}
                      media={project.media}
                      businessId={String(project.businessId)}
                      busy={working !== null || saving}
                      selectedFreeId={freeSel}
                      onSelectFree={setFreeSel}
                      onChange={(photos, uploaded) => void savePhotos(selected.id, photos, uploaded)}
                    />
                  </>
                )}

                {/* Instant, reversible tweaks — deterministic, no AI, no waiting. */}
                {selected?.authored?.html && (
                  <>
                    <div className="studio-divln" />
                    <div className="k studio-klbl">Adjust</div>
                    <div className="intents">
                      <button
                        className="btn sm"
                        disabled={working !== null}
                        onClick={() => applyTweak(selected.id, 'bigger-headline')}
                      >
                        Bigger headline
                      </button>
                      <button
                        className="btn sm"
                        disabled={working !== null}
                        onClick={() => applyTweak(selected.id, 'smaller-headline')}
                      >
                        Smaller headline
                      </button>
                      <button
                        className="btn sm"
                        disabled={working !== null || !recipe?.surfaces?.inverse}
                        title={
                          recipe?.surfaces?.inverse
                            ? 'Flip this slide to the brand’s light surface'
                            : 'This brand has no inverse surface yet'
                        }
                        onClick={() =>
                          applyTweak(
                            selected.id,
                            selected.authored?.bg === 'inverse' ? 'un-invert' : 'invert',
                          )
                        }
                      >
                        {selected.authored?.bg === 'inverse' ? 'Un-invert' : 'Invert'}
                      </button>
                    </div>
                  </>
                )}

                {/* Candidates: same copy, different arrangement. Nothing saved until picked. */}
                {variants && variants.length > 0 && (
                  <div className="studio-variants">
                    <div className="k studio-klbl">Pick an arrangement</div>
                    <div className="sv-row">
                      {variants.map((v, i) => (
                        <button
                          key={i}
                          className="sv-card"
                          disabled={working !== null}
                          onClick={() => selected && applyVariant(selected.id, v, slides)}
                          title="Apply this arrangement"
                        >
                          <ScaledSlide format={project.format} displayWidth={124}>
                            <SlideRenderer
                              slide={{ authored: v }}
                              brandKit={kit}
                              format={project.format}
                              image={selected ? resolveSlideImage(selected, project.media) : null}
                              photos={selected ? resolveSlidePhotos(selected, project.media) : undefined}
                              forExport
                            />
                          </ScaledSlide>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="row" style={{ gap: 8, marginTop: 18 }}>
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled={!selected?.authored?.html}
                    onClick={() => selected && startEdit(selected)}
                  >
                    ✎ Edit
                  </button>
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled={!selected?.authored?.html || working !== null}
                    title="Re-arrange this slide only — the copy is kept"
                    onClick={() => selected && askVariants(selected.id)}
                  >
                    {working === 'variants' ? 'Thinking…' : '✦ Alternatives'}
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
