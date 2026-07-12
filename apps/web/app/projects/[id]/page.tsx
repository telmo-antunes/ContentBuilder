'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Block, BlockType, LayoutType, MediaAsset, Slide } from '@contentbuilder/shared';
import {
  BLOCK_TYPES,
  BLOCK_LABELS,
  SELECTABLE_LAYOUT_TYPES,
  LAYOUT_DESCRIPTIONS,
  isFreeLayout,
  FORMAT_LABELS,
  LAYOUT_LABELS,
  MAX_SLIDES_PER_PROJECT,
  THEME_PRESETS,
  dimensionsFor,
  safeAreaFor,
  isListBlock,
  layoutWantsImage,
  SPLIT_PLACEMENTS,
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  type Format,
  type ImageObject,
  type ImageTreatment,
  type ProjectSettings,
  type SlideOverrides,
  type SplitPlacement,
  type ImageAspect,
  type ImageSizePreset,
  type ThemePreset,
  type Caption,
  type BlockFrame,
  type SlideDecoration,
} from '@contentbuilder/shared';
import {
  getProject,
  updateProject,
  uploadMedia,
  generateProjectCaption,
  getSlideAlternatives,
  listProjectVersions,
  saveProjectVersion,
  restoreProjectVersion,
  polishProject,
  type ProjectDetail,
  type ProjectVersion,
} from '../../lib/api';
import { api } from '../../lib/config';
import { SlideRenderer } from '../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../lib/render/SlideFrame';
import { FreeCanvasOverlay } from './FreeCanvasOverlay';
import { confirm } from '../../components/ConfirmDialog';
import { useStagedProgress, POLISH_STAGES } from '../../components/useStagedProgress';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../../../lib/render/projectRender';
import type { RenderBrandKit } from '../../../lib/render/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function uid(): string {
  return crypto.randomUUID();
}

function newSlide(layoutType: LayoutType = 'TextOnly'): Slide {
  return {
    id: uid(),
    order: 0,
    layoutType,
    blocks: [{ type: 'title', text: '' }],
    imageNeed: layoutWantsImage(layoutType) ? 'upload' : 'none',
  };
}

/** A slide whose layout needs an image but none is attached yet. */
function slideMissingImage(s: Slide): boolean {
  return layoutWantsImage(s.layoutType) && !s.mediaAssetId;
}

