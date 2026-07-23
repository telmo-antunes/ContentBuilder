'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { LayoutType, MediaAsset, Slide } from '@contentbuilder/shared';
import {
  isFreeLayout,
  FORMAT_LABELS,
  LAYOUT_LABELS,
  MAX_SLIDES_PER_PROJECT,
  THEME_PRESETS,
  dimensionsFor,
  safeAreaFor,
  type ProjectSettings,
  type ThemePreset,
  type BlockFrame,
  type SlideDecoration,
} from '@contentbuilder/shared';
import {
  getProject,
  updateProject,
  getShareInfo,
  polishProject,
  type ProjectDetail,
} from '../../lib/api';
import { api } from '../../lib/config';
import { SlideRenderer } from '../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../lib/render/SlideFrame';
import { FreeCanvasOverlay } from './FreeCanvasOverlay';
import { confirm } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { useStagedProgress, POLISH_STAGES } from '../../components/useStagedProgress';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../../../lib/render/projectRender';
import type { RenderBrandKit } from '../../../lib/render/types';
import { newSlide, slideMissingImage, uid, type SaveState } from './_editor/lib';
import { EmptyProject, RailThumb, SaveBadge } from './_editor/primitives';
import { CaptionPanel, SlideInspector } from './_editor/panels';
import { HistoryModal, PreviewOverlay, ShareLinkRow } from './_editor/modals';

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
  const [showDisplay, setShowDisplay] = useState(false);
  const [shareInfo, setShareInfo] = useState<{ url: string; onLan: boolean } | null>(null);
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
      toast(`Exported ${slides.length} slide${slides.length === 1 ? '' : 's'} — ZIP downloaded`);
      setTimeout(() => setExported(false), 2500);
      // Offer the phone hand-off for the freshly exported set (best-effort).
      getShareInfo(id)
        .then((info) => setShareInfo({ url: info.url, onLan: info.onLan }))
        .catch(() => {});
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
          <Link href="/">← Studio</Link>
        </p>
        <div className="error-box">{error}</div>
      </div>
    );
  }
  if (!detail || !selected) {
    return (
      <div>
        <p className="muted">
          <Link href="/">← Studio</Link>
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
      <p className="muted" style={{ marginBottom: 6, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link href={`/businesses/${detail.businessId}`}>← Back to brand</Link>
        <Link href={`/projects/${detail._id}/review`}>Review ↗</Link>
      </p>
      <div className="editor-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--display)', width: '100%', maxWidth: 520 }}
          />
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {detail.type} · {FORMAT_LABELS[detail.format]} · <SaveBadge state={saveState} onRetry={retrySave} />
          </div>
        </div>
        <div className="editor-actions">
          {/* Quiet icon cluster: frequent-but-secondary actions stay small. */}
          <button className="btn sm icon-only" onClick={undo} disabled={!canUndo} title="Undo (⌘/Ctrl+Z)" aria-label="Undo">
            ↶
          </button>
          <button className="btn sm icon-only" onClick={redo} disabled={!canRedo} title="Redo (⌘/Ctrl+Shift+Z)" aria-label="Redo">
            ↷
          </button>
          <button
            className="btn sm icon-only"
            onClick={() => setShowHistory(true)}
            title="Version history — snapshots before AI actions and on every export"
            aria-label="Version history"
          >
            ⏱
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className={`btn sm icon-only ${showDisplay ? 'primary' : ''}`}
              onClick={() => setShowDisplay((v) => !v)}
              title="Display settings — theme & slide numbers"
              aria-label="Display settings"
              aria-expanded={showDisplay}
            >
              ⚙
            </button>
            {showDisplay && (
              <>
                {/* Click-away backdrop — the popover closes like a menu. */}
                <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setShowDisplay(false)} />
                <div className="popover" role="dialog" aria-label="Display settings">
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Theme</label>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <select
                    value={theme}
                    onChange={(e) => setSettings((s) => ({ ...s, theme: e.target.value as ThemePreset }))}
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
                      onClick={applyThemeToAll}
                      title="Some slides override the theme. Clear those overrides so every slide uses this theme."
                    >
                      Apply to all
                    </button>
                  )}
                </div>
                {detail.type === 'carousel' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0 0', cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(settings.slideCounter)}
                      onChange={(e) => setSettings((s) => ({ ...s, slideCounter: e.target.checked }))}
                      style={{ width: 'auto' }}
                    />
                    Slide numbers ("1 / N")
                  </label>
                )}
                </div>
              </>
            )}
          </div>
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
            className="btn sm icon-only"
            onClick={() =>
              void getShareInfo(id)
                .then((info) => setShareInfo({ url: info.url, onLan: info.onLan }))
                .catch((e) => toast(e instanceof Error ? e.message : String(e)))
            }
            disabled={slides.length === 0}
            title="Share a link — interactive preview, or post from your phone"
            aria-label="Share"
          >
            🔗
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
                <span className="thumb-actions">
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

      {shareInfo && (
        <div className="modal-overlay" onClick={() => setShareInfo(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Share" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Share this post</h2>

            {/* Interactive preview — works right now, no export needed. */}
            <div className="section-label" style={{ marginTop: 0 }}>Interactive preview</div>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              A live, swipeable link — whoever opens it experiences the {detail.type === 'story' ? 'story' : 'carousel'} exactly
              as it&rsquo;ll appear, with the caption. Works before you export.
            </p>
            <ShareLinkRow url={shareInfo.url.replace('/share/', '/preview/')} onCopy={() => toast('Preview link copied')} />

            {/* Post-from-phone — needs an export first. */}
            <div className="section-label" style={{ marginTop: 16 }}>📲 Post from your phone</div>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Open on your phone{shareInfo.onLan ? ' (same Wi-Fi)' : ''} for a one-tap <strong>Share to Instagram</strong>
              {' '}with the caption copied. Needs an export first.
            </p>
            <ShareLinkRow url={shareInfo.url} onCopy={() => toast('Phone link copied')} />

            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShareInfo(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <HistoryModal
          projectId={id}
          onClose={() => setShowHistory(false)}
          onRestored={(restored) => {
            snapshot();
            setSlides(restored);
            setSelectedId(restored[0]?.id ?? null);
            setShowHistory(false);
            toast('Version restored — undo brings the previous state back');
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