export default function ProjectEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState('');
  const [slides, setSlides] = useState<Slide[]>([]);
  const [settings, setSettings] = useState<ProjectSettings>({});
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Selected canvas/inspector element, shared so the two highlight in sync.
  // A target id: 'b<index>' for a text block, 'image', or 'obj-<index>'.
  const [selTarget, setSelTarget] = useState<string | null>(null);
  const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const savedSnapshot = useRef<string>('');
  const historyRef = useRef<{ title: string; slides: Slide[] }[]>([]);
  const futureRef = useRef<{ title: string; slides: Slide[] }[]>([]);
  const lastSnapRef = useRef<number>(0);

  useEffect(() => {
    getProject(id)
      .then((p) => {
        setDetail(p);
        setTitle(p.title);
        setSlides(p.slides);
        setSettings(p.settings ?? {});
        setMedia(p.media);
        setSelectedId(p.slides[0]?.id ?? null);
        savedSnapshot.current = JSON.stringify({ title: p.title, slides: p.slides, settings: p.settings ?? {} });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  // Debounced autosave whenever title/slides/settings change (skips initial load).
  // Suspended while Polish runs: a stale autosave landing mid-polish would
  // overwrite the server-side fixes with pre-polish slides (lost update). When
  // `polishing` flips back to false this effect re-runs and flushes any edits.
  useEffect(() => {
    if (!detail || polishing) return;
    const snapshot = JSON.stringify({ title, slides, settings });
    if (snapshot === savedSnapshot.current) return;
    setSaveState('saving');
    const t = setTimeout(async () => {
      try {
        await updateProject(id, { title, slides, settings });
        savedSnapshot.current = snapshot;
        setSaveState('saved');
      } catch (e) {
        setSaveState('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [title, slides, settings, detail, id, polishing]);

  // Clear the shared selection when switching slides.
  useEffect(() => {
    setSelTarget(null);
  }, [selectedId]);

  // One-time notice passed from the draft flow (e.g. Free → Designer fallback).
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('notice');
    if (n === 'free-fallback') {
      setNotice("Free-canvas drafting didn't work this time, so Designer layouts were used instead. You can change each slide's layout from the inspector.");
    }
    if (n) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Manual re-save after an autosave failure (the debounced effect only fires on edits).
  const retrySave = async () => {
    const snap = JSON.stringify({ title, slides, settings });
    setSaveState('saving');
    try {
      await updateProject(id, { title, slides, settings });
      savedSnapshot.current = snap;
      setSaveState('saved');
      setError(null);
    } catch (e) {
      setSaveState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const kit: RenderBrandKit = useMemo(() => toRenderKit(detail?.brandKit), [detail]);
  const theme: ThemePreset = settings.theme ?? 'editorial';
  // Some slides may carry a per-slide theme override (e.g. from a Designer draft)
  // that diverges from the project theme — offer a one-click unify.
  const themeDiverges = slides.some((s) => Boolean(s.overrides?.theme) && s.overrides?.theme !== theme);
  const applyThemeToAll = () => {
    snapshot();
    setSlides((prev) =>
      prev.map((s) => {
        if (!s.overrides?.theme) return s;
        const { theme: _drop, ...rest } = s.overrides;
        return { ...s, overrides: rest };
      }),
    );
  };
  const showCounter = Boolean(settings.slideCounter) && detail?.type === 'carousel';

  // The main preview scales to fit the preview column so the full slide is always
  // visible (never clipped). Measured from the stage; capped so it doesn't get huge.
  const previewStageRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(440);
  // Preview zoom: 'fit' scales to the column; 0.5/1 are true pixel scales
  // (scrollable) for detail work on the 1080px canvas.
  const [zoom, setZoom] = useState<'fit' | 0.5 | 1>('fit');
  useEffect(() => {
    const el = previewStageRef.current;
    if (!el) return;
    const cap = detail?.format === '1080x1920' ? 360 : 540;
    const update = () => setPreviewWidth(Math.max(180, Math.min(cap, el.clientWidth - 56)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [detail?.format]);
  const selected = slides.find((s) => s.id === selectedId) ?? slides[0] ?? null;

  // Fool-proof free canvas: when the selected free slide's text no longer fits
  // its frame (AI frames are tight; a few extra characters used to mean an
  // overflow warning), grow the overflowing blocks' frames just enough to fit,
  // clamped to the safe area. Measures the real render via data-frame-idx and
  // goes through mutateSlide, so it's visible and undoable. Terminates because
  // it only mutates when a frame actually changes.
  useEffect(() => {
    if (!detail || !selected || !isFreeLayout(selected.layoutType)) return;
    const raf = requestAnimationFrame(() => {
      const stage = previewStageRef.current;
      if (!stage) return;
      const { height } = dimensionsFor(detail.format);
      const safe = safeAreaFor(detail.type);
      const yMax = 1 - (safe.bottomReserve / height || safe.padding / height);
      const grows = new Map<number, number>();
      stage.querySelectorAll<HTMLElement>('[data-frame-idx]').forEach((wrapper) => {
        const container = wrapper.firstElementChild as HTMLElement | null;
        const content = container?.firstElementChild as HTMLElement | null;
        if (!container || !content) return;
        const idx = Number(wrapper.dataset.frameIdx);
        // Case 1 — hard overflow: even the legibility floor doesn't fit.
        if (content.scrollHeight > container.clientHeight + 1) {
          grows.set(idx, content.scrollHeight / Math.max(container.clientHeight, 1));
          return;
        }
        // Case 2 — crush: the text "fits" only because the fitter forced it far
        // below its designed size and the box is essentially full. Unreadable
        // text is as broken as clipped text — grow toward a readable scale.
        // (--fit-scale is written by the fitter itself, so this reads its
        // actual verdict rather than re-deriving it from font pixels.)
        const fitScale = parseFloat(container.style.getPropertyValue('--fit-scale') || '1');
        if (fitScale < 0.5 && content.scrollHeight > container.clientHeight * 0.85) {
          grows.set(idx, Math.min(0.75 / fitScale, 2.5));
        }
      });
      if (grows.size === 0) return;
      let changed = false;
      const nextBlocks = selected.blocks.map((b, i) => {
        const ratio = grows.get(i);
        if (!ratio || !b.frame) return b;
        const maxH = Math.max(yMax - b.frame.y, b.frame.h);
        const h = Math.min(+(b.frame.h * ratio * 1.06).toFixed(4), maxH);
        if (h <= b.frame.h + 0.004) return b;
        changed = true;
        return { ...b, frame: { ...b.frame, h } };
      });
      if (changed) mutateSlide(selected.id, (s) => ({ ...s, blocks: nextBlocks }));
    });
    return () => cancelAnimationFrame(raf);
    // mutateSlide is recreated per render; the guards above make re-runs cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overflowIds, selected, detail]);

  const markOverflow = useCallback((slideId: string, over: boolean) => {
    setOverflowIds((prev) => {
      const has = prev.has(slideId);
      if (over === has) return prev;
      const next = new Set(prev);
      if (over) next.add(slideId);
      else next.delete(slideId);
      return next;
    });
  }, []);

  // ── Undo / redo history ───────────────────────────────────────────────────
  // Mirror current state in a ref so undo/redo can capture it without becoming
  // stale (keeps the keyboard handler stable).
  const stateRef = useRef<{ title: string; slides: Slide[] }>({ title, slides });
  stateRef.current = { title, slides };

  // Snapshot before a change; bursts of typing within 600ms coalesce into one.
  // Any fresh edit invalidates the redo stack.
  const snapshot = () => {
    futureRef.current = [];
    setCanRedo(false);
    const now = Date.now();
    if (now - lastSnapRef.current < 600 && historyRef.current.length) return;
    historyRef.current.push({ title, slides });
    if (historyRef.current.length > 60) historyRef.current.shift();
    lastSnapRef.current = now;
    if (!canUndo) setCanUndo(true);
  };

  const restore = (snap: { title: string; slides: Slide[] }) => {
    setTitle(snap.title);
    setSlides(snap.slides);
    setSelectedId((cur) => (snap.slides.some((s) => s.id === cur) ? cur : snap.slides[0]?.id ?? null));
    lastSnapRef.current = 0;
  };

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    futureRef.current.push(stateRef.current);
    restore(prev);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(stateRef.current);
    restore(next);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const z = e.key.toLowerCase() === 'z';
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && z && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && z && !e.shiftKey) {
        if (inField) return; // let inputs handle their own native undo
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') {
        setShowCheck(false);
        setPreviewIdx(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Slide mutations ─────────────────────────────────────────────────────
  const mutateSlide = (slideId: string, fn: (s: Slide) => Slide) => {
    snapshot();
    setSlides((prev) => prev.map((s) => (s.id === slideId ? fn(s) : s)));
  };

  // ── Lossless preset → free-canvas conversion ────────────────────────────
  // Measures the slide as it is CURRENTLY rendered (block wrappers, image slot,
  // brand chrome — all tagged with data attributes by the renderer) and rebuilds
  // the identical picture as FreePosition data. Nothing moves; everything
  // becomes draggable. Undoable like any other slide mutation.
  const convertToCanvas = () => {
    if (!detail || !selected || isFreeLayout(selected.layoutType)) return;
    const root = previewStageRef.current?.querySelector<HTMLElement>('[data-slide-root]');
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width < 2 || rootRect.height < 2) return;

    const frac = (r: DOMRect): BlockFrame => {
      const x = Math.min(Math.max((r.left - rootRect.left) / rootRect.width, 0), 0.98);
      const y = Math.min(Math.max((r.top - rootRect.top) / rootRect.height, 0), 0.98);
      return {
        x: +x.toFixed(4),
        y: +y.toFixed(4),
        w: +Math.max(0.02, Math.min(r.width / rootRect.width, 1 - x)).toFixed(4),
        h: +Math.max(0.015, Math.min(r.height / rootRect.height, 1 - y)).toFixed(4),
      };
    };

    // Text blocks, addressed by their original slide.blocks index.
    const frames = new Map<number, BlockFrame>();
    root.querySelectorAll<HTMLElement>('[data-block-idx]').forEach((el) => {
      frames.set(Number(el.dataset.blockIdx), frac(el.getBoundingClientRect()));
    });

    // Brand chrome (logo / accent rule / scrim) → decoration data.
    const decorations: SlideDecoration[] = [];
    root.querySelectorAll<HTMLElement>('[data-decor]').forEach((el) => {
      const kind = el.dataset.decor;
      if (kind !== 'logo' && kind !== 'rule' && kind !== 'divider' && kind !== 'scrim') return;
      const dir = el.dataset.decorDirection;
      decorations.push({
        kind,
        frame: frac(el.getBoundingClientRect()),
        z: kind === 'scrim' ? 1 : 2,
        // Preset scrims are near-opaque at the dark edge; carry that over so the
        // converted slide keeps the same legibility.
        ...(kind === 'scrim' ? { opacity: 0.96 } : {}),
        ...(kind === 'scrim' && (dir === 'to-top' || dir === 'to-bottom' || dir === 'to-left' || dir === 'to-right')
          ? { direction: dir }
          : {}),
      });
    });

    // The slide image (or its "Add image" placeholder — the region survives the
    // conversion either way): full-bleed reads as the canvas background; anything
    // smaller becomes a positioned image region. Measure the CLIPPING container
    // (the <img> itself can be inflated by a crop zoom transform).
    let imageFrame: BlockFrame | undefined;
    let imageBackground = false;
    const slot = root.querySelector<HTMLElement>('[data-image-slot]');
    if (slot) {
      const f = frac((slot.parentElement ?? slot).getBoundingClientRect());
      if (f.w > 0.94 && f.h > 0.94) imageBackground = true;
      else imageFrame = f;
    }

    mutateSlide(selected.id, (s) => ({
      ...s,
      layoutType: 'FreePosition' as LayoutType,
      blocks: s.blocks.map((b, i) => {
        const frame = frames.get(i);
        return frame ? { ...b, frame, z: 10 + i } : b;
      }),
      overrides: {
        ...s.overrides,
        ...(imageFrame ? { imageFrame } : {}),
        ...(imageBackground ? { imageBackground: true } : {}),
        ...(decorations.length ? { decorations } : {}),
      },
    }));
  };

  const reindex = (arr: Slide[]) => arr.map((s, i) => ({ ...s, order: i }));

  const addSlide = () => {
    if (slides.length >= MAX_SLIDES_PER_PROJECT) return;
    snapshot();
    const s = newSlide(detail?.type === 'story' ? 'BackgroundImage' : 'TextOnly');
    setSlides((prev) => reindex([...prev, s]));
    setSelectedId(s.id);
  };

  const duplicateSlide = (slideId: string) => {
    if (slides.length >= MAX_SLIDES_PER_PROJECT) return;
    snapshot();
    setSlides((prev) => {
      const idx = prev.findIndex((s) => s.id === slideId);
      if (idx < 0) return prev;
      const copy: Slide = { ...prev[idx]!, id: uid(), blocks: prev[idx]!.blocks.map((b) => ({ ...b })) };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      setSelectedId(copy.id);
      return reindex(next);
    });
  };

  const deleteSlide = async (slideId: string) => {
    const n = slides.findIndex((s) => s.id === slideId) + 1;
    const unit = detail?.type === 'story' ? 'frame' : 'slide';
    if (!(await confirm({
      title: `Delete ${unit}?`,
      message: `Delete ${unit} ${n}? You can undo this with ⌘Z while the editor is open.`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    snapshot();
    setSlides((prev) => {
      const idx = prev.findIndex((s) => s.id === slideId);
      const next = reindex(prev.filter((s) => s.id !== slideId));
      if (selectedId === slideId) {
        const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
        setSelectedId(fallback?.id ?? null);
      }
      return next;
    });
  };

  /** Move the slide at `from` to position `to` (drag-and-drop reorder). */
  const reorderSlides = (from: number, to: number) => {
    if (from === to) return;
    snapshot();
    setSlides((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return reindex(next);
    });
  };

  const moveSlide = (slideId: string, dir: -1 | 1) => {
    snapshot();
    setSlides((prev) => {
      const i = prev.findIndex((s) => s.id === slideId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return reindex(next);
    });
  };

  // Pre-export issues the user should know about before downloading.
  const issues = useMemo(() => {
    const missingImage = slides.filter(slideMissingImage);
    const overflowing = slides.filter((s) => overflowIds.has(s.id));
    return { missingImage, overflowing, count: missingImage.length + overflowing.length };
  }, [slides, overflowIds]);

  // Fool-proofing: an image layout with no image exports as an empty brand
  // panel. One click restyles those slides to a text-first layout that looks
  // intentional (undoable like any edit).
  const restyleImagelessSlides = () => {
    const ids = new Set(issues.missingImage.map((s) => s.id));
    if (ids.size === 0) return;
    snapshot();
    setSlides((prev) =>
      prev.map((s) => {
        if (!ids.has(s.id)) return s;
        const layoutType = s.layoutType === 'BackgroundImage' ? ('Statement' as const) : ('TextOnly' as const);
        return { ...s, layoutType, imageNeed: 'none' as const };
      }),
    );
  };

  const onExport = () => {
    if (slides.length === 0) return;
    if (issues.count > 0) setShowCheck(true);
    else void runExport();
  };

  // Ask the server to self-critique the rendered slides and auto-apply bounded
  // fixes (overflow, contrast, crowding). Applied through the undo path.
  const polishLabel = useStagedProgress(polishing, POLISH_STAGES);

  const polish = async () => {
    if (slides.length === 0 || polishing) return;
    setPolishing(true);
    setError(null);
    setNotice(null);
    try {
      await updateProject(id, { title, slides, settings }); // render exactly what's on screen
      const { project, report } = await polishProject(id);
      snapshot();
      setSlides(project.slides);
      savedSnapshot.current = JSON.stringify({ title, slides: project.slides, settings });
      setSaveState('saved');
      const fixed = report.filter((r) => r.applied.length);
      setNotice(
        fixed.length
          ? `Polished ${fixed.length} ${fixed.length === 1 ? 'slide' : 'slides'} — ${fixed
              .flatMap((r) => r.applied)
              .join(', ')}.`
          : report.length
            ? 'Reviewed the layout — a couple of things are flagged but nothing was safe to auto-fix.'
            : 'Reviewed the layout — everything looks good.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPolishing(false);
    }
  };

  const runExport = async () => {
    if (slides.length === 0) return;
    setShowCheck(false);
    setExporting(true);
    setError(null);
    try {
      // Flush pending edits so the export reflects exactly what's on screen.
      await updateProject(id, { title, slides, settings });
      savedSnapshot.current = JSON.stringify({ title, slides, settings });
      setSaveState('saved');

      const res = await fetch(api(`/projects/${id}/export`), { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        let msg = `Export failed (HTTP ${res.status})`;
        try {
          msg = JSON.parse(text).error ?? msg;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename="?([^"]+)"?/);
      const name = match?.[1] ?? 'project.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (error && !detail) {
    return (
      <div>
        <p className="muted">
          <Link href="/">← Businesses</Link>
        </p>
        <div className="error-box">{error}</div>
      </div>
    );
  }
  if (!detail || !selected) {
    return (
      <div>
        <p className="muted">
          <Link href="/">← Businesses</Link>
        </p>
        {detail && slides.length === 0 ? (
          <EmptyProject detail={detail} title={title} setTitle={setTitle} onAdd={addSlide} saveState={saveState} />
        ) : (
          <p className="muted">Loading editor…</p>
        )}
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <p className="muted" style={{ marginBottom: 6 }}>
        <Link href={`/businesses/${detail.businessId}`}>← {/* business */}Back to business</Link>
      </p>
      <div className="editor-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Montserrat', sans-serif", width: '100%', maxWidth: 520 }}
          />
          <div className="muted" style={{ fontSize: 13, marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>
              {detail.type} · {FORMAT_LABELS[detail.format]} · <SaveBadge state={saveState} onRetry={retrySave} />
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>· Theme</span>
              <select
                value={theme}
                onChange={(e) => setSettings((s) => ({ ...s, theme: e.target.value as ThemePreset }))}
                style={{ width: 'auto', padding: '3px 8px', fontSize: 12 }}
                aria-label="Theme preset"
              >
                {THEME_PRESETS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {themeDiverges && (
                <button
                  className="btn sm ghost"
                  style={{ padding: '2px 8px' }}
                  onClick={applyThemeToAll}
                  title="Some slides override the theme. Clear those overrides so every slide uses this theme."
                >
                  Apply to all
                </button>
              )}
            </span>
            {detail.type === 'carousel' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, margin: 0, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings.slideCounter)}
                  onChange={(e) => setSettings((s) => ({ ...s, slideCounter: e.target.checked }))}
                  style={{ width: 'auto' }}
                />
                Slide numbers
              </label>
            )}
          </div>
        </div>
        <div className="editor-actions">
          <button className="btn sm" onClick={undo} disabled={!canUndo} title="Undo (⌘/Ctrl+Z)">
            ↶ Undo
          </button>
          <button className="btn sm" onClick={redo} disabled={!canRedo} title="Redo (⌘/Ctrl+Shift+Z)">
            ↷ Redo
          </button>
          <button
            className="btn sm"
            onClick={() => setShowHistory(true)}
            title="Version snapshots — saved before AI drafts, polish, restores and on every export"
          >
            ⏱ History
          </button>
          <button
            className="btn sm"
            onClick={() => void polish()}
            disabled={polishing || slides.length === 0}
            title="Auto-fix layout issues (overflow, contrast, crowding)"
          >
            {polishing ? polishLabel ?? 'Polishing…' : '✦ Polish'}
          </button>
          <button
            className="btn sm"
            onClick={() => setPreviewIdx(slides.findIndex((s) => s.id === selected.id))}
            disabled={slides.length === 0}
            title={detail.type === 'story' ? 'Preview frames' : 'Preview the carousel'}
          >
            ▶ Preview
          </button>
          <button
            className="btn primary sm"
            onClick={onExport}
            disabled={exporting || slides.length === 0}
            title="Render every slide to PNG and download a ZIP"
          >
            {exporting
              ? `Rendering ${slides.length}…`
              : exported
                ? 'Exported ✓'
                : '⬇ Export ZIP'}
          </button>
          <Link className="btn sm" href={`/businesses/${detail.businessId}`}>
            Done
          </Link>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {notice && (
        <div
          className="warn-box"
          style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}
          role="status"
        >
          <span style={{ flex: 1 }}>{notice}</span>
          <button className="btn sm ghost" onClick={() => setNotice(null)} aria-label="Dismiss notice">
            Dismiss
          </button>
        </div>
      )}

      <div className="editor">
        {/* Slide rail */}
        <div className="rail">
          {slides.map((s, i) => (
            <div
              key={s.id}
              className={`thumb ${s.id === selected.id ? 'selected' : ''} ${dragIdx === i ? 'dragging' : ''} ${
                dragOverIdx === i && dragIdx !== null && dragIdx !== i
                  ? dragIdx < i
                    ? 'drop-after'
                    : 'drop-before'
                  : ''
              }`}
              onClick={() => setSelectedId(s.id)}
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverIdx !== i) setDragOverIdx(i);
              }}
              onDragLeave={() => setDragOverIdx((cur) => (cur === i ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null) reorderSlides(dragIdx, i);
                setDragIdx(null);
                setDragOverIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setDragOverIdx(null);
              }}
              title="Drag to reorder"
            >
              {overflowIds.has(s.id) && <span className="warn-dot" title="Text too long" />}
              {slideMissingImage(s) && (
                <span className="need-img-badge" title="This layout needs an image">
                  no image
                </span>
              )}
              <RailThumb
                slide={s}
                kit={kit}
                format={detail.format}
                media={media}
                theme={theme}
                index={i}
                total={slides.length}
                showCounter={showCounter}
                onOverflowById={markOverflow}
              />
              <div className="thumb-meta">
                <span>
                  {i + 1}. {LAYOUT_LABELS[s.layoutType]}
                </span>
                <span style={{ display: 'flex', gap: 2 }}>
                  <button
                    className="icon-btn"
                    style={{ width: 24, height: 24 }}
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveSlide(s.id, -1);
                    }}
                    title="Move up"
                    aria-label="Move slide up"
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    style={{ width: 24, height: 24 }}
                    disabled={i === slides.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveSlide(s.id, 1);
                    }}
                    title="Move down"
                    aria-label="Move slide down"
                  >
                    ↓
                  </button>
                  <button
                    className="icon-btn"
                    style={{ width: 24, height: 24 }}
                    disabled={slides.length >= MAX_SLIDES_PER_PROJECT}
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateSlide(s.id);
                    }}
                    title="Duplicate"
                    aria-label="Duplicate slide"
                  >
                    ⧉
                  </button>
                </span>
              </div>
            </div>
          ))}
          <button className="btn sm" onClick={addSlide} disabled={slides.length >= MAX_SLIDES_PER_PROJECT}>
            + Add {detail.type === 'story' ? 'frame' : 'slide'}
          </button>
          {slides.length >= MAX_SLIDES_PER_PROJECT && (
            <span className="muted" style={{ fontSize: 12 }}>
              Max {MAX_SLIDES_PER_PROJECT} slides.
            </span>
          )}
        </div>

        {/* Preview */}
        <div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 4, marginBottom: 6 }}>
            {([['fit', 'Fit'], [0.5, '50%'], [1, '100%']] as const).map(([value, label]) => (
              <button
                key={String(value)}
                className={`btn sm ${zoom === value ? 'primary' : 'ghost'}`}
                style={{ padding: '2px 10px', fontSize: 12 }}
                onClick={() => setZoom(value)}
                title={value === 'fit' ? 'Scale to fit the column' : `View at ${label} of export size`}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="preview-stage"
            ref={previewStageRef}
            style={zoom === 'fit' ? undefined : { overflow: 'auto', maxHeight: '72vh' }}
          >
            <ScaledSlide
              format={detail.format}
              displayWidth={zoom === 'fit' ? previewWidth : dimensionsFor(detail.format).width * zoom}
              overlay={
                isFreeLayout(selected.layoutType) ? (
                  <FreeCanvasOverlay
                    key={selected.id}
                    slide={selected}
                    scale={(zoom === 'fit' ? previewWidth : dimensionsFor(detail.format).width * zoom) / dimensionsFor(detail.format).width}
                    onChange={(fn) => mutateSlide(selected.id, fn)}
                    selected={selTarget}
                    onSelect={setSelTarget}
                  />
                ) : undefined
              }
            >
              <SlideRenderer
                slide={selected}
                brandKit={kit}
                format={detail.format}
                image={resolveSlideImage(selected, media)}
                imageLayout={resolveImageLayout(selected, media)}
                theme={selected.overrides?.theme ?? theme}
                slideIndex={slides.findIndex((s) => s.id === selected.id)}
                slideTotal={slides.length}
                showCounter={showCounter}
                onOverflow={(o) => markOverflow(selected.id, o)}
              />
            </ScaledSlide>
          </div>
          {overflowIds.has(selected.id) && (
            <div className="warn-box" style={{ marginTop: 12 }}>
              ⚠ Text is too long to fit at the minimum size. Shorten the copy, remove a block, or split
              across slides.
            </div>
          )}

        </div>

        {/* Inspector + caption: the caption is half the deliverable — it lives
            beside the slide controls, not below the fold. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <SlideInspector
            key={selected.id}
            slide={selected}
            detail={detail}
            media={media}
            onChange={(fn) => mutateSlide(selected.id, fn)}
            onDelete={() => deleteSlide(selected.id)}
            onUploaded={(asset) => setMedia((m) => [asset, ...m])}
            selectedTarget={selTarget}
            onSelectTarget={setSelTarget}
            onConvertToCanvas={convertToCanvas}
            kit={kit}
          />
          <CaptionPanel projectId={id} initial={detail.caption} hasSlides={slides.length > 0} />
        </div>
      </div>

      {showHistory && (
        <HistoryModal
          projectId={id}
          onClose={() => setShowHistory(false)}
          onRestored={(restored) => {
            snapshot();
            setSlides(restored);
            setSelectedId(restored[0]?.id ?? null);
            setShowHistory(false);
          }}
        />
      )}

      {showCheck && (
        <div className="modal-overlay" onClick={() => setShowCheck(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Pre-export checklist" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Before you export</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {issues.count} {issues.count === 1 ? 'slide needs' : 'slides need'} attention. You can fix
              them, or export anyway.
            </p>
            {issues.missingImage.length > 0 && (
              <div className="check-row">
                <span className="badge accent">no image</span>
                <span>
                  {issues.missingImage.length === 1
                    ? '1 slide uses an image layout but has no image'
                    : `${issues.missingImage.length} slides use an image layout but have no image`}{' '}
                  — they&apos;ll export as a plain brand panel.{' '}
                  <button className="btn sm ghost" style={{ marginLeft: 4 }} onClick={restyleImagelessSlides}>
                    Restyle {issues.missingImage.length === 1 ? 'it' : 'them'} as text slides
                  </button>
                </span>
              </div>
            )}
            {issues.overflowing.length > 0 && (
              <div className="check-row">
                <span className="badge warn">text too long</span>
                <span>
                  {issues.overflowing.length === 1
                    ? '1 slide has copy that doesn’t fit'
                    : `${issues.overflowing.length} slides have copy that doesn’t fit`}{' '}
                  at the minimum size — it may clip. Shorten or split it.
                </span>
              </div>
            )}
            <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setShowCheck(false)}>
                Keep editing
              </button>
              <button className="btn primary" onClick={() => void runExport()}>
                Export anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {previewIdx !== null && (
        <PreviewOverlay
          slides={slides}
          startIndex={previewIdx}
          format={detail.format}
          type={detail.type}
          kit={kit}
          media={media}
          theme={theme}
          showCounter={showCounter}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </div>
  );
}

/**
 * One rail thumbnail, memoized: rendering a slide runs the full layout +
 * text-fit machinery, so re-running ALL of them on every keystroke makes the
 * editor visibly laggy past ~10 slides. Props are stable by construction
 * (`mutateSlide` preserves the identity of untouched slides; `kit` is memoized;
 * `onOverflowById` is a useCallback), so only the edited slide re-renders.
 */
const RailThumb = memo(function RailThumb({
  slide,
  kit,
  format,
  media,
  theme,
  index,
  total,
  showCounter,
  onOverflowById,
}: {
  slide: Slide;
  kit: RenderBrandKit;
  format: ProjectDetail['format'];
  media: MediaAsset[];
  theme: ThemePreset;
  index: number;
  total: number;
  showCounter: boolean;
  onOverflowById: (slideId: string, over: boolean) => void;
}) {
  return (
    <ScaledSlide format={format} displayWidth={format === '1080x1920' ? 104 : 168}>
      <SlideRenderer
        slide={slide}
        brandKit={kit}
        format={format}
        image={resolveSlideImage(slide, media)}
        imageLayout={resolveImageLayout(slide, media)}
        theme={slide.overrides?.theme ?? theme}
        slideIndex={index}
        slideTotal={total}
        showCounter={showCounter}
        onOverflow={(o) => onOverflowById(slide.id, o)}
      />
    </ScaledSlide>
  );
});

/** Parse a free-text hashtag field into a clean, deduped list of #tags. */
function parseTags(s: string): string[] {
  return Array.from(
    new Set(
      s
        .split(/[\s,]+/)
        .map((t) => t.replace(/[^A-Za-z0-9#]/g, '').replace(/^#+/, ''))
        .filter(Boolean)
        .map((t) => `#${t.slice(0, 40)}`),
    ),
  ).slice(0, 30);
}

/**
 * The post's social caption + hashtags, written in the brand voice. Self-contained:
 * it persists via updateProject({caption}) on blur and Regenerate hits the caption
 * endpoint — independent of the slide autosave/undo history.
 */
function CaptionPanel({
  projectId,
  initial,
  hasSlides,
}: {
  projectId: string;
  initial?: Caption;
  hasSlides: boolean;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [tags, setTags] = useState((initial?.hashtags ?? []).join(' '));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const persist = async (nextText: string, nextTags: string) => {
    setErr(null);
    try {
      await updateProject(projectId, { caption: { text: nextText, hashtags: parseTags(nextTags) } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await generateProjectCaption(projectId);
      setText(p.caption?.text ?? '');
      setTags((p.caption?.hashtags ?? []).join(' '));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    const full = [text, parseTags(tags).join(' ')].filter(Boolean).join('\n\n');
    if (!full) return;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const chips = parseTags(tags);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Caption</strong>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn sm ghost"
            onClick={regenerate}
            disabled={busy || !hasSlides}
            title="Write a caption in the brand voice from the current slides"
          >
            {busy ? 'Writing…' : '✦ Regenerate'}
          </button>
          <button className="btn sm" onClick={copyAll} disabled={!text && !tags.trim()}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      </div>
      {err && (
        <div className="error-box" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      <textarea
        value={text}
        rows={6}
        placeholder={
          hasSlides
            ? 'Generate a caption in your brand voice, or write your own.'
            : 'Add slides first, then generate a caption.'
        }
        onChange={(e) => setText(e.target.value)}
        onBlur={() => persist(text, tags)}
        style={{ marginTop: 8, width: '100%' }}
      />
      <div className="section-label" style={{ marginTop: 8 }}>
        Hashtags
      </div>
      <input
        value={tags}
        placeholder="#brand #topic"
        onChange={(e) => setTags(e.target.value)}
        onBlur={() => persist(text, tags)}
      />
      {chips.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {chips.map((t) => (
            <span key={t} className="badge">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full-screen swipe preview of the project's slides (arrows / keyboard / dots). */
function PreviewOverlay({
  slides,
  startIndex,
  format,
  type,
  kit,
  media,
  theme,
  showCounter,
  onClose,
}: {
  slides: Slide[];
  startIndex: number;
  format: ProjectDetail['format'];
  type: ProjectDetail['type'];
  kit: RenderBrandKit;
  media: MediaAsset[];
  theme: ThemePreset;
  showCounter: boolean;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(Math.max(0, Math.min(startIndex, slides.length - 1)));
  const go = useCallback(
    (d: number) => setIdx((i) => Math.max(0, Math.min(slides.length - 1, i + d))),
    [slides.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const dim = dimensionsFor(format);
  const vh = typeof window !== 'undefined' ? window.innerHeight : 820;
  const displayWidth = Math.round(dim.width * (Math.min(760, vh * 0.74) / dim.height));
  const slide = slides[idx]!;

  return (
    <div className="modal-overlay preview-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Slide preview">
      <button
        className="preview-nav left"
        onClick={(e) => {
          e.stopPropagation();
          go(-1);
        }}
        disabled={idx === 0}
        aria-label="Previous slide"
      >
        ‹
      </button>

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <ScaledSlide format={format} displayWidth={displayWidth}>
          <SlideRenderer
            slide={slide}
            brandKit={kit}
            format={format}
            image={resolveSlideImage(slide, media)}
            imageLayout={resolveImageLayout(slide, media)}
            theme={slide.overrides?.theme ?? theme}
            slideIndex={idx}
            slideTotal={slides.length}
            showCounter={showCounter}
          />
        </ScaledSlide>
        <div className="preview-dots">
          {slides.map((s, i) => (
            <button
              key={s.id}
              className={`preview-dot ${i === idx ? 'active' : ''}`}
              onClick={() => setIdx(i)}
              aria-label={`Go to ${type === 'story' ? 'frame' : 'slide'} ${i + 1}`}
            />
          ))}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {type === 'story' ? 'Frame' : 'Slide'} {idx + 1} of {slides.length}
        </div>
      </div>

      <button
        className="preview-nav right"
        onClick={(e) => {
          e.stopPropagation();
          go(1);
        }}
        disabled={idx === slides.length - 1}
        aria-label="Next slide"
      >
        ›
      </button>
      <button className="preview-close" onClick={onClose} aria-label="Close preview">
        ✕
      </button>
    </div>
  );
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  const map: Record<SaveState, string> = {
    idle: 'All changes saved',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  };
  if (state === 'error') {
    return (
      <span className="save-pill" style={{ color: 'var(--danger)', fontWeight: 600 }}>
        Save failed
        {onRetry && (
          <button className="btn sm danger" style={{ marginLeft: 8, padding: '2px 9px' }} onClick={onRetry}>
            Retry
          </button>
        )}
      </span>
    );
  }
  return <span className="save-pill">{map[state]}</span>;
}

function EmptyProject({
  detail,
  title,
  setTitle,
  onAdd,
  saveState,
}: {
  detail: ProjectDetail;
  title: string;
  setTitle: (s: string) => void;
  onAdd: () => void;
  saveState: SaveState;
}) {
  return (
    <div style={{ maxWidth: 560 }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Montserrat', sans-serif", marginBottom: 6 }}
      />
      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        {detail.type} · {FORMAT_LABELS[detail.format]} · <SaveBadge state={saveState} />
      </div>
      <div className="empty">
        This project is empty. Add your first {detail.type === 'story' ? 'frame' : 'slide'} to start.
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={onAdd}>
            + Add {detail.type === 'story' ? 'frame' : 'slide'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inspector ────────────────────────────────────────────────────────────────
/** Collapsible inspector group with a header chevron + smooth height motion. */
function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="insp-section">
      <button type="button" className="insp-section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="insp-section-title">
          {title}
          {typeof count === 'number' && <span className="insp-count">{count}</span>}
        </span>
        <span className={`insp-chevron ${open ? 'open' : ''}`} aria-hidden="true">
          ▸
        </span>
      </button>
      <div className={`insp-section-body ${open ? 'open' : ''}`}>
        <div className="insp-section-inner">{children}</div>
      </div>
    </div>
  );
}

function SlideInspector({
  slide,
  detail,
  media,
  onChange,
  onDelete,
  onUploaded,
  selectedTarget,
  onSelectTarget,
  onConvertToCanvas,
  kit,
}: {
  slide: Slide;
  detail: ProjectDetail;
  media: MediaAsset[];
  onChange: (fn: (s: Slide) => Slide) => void;
  onDelete: () => void;
  onUploaded: (asset: MediaAsset) => void;
  selectedTarget: string | null;
  onSelectTarget: (id: string | null) => void;
  onConvertToCanvas: () => void;
  kit: RenderBrandKit;
}) {
  const wantsImage =
    layoutWantsImage(slide.layoutType) || isFreeLayout(slide.layoutType) || slide.imageNeed === 'upload';

  const setLayout = (layoutType: LayoutType) =>
    onChange((s) => ({
      ...s,
      layoutType,
      imageNeed: layoutWantsImage(layoutType) ? 'upload' : 'none',
    }));

  const setBlocks = (blocks: Block[]) => onChange((s) => ({ ...s, blocks }));

  return (
    <div className="panel inspector-panel">
      <Section title="Layout">
        {isFreeLayout(slide.layoutType) ? (
          <div className="hint-box">Free canvas — drag blocks in the preview</div>
        ) : (
          <>
            <select value={slide.layoutType} onChange={(e) => setLayout(e.target.value as LayoutType)}>
              {SELECTABLE_LAYOUT_TYPES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <button
              className="btn sm"
              style={{ marginTop: 8, width: '100%' }}
              onClick={onConvertToCanvas}
              title="Everything stays exactly where it is — then you can drag any element freely"
            >
              ⇢ Convert to free canvas
            </button>
          </>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {LAYOUT_DESCRIPTIONS[slide.layoutType]}{' '}
          <a href="/gallery" target="_blank" rel="noreferrer" style={{ whiteSpace: 'nowrap' }}>
            See all layouts ↗
          </a>
        </p>
      </Section>

      {wantsImage && (
        <Section title="Image">
          <ImageControls slide={slide} format={detail.format} businessId={detail.businessId} media={media} onChange={onChange} onUploaded={onUploaded} />
        </Section>
      )}

      <Section title="Content" count={slide.blocks.length}>
        <BlockList blocks={slide.blocks} onChange={setBlocks} selectedTarget={selectedTarget} onSelectTarget={onSelectTarget} />
      </Section>

      <Section title="Alternatives">
        <AlternativesSection slide={slide} detail={detail} media={media} kit={kit} onChange={onChange} />
      </Section>

      <div className="insp-danger">
        <button className="btn danger sm" onClick={onDelete}>
          Delete this {detail.type === 'story' ? 'frame' : 'slide'}
        </button>
      </div>
    </div>
  );
}

/**
 * Version history (G9): snapshots saved automatically before AI drafts, polish
 * and restores, on every export, and manually. Restoring snapshots the current
 * state first, so nothing is ever lost — and the restore itself is undoable.
 */
function HistoryModal({
  projectId,
  onClose,
  onRestored,
}: {
  projectId: string;
  onClose: () => void;
  onRestored: (slides: Slide[]) => void;
}) {
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listProjectVersions(projectId);
      setVersions(r.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const saveNow = async () => {
    setBusy('save');
    setError(null);
    try {
      await saveProjectVersion(projectId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (versionId: string) => {
    setBusy(versionId);
    setError(null);
    try {
      const project = await restoreProjectVersion(projectId, versionId);
      onRestored(project.slides);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Version history" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Version history</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Snapshots are saved before AI drafts, polish and restores, and on every export. Restoring
          keeps the current state as its own snapshot — nothing is ever lost.
        </p>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        {versions === null ? (
          <p className="muted">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="muted">No snapshots yet — export, run an AI action, or save one now.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto' }}>
            {versions.map((v) => (
              <div
                key={v._id}
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{v.label}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {new Date(v.createdAt).toLocaleString()} · {v.slideCount} {v.slideCount === 1 ? 'slide' : 'slides'}
                  </div>
                </div>
                <button className="btn sm" onClick={() => restore(v._id)} disabled={busy !== null}>
                  {busy === v._id ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          <button className="btn sm" onClick={saveNow} disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : '+ Save current version'}
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-slide layout alternatives (G6): one AI call proposes 3 structures for the
 * SAME copy (the server merges structure onto the original blocks, so the text
 * can't drift). Applying is a normal undoable slide mutation.
 */
function AlternativesSection({
  slide,
  detail,
  media,
  kit,
  onChange,
}: {
  slide: Slide;
  detail: ProjectDetail;
  media: MediaAsset[];
  kit: RenderBrandKit;
  onChange: (fn: (s: Slide) => Slide) => void;
}) {
  const [alts, setAlts] = useState<Slide[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAlts = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await getSlideAlternatives(detail._id, slide.id);
      setAlts(r.alternatives);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = (alt: Slide) =>
    onChange((s) => ({
      ...s,
      layoutType: alt.layoutType,
      blocks: alt.blocks,
      imageNeed: alt.imageNeed,
      overrides: alt.overrides,
    }));

  return (
    <div>
      {alts && alts.length > 0 && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          {alts.map((alt, i) => (
            <button
              key={i}
              onClick={() => apply(alt)}
              title="Apply this layout (undoable)"
              style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'none' }}
            >
              <ScaledSlide format={detail.format} displayWidth={92}>
                <SlideRenderer
                  slide={alt}
                  brandKit={kit}
                  format={detail.format}
                  image={resolveSlideImage(alt, media)}
                  imageLayout={resolveImageLayout(alt, media)}
                  theme={alt.overrides?.theme}
                  forExport
                />
              </ScaledSlide>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
      )}
      <button className="btn sm" onClick={fetchAlts} disabled={busy}>
        {busy ? 'Designing…' : alts ? '↻ New alternatives' : '✦ Suggest 3 layouts'}
      </button>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        Same copy, different structure — click one to apply it (undo brings the old layout back).
      </p>
    </div>
  );
}

function BlockList({
  blocks,
  onChange,
  selectedTarget,
  onSelectTarget,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  selectedTarget?: string | null;
  onSelectTarget?: (id: string | null) => void;
}) {
  const [addType, setAddType] = useState<BlockType>('paragraph');

  const update = (i: number, fn: (b: Block) => Block) =>
    onChange(blocks.map((b, idx) => (idx === i ? fn(b) : b)));
  const remove = (i: number) => onChange(blocks.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    const block: Block = isListBlock(addType)
      ? { type: addType, text: '', items: [''] }
      : { type: addType, text: '' };
    onChange([...blocks, block]);
  };
  const changeType = (i: number, type: BlockType) =>
    update(i, (b) => {
      if (isListBlock(type)) return { type, text: '', items: b.items?.length ? b.items : [''] };
      return { type, text: b.text || (b.items?.join(', ') ?? '') };
    });

  return (
    <div>
      {blocks.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No blocks yet.</p>}
      {blocks.map((b, i) => (
        <div
          className={`block-card ${selectedTarget === `b${i}` ? 'selected' : ''}`}
          key={i}
          onPointerDown={() => onSelectTarget?.(`b${i}`)}
        >
          <div className="block-head">
            <select value={b.type} onChange={(e) => changeType(i, e.target.value as BlockType)}>
              {BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BLOCK_LABELS[t]}
                </option>
              ))}
            </select>
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              ↑
            </button>
            <button
              className="icon-btn"
              disabled={i === blocks.length - 1}
              onClick={() => move(i, 1)}
              title="Move down"
            >
              ↓
            </button>
            <button className="icon-btn danger" onClick={() => remove(i)} title="Remove block" aria-label="Remove block">
              ✕
            </button>
          </div>
          {isListBlock(b.type) ? (
            <ListItemsEditor
              items={b.items ?? []}
              onChange={(items) => update(i, (bl) => ({ ...bl, items }))}
            />
          ) : (
            <textarea
              value={b.text}
              placeholder={`${BLOCK_LABELS[b.type]} text…`}
              onChange={(e) => update(i, (bl) => ({ ...bl, text: e.target.value }))}
            />
          )}
        </div>
      ))}

      <div className="row" style={{ marginTop: 4 }}>
        <select value={addType} onChange={(e) => setAddType(e.target.value as BlockType)} style={{ flex: 1 }}>
          {BLOCK_TYPES.map((t) => (
            <option key={t} value={t}>
              {BLOCK_LABELS[t]}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={add}>
          + Add block
        </button>
      </div>
    </div>
  );
}

function ListItemsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div>
      {items.map((it, i) => (
        <div className="row" key={i} style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
          <input
            value={it}
            placeholder={`Item ${i + 1}`}
            onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))}
          />
          <button
            className="icon-btn danger"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            title="Remove item"
            aria-label="Remove list item"
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => onChange([...items, ''])}>
        + Add item
      </button>
    </div>
  );
}

const SPLIT_LABELS: Record<SplitPlacement, string> = {
  'image-left': 'Image left',
  'image-right': 'Image right',
  'image-top': 'Image top',
  'image-bottom': 'Image bottom',
};
const ASPECT_LABELS: Record<ImageAspect, string> = {
  square: 'Square',
  landscape: 'Landscape',
  wide: 'Wide',
  portrait: 'Portrait',
};
const SIZE_LABELS: Record<ImageSizePreset, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

function ImageControls({
  slide,
  format,
  businessId,
  media,
  onChange,
  onUploaded,
}: {
  slide: Slide;
  format: Format;
  businessId: string;
  media: MediaAsset[];
  onChange: (fn: (s: Slide) => Slide) => void;
  onUploaded: (asset: MediaAsset) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = media.find((m) => m._id === slide.mediaAssetId) ?? null;
  // Keep generated brand backgrounds, harvested site photos and user uploads
  // independent in the picker.
  const sitePhotos = media.filter((m) => m.label === 'From your website');
  const stockPhotos = media.filter((m) => m.label === 'Stock photo');
  const uploads = media.filter(
    (m) => m.type !== 'generated' && m.label !== 'From your website' && m.label !== 'Stock photo',
  );
  const brandBgs = media.filter((m) => m.type === 'generated');

  const setOverride = (patch: Partial<SlideOverrides>) =>
    onChange((s) => ({ ...s, overrides: { ...s.overrides, ...patch } }));
  const defaultSplit: SplitPlacement = format === '1080x1920' ? 'image-top' : 'image-left';
  const ov = slide.overrides;

  // Attach an image to the slide. On a free slide that isn't using a full-bleed
  // background, give it a default draggable region so the image actually appears.
  const attachImage = (mediaAssetId: string) =>
    onChange((s) => {
      const overrides =
        isFreeLayout(s.layoutType) && !s.overrides?.imageBackground && !s.overrides?.imageFrame
          ? { ...s.overrides, imageFrame: { x: 0.1, y: 0.28, w: 0.8, h: 0.44 } }
          : s.overrides;
      return { ...s, mediaAssetId, imageNeed: 'upload', overrides };
    });

  // FreePosition: multiple positioned image objects, each with its own media.
  const objects = ov?.imageObjects ?? [];
  const objFileRef = useRef<HTMLInputElement>(null);
  const [objTarget, setObjTarget] = useState<number | 'new' | null>(null);
  const setObjects = (next: ImageObject[]) => setOverride({ imageObjects: next });
  const onPickObject = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const asset = await uploadMedia(businessId, file);
      onUploaded(asset);
      if (objTarget === 'new' || objTarget == null) {
        setObjects([
          ...objects,
          { id: crypto.randomUUID(), mediaAssetId: asset._id, frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.4 }, fit: 'cover' },
        ]);
      } else {
        setObjects(objects.map((o, i) => (i === objTarget ? { ...o, mediaAssetId: asset._id } : o)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setObjTarget(null);
    }
  };

  // Full-bleed background image, independent of the region image + objects.
  const bgAssetId = ov?.backgroundMediaAssetId;
  const bgAsset = bgAssetId ? media.find((m) => m._id === bgAssetId) : undefined;
  const bgFileRef = useRef<HTMLInputElement>(null);
  const setBackground = (id: string | undefined) =>
    onChange((s) => {
      const overrides = { ...s.overrides };
      if (id) overrides.backgroundMediaAssetId = id;
      else delete overrides.backgroundMediaAssetId;
      return { ...s, overrides };
    });
  const onPickBackground = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const asset = await uploadMedia(businessId, file);
      onUploaded(asset);
      setBackground(asset._id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const asset = await uploadMedia(businessId, file);
      onUploaded(asset);
      attachImage(asset._id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setFocal = (x: number, y: number) =>
    onChange((s) => ({ ...s, overrides: { ...s.overrides, focalPoint: { x, y } } }));

  const treatment: ImageTreatment = slide.overrides?.imageTreatment ?? 'none';
  const setTreatment = (t: ImageTreatment) =>
    onChange((s) => ({ ...s, overrides: { ...s.overrides, imageTreatment: t } }));

  return (
    <div>
      {err && <div className="error-box" style={{ fontSize: 13 }}>{err}</div>}

      {current ? (
        <>
          <FocalPicker
            url={current.url}
            focal={slide.overrides?.focalPoint}
            onSet={setFocal}
          />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <span className="muted" style={{ fontSize: 11 }}>
              Drag to set the focal point — kept in view when cropped. (focal{' '}
              {Math.round((slide.overrides?.focalPoint?.x ?? 0.5) * 100)}% ·{' '}
              {Math.round((slide.overrides?.focalPoint?.y ?? 0.5) * 100)}%)
            </span>
            <button className="icon-btn" title="Reset focal point to center" onClick={() => setFocal(0.5, 0.5)} style={{ width: 'auto', padding: '0 8px' }}>
              ⟲
            </button>
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Zoom (crop)</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={slide.overrides?.imageZoom ?? 1}
              onChange={(e) => setOverride({ imageZoom: Number(e.target.value) })}
              style={{ flex: 1, width: 'auto', padding: 0 }}
              aria-label="Image zoom"
            />
            <span className="muted" style={{ fontSize: 11, width: 32, textAlign: 'right' }}>
              {(slide.overrides?.imageZoom ?? 1).toFixed(1)}×
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 11 }}>Cohesion</span>
            <div className="row" style={{ gap: 4, marginTop: 4 }}>
              {(['none', 'tint', 'duotone'] as ImageTreatment[]).map((t) => (
                <button
                  key={t}
                  className={`btn sm ${treatment === t ? 'primary' : 'ghost'}`}
                  onClick={() => setTreatment(t)}
                >
                  {t === 'none' ? 'Original' : t === 'tint' ? 'Brand tint' : 'Duotone'}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              Replace
            </button>
            <button
              className="btn sm ghost"
              onClick={async () => {
                if (await confirm({ message: 'Remove this image from the slide?', confirmText: 'Remove', destructive: true }))
                  onChange((s) => ({ ...s, mediaAssetId: undefined }));
              }}
            >
              Remove
            </button>
          </div>
        </>
      ) : (
        <div className="empty" style={{ padding: 16 }}>
          {busy ? 'Uploading…' : 'No image attached.'}
          <div style={{ marginTop: 10 }}>
            <button className="btn sm primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              Upload image
            </button>
          </div>
        </div>
      )}

      {(slide.layoutType === 'SplitImageText' ||
        slide.layoutType === 'CenteredHero' ||
        isFreeLayout(slide.layoutType)) && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {isFreeLayout(slide.layoutType) && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>Background image (full-bleed)</span>
              <div className="row" style={{ gap: 8, marginTop: 4, alignItems: 'center' }}>
                {bgAsset ? (
                  <img src={bgAsset.url} alt="" style={{ width: 42, height: 53, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>None — sits behind the region image &amp; objects.</span>
                )}
                {bgAsset && (
                  <button className="btn sm ghost" onClick={() => setBackground(undefined)}>
                    Remove
                  </button>
                )}
                <button className="btn sm" onClick={() => bgFileRef.current?.click()} disabled={busy} style={{ marginLeft: 'auto' }}>
                  Upload
                </button>
              </div>
              {[
                { label: 'Brand backgrounds', items: brandBgs },
                { label: 'From your website', items: sitePhotos },
                { label: 'Stock photos', items: stockPhotos },
                { label: 'Your uploads', items: uploads },
              ].map((group) =>
                group.items.length > 0 ? (
                  <div key={group.label} style={{ marginTop: 6 }}>
                    <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>{group.label}</span>
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 3, paddingBottom: 2 }}>
                      {group.items.map((m) => (
                        <button
                          key={m._id}
                          onClick={() => setBackground(m._id)}
                          title={m.label ?? 'Use as background'}
                          style={{
                            flex: '0 0 auto',
                            padding: 0,
                            border: `2px solid ${bgAssetId === m._id ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: 6,
                            background: 'none',
                            cursor: 'pointer',
                            lineHeight: 0,
                          }}
                        >
                          <img src={m.url} alt="" style={{ width: 40, height: 50, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
              <input
                ref={bgFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => onPickBackground(e.target.files?.[0])}
              />

              <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 10 }}>
                Image objects
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {objects.map((o, i) => {
                  const url = o.mediaAssetId ? media.find((m) => m._id === o.mediaAssetId)?.url : undefined;
                  const crop = o.crop ?? { x: 0.5, y: 0.5, zoom: 1 };
                  const setCrop = (patch: Partial<{ x: number; y: number; zoom: number }>) =>
                    setObjects(objects.map((x, xi) => (xi === i ? { ...x, crop: { ...crop, ...patch } } : x)));
                  const cover = (o.fit ?? 'cover') === 'cover';
                  return (
                    <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 6, border: '1px solid var(--border)', borderRadius: 8 }}>
                      <div className="row" style={{ gap: 5, alignItems: 'center' }}>
                        {url ? (
                          <img src={url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                        ) : (
                          <div style={{ width: 34, height: 34, borderRadius: 6, border: '1px dashed var(--border)' }} />
                        )}
                        <span className="muted" style={{ fontSize: 12, flex: 1 }}>Image {i + 1}</span>
                        <button className={`btn sm ${cover ? 'primary' : 'ghost'}`} onClick={() => setObjects(objects.map((x, xi) => (xi === i ? { ...x, fit: 'cover' } : x)))} title="Crop to fill">
                          Fill
                        </button>
                        <button className={`btn sm ${o.fit === 'contain' ? 'primary' : 'ghost'}`} onClick={() => setObjects(objects.map((x, xi) => (xi === i ? { ...x, fit: 'contain' } : x)))} title="Show the whole image">
                          Fit
                        </button>
                        <button className="btn sm ghost" onClick={() => { setObjTarget(i); objFileRef.current?.click(); }} disabled={busy}>
                          Replace
                        </button>
                        <button className="icon-btn danger" title="Remove this image" onClick={() => setObjects(objects.filter((_, xi) => xi !== i))}>
                          ✕
                        </button>
                      </div>
                      {url && cover && (
                        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                          <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Zoom</span>
                          <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.05}
                            value={crop.zoom}
                            onChange={(e) => setCrop({ zoom: Number(e.target.value) })}
                            style={{ flex: 1, width: 'auto', padding: 0 }}
                            aria-label={`Image ${i + 1} zoom`}
                          />
                          <span className="muted" style={{ fontSize: 11, width: 30, textAlign: 'right' }}>{crop.zoom.toFixed(1)}×</span>
                        </div>
                      )}
                      {url && cover && crop.zoom > 1 && (
                        <div>
                          <FocalPicker url={url} focal={{ x: crop.x, y: crop.y }} onSet={(x, y) => setCrop({ x, y })} />
                          <span className="muted" style={{ fontSize: 11 }}>Drag to pan the crop.</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button className="btn sm" onClick={() => { setObjTarget('new'); objFileRef.current?.click(); }} disabled={busy}>
                  + Add image
                </button>
                <span className="muted" style={{ fontSize: 11 }}>Added images appear on the canvas — drag and resize them.</span>
              </div>
              <input
                ref={objFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => onPickObject(e.target.files?.[0])}
              />
            </>
          )}
          {slide.layoutType === 'SplitImageText' && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>Split</span>
              <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {SPLIT_PLACEMENTS.map((p) => (
                  <button
                    key={p}
                    className={`btn sm ${(ov?.split ?? defaultSplit) === p ? 'primary' : 'ghost'}`}
                    onClick={() => setOverride({ split: p })}
                  >
                    {SPLIT_LABELS[p]}
                  </button>
                ))}
              </div>
            </>
          )}
          {slide.layoutType === 'CenteredHero' && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>Image aspect</span>
              <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {IMAGE_ASPECTS.map((a) => (
                  <button
                    key={a}
                    className={`btn sm ${(ov?.imageAspect ?? 'square') === a ? 'primary' : 'ghost'}`}
                    onClick={() => setOverride({ imageAspect: a })}
                  >
                    {ASPECT_LABELS[a]}
                  </button>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>Image size</span>
              <div className="row" style={{ gap: 4, marginTop: 4 }}>
                {IMAGE_SIZES.map((sz) => (
                  <button
                    key={sz}
                    className={`btn sm ${(ov?.imageSize ?? 'md') === sz ? 'primary' : 'ghost'}`}
                    onClick={() => setOverride({ imageSize: sz })}
                  >
                    {SIZE_LABELS[sz]}
                  </button>
                ))}
              </div>
            </>
          )}
          <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>Image fit</span>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            {(['cover', 'contain'] as const).map((f) => (
              <button
                key={f}
                className={`btn sm ${(ov?.imageFit ?? 'cover') === f ? 'primary' : 'ghost'}`}
                onClick={() => setOverride({ imageFit: f })}
                title={f === 'contain' ? 'Show the whole image (good for app screenshots)' : 'Crop to fill the frame'}
              >
                {f === 'cover' ? 'Fill' : 'Fit (whole image)'}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        style={{ display: 'none' }}
        onChange={(e) => onPick(e.target.files?.[0])}
      />

      {[
        { label: 'From your website', items: sitePhotos },
        { label: 'Stock photos', items: stockPhotos },
        { label: 'Your uploads', items: uploads },
        { label: 'Brand backgrounds', items: brandBgs },
      ].map((group) =>
        group.items.length > 0 ? (
          <div key={group.label}>
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>{group.label}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {group.items.slice(0, 8).map((m) => (
                <img
                  key={m._id}
                  src={m.url}
                  alt={m.label ?? ''}
                  title={m.label ?? ''}
                  onClick={() => attachImage(m._id)}
                  style={{
                    width: 46,
                    height: 46,
                    objectFit: 'cover',
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: m._id === slide.mediaAssetId ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                />
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

function FocalPicker({
  url,
  focal,
  onSet,
}: {
  url: string;
  focal?: { x: number; y: number };
  onSet: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fx = focal?.x ?? 0.5;
  const fy = focal?.y ?? 0.5;

  const apply = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    onSet(Number(x.toFixed(3)), Number(y.toFixed(3)));
  };

  return (
    <div
      ref={ref}
      className="focal"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) apply(e.clientX, e.clientY); // dragging with primary button
      }}
    >
      <img src={url} alt="" draggable={false} />
      <span className="dot" style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }} />
    </div>
  );
}
