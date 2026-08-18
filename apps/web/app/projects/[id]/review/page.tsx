'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  FORMAT_LABELS,
  MAX_SLIDE_DIRECTION_CHARS,
  authoredSlots,
  contrastRatio,
  VIDEO_SECONDS_DEFAULT,
  VIDEO_SECONDS_MAX,
  VIDEO_SECONDS_MIN,
  clampVideoSeconds,
  dimensionsFor,
  recipeAmbient,
  type BlockFrame,
  type BrandRecipe,
  type Format,
  type MediaAsset,
  type Slide,
  type SlidePhoto,
} from '@contentbuilder/shared';
import {
  cancelVideoExport,
  generateProjectCaption,
  getHealth,
  getProject,
  updateProject,
  getShareInfo,
  getSlideVariants,
  noteSlideChoice,
  rewriteSlideCopy,
  listProjectVersions,
  restoreProjectVersion,
  saveProjectVersion,
  saveSlidePhotos,
  tweakSlide,
  type ProjectDetail,
  type ProjectVersion,
} from '../../../lib/api';
import { api } from '../../../lib/config';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import {
  toRenderKit,
  resolveSlidePhotos,
} from '../../../../lib/render/projectRender';
import { parseAuthored, buildAuthored, type AuthoredEl, type AuthoredRow } from '../../../../lib/authoredEdit';
import { toast } from '../../../components/Toast';
import { confirm } from '../../../components/ConfirmDialog';
import { ErrorState } from '../../../components/ErrorState';
import { Icon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import DeckScroller from '../../../components/DeckScroller';
import PromptUpdates from '../../../components/PromptUpdates';
import SlidePhotoPanel from '../../../components/SlidePhotoPanel';
import FreeImageOverlay from '../../../components/FreeImageOverlay';
import CanvasCopyEditor from '../../../components/CanvasCopyEditor';


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
  /** The element selected on EITHER edit surface — canvas or inspector list. */
  const [canvasEl, setCanvasEl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Slides whose composition exceeds the canvas — surfaced so a broken export
  // can't ship silently (authored slides had no text-fit guard at all).
  const [overflow, setOverflow] = useState<Record<string, boolean>>({});
  // Alternative arrangements for the selected slide — shown side by side, applied
  // only on click, so a single weak slide no longer means re-composing the deck.
  const [variants, setVariants] = useState<Array<{ html: string; bg?: string; role?: string }> | null>(null);
  /**
   * Which question produced the candidates on screen. An ARRANGEMENT swap keeps
   * every word, so nothing in the saved deck records that a composition was
   * rejected — it has to be reported explicitly. A COPY rewrite needs no such
   * help: the words changed, and the save-time diff sees that by itself.
   */
  const [variantKind, setVariantKind] = useState<'arrangement' | 'copy'>('arrangement');
  /**
   * A direction for the SELECTED slide — the per-slide half of the brief
   * language. Empty asks for a rearrangement of the copy already there; filled,
   * the copywriter rewrites this slide alone, keeping anything in "quotes"
   * exactly. Cleared whenever the selection moves, since it belongs to a slide.
   */
  const [direction, setDirection] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  /** The floating image currently grabbable on the preview. */
  const [freeSel, setFreeSel] = useState<string | null>(null);
  /** Whether the AI caption writer is configured (gates "Regenerate"). */
  const [aiReady, setAiReady] = useState(false);
  // The caption editor's working copy — kept apart from the project so typing
  // doesn't thrash the whole tree, synced back whenever the server answers.
  const [capText, setCapText] = useState('');
  const [capTags, setCapTags] = useState('');
  const [capDirty, setCapDirty] = useState(false);
  const [capBusy, setCapBusy] = useState<'save' | 'regen' | null>(null);

  /**
   * Image/copy contradictions — questions, never blocks. Two of three pictures
   * in a real build illustrated the opposite of their slide, both chosen
   * deliberately, because nothing in the tool read the pairing.
   */
  const [pairBusy, setPairBusy] = useState(false);
  const [pairing, setPairing] = useState<
    { contradictions: Array<{ slide: number; says: string; shows: string; question: string }>; checked: number } | null
  >(null);
  // Version history drawer.
  const [histOpen, setHistOpen] = useState(false);
  const [histVersions, setHistVersions] = useState<ProjectVersion[] | null>(null);
  const [histLabel, setHistLabel] = useState('');
  const [histBusy, setHistBusy] = useState<string | null>(null);
  /** The LAN /share link surfaced after a PNG export ("Send to phone"). */
  const [phoneShare, setPhoneShare] = useState<string | null>(null);
  /** The running video job, so the Cancel button can reach it. */
  const [videoJob, setVideoJob] = useState<string | null>(null);
  /** Seconds each slide holds in a video export. */
  const [videoSeconds, setVideoSeconds] = useState(VIDEO_SECONDS_DEFAULT);
  const [exportOpen, setExportOpen] = useState(false);
  const videoCancelRef = useRef(false);

  /**
   * Persist a slide's photos. Applied to local state FIRST so the preview moves
   * with the pointer, then written — a drag that waited on the network would
   * feel broken. A failed write reloads the project so what you see is the
   * truth rather than an optimistic lie.
   */
  /**
   * An export is a photograph of one moment: the job snapshots the post when it
   * starts, so an edit made mid-render would silently NOT appear in the file.
   * Rather than let that confuse you, the post is read-only until the job ends —
   * which is also what you expected the app to do.
   */
  const frozen = exporting !== null;
  /**
   * Slides the render check already knows are clipped. The badge warned in the
   * editor, but nothing stood between a known-broken slide and the finished
   * file — so the one moment it matters said nothing at all.
   */
  /**
   * Which slides a newer copywriter or composer would change, and why — the
   * server's per-slide verdict, keyed for the deck cards. The rule that keeps
   * it quiet lives in the API: a slide appears here only when the post is
   * behind AND a detector found the specific thing in THIS slide.
   */
  const staleSlides = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const s of project?.promptUpdates?.slides ?? []) m[s.id] = s.reasons;
    return m;
  }, [project]);

  const overflowCount = useMemo(
    () => (project?.slides ?? []).filter((s) => overflow[s.id]).length,
    [project, overflow],
  );
  const refuseWhileExporting = useCallback((): boolean => {
    if (!frozen) return false;
    toast('This post is being exported — it will be editable again in a moment.');
    return true;
  }, [frozen]);

  const savePhotos = useCallback(
    async (slideId: string, photos: SlidePhoto[], uploaded?: MediaAsset) => {
      if (refuseWhileExporting()) return;
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
    [projectId, refuseWhileExporting],
  );

  const load = useCallback(() => {
    setError(null);
    getProject(projectId)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load project'));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getHealth()
      .then((h) => setAiReady(Boolean(h.ai?.draft)))
      .catch(() => setAiReady(false));
  }, []);

  // Mirror the saved caption into the editor whenever the server state changes,
  // unless the user is mid-edit — their typing must never be clobbered.
  useEffect(() => {
    if (!project || capDirty) return;
    setCapText(project.caption?.text ?? '');
    setCapTags((project.caption?.hashtags ?? []).join(' '));
  }, [project, capDirty]);

  // ── Authored-slide editing ────────────────────────────────────────────────
  const startEdit = useCallback((slide: Slide) => {
    setEditId(slide.id);
    setEditEls(parseAuthored(slide.authored?.html ?? ''));
    setCanvasEl(null);
  }, []);
  const cancelEdit = useCallback(() => {
    setEditId(null);
    setEditEls([]);
    setCanvasEl(null);
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

  // ── enumeration rows ──────────────────────────────────────────────────
  const patchRow = useCallback((elKey: string, rowKey: string, patch: Partial<AuthoredRow>) => {
    setEditEls((els) =>
      els.map((e) =>
        e.key === elKey
          ? { ...e, rows: (e.rows ?? []).map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) }
          : e,
      ),
    );
  }, []);
  const removeRow = useCallback((elKey: string, rowKey: string) => {
    setEditEls((els) =>
      els.map((e) => (e.key === elKey ? { ...e, rows: (e.rows ?? []).filter((r) => r.key !== rowKey) } : e)),
    );
  }, []);
  const addRow = useCallback((elKey: string) => {
    setEditEls((els) =>
      els.map((e) =>
        e.key === elKey
          ? { ...e, rows: [...(e.rows ?? []), { key: `nr${Date.now()}${(e.rows ?? []).length}`, text: '' }] }
          : e,
      ),
    );
  }, []);

  const saveEdit = useCallback(
    async (allSlides: Slide[]) => {
      if (!editId || refuseWhileExporting()) return;
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
        setCanvasEl(null);
      } catch {
        toast('Could not save the slide', 'error');
      } finally {
        setSaving(false);
      }
    },
    [editId, editEls, projectId, refuseWhileExporting],
  );

  // Canvas → list sync: selecting an element on the slide brings its row in
  // the inspector list into view (the highlight itself is a class, below).
  useEffect(() => {
    if (!canvasEl || !editId) return;
    document.querySelector(`[data-aed-key="${canvasEl}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [canvasEl, editId]);

  // A direction and its candidates belong to ONE slide. Moving the selection
  // must not leave last slide's instruction pointed at this one.
  useEffect(() => {
    setDirection('');
    setVariants(null);
  }, [sel]);

  /**
   * Ask for alternatives for the selected slide.
   *
   * With no direction this is what it has always been — the same copy, arranged
   * differently. With one, the copywriter rewrites THIS slide alone from the
   * instruction, and anything typed in "quotes" is used word for word. Either
   * way nothing is saved until a candidate is applied.
   */
  const askVariants = useCallback(
    async (slideId: string, direction?: string) => {
      setWorking('variants');
      setVariants(null);
      // A direction makes this a rewrite, whatever button was pressed.
      setVariantKind(direction?.trim() ? 'copy' : 'arrangement');
      try {
        const res = await getSlideVariants(projectId, slideId, 2, direction);
        setVariants(res.variants);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not get alternatives', 'error');
      } finally {
        setWorking(null);
      }
    },
    [projectId],
  );

  /**
   * The inverse: keep this arrangement, change the words. No composer runs, so
   * the layout you liked comes back byte-identical apart from the copy.
   */
  const askRewrite = useCallback(
    async (slideId: string, direction?: string) => {
      setWorking('rewrite');
      setVariants(null);
      setVariantKind('copy');
      try {
        const res = await rewriteSlideCopy(projectId, slideId, 2, direction);
        setVariants(res.variants);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not rewrite the copy', 'error');
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
        // AFTER the save, so the outcome diff has already run over the new deck
        // and this only adds the one thing the diff could not have seen.
        void noteSlideChoice(projectId, slideId, variantKind);
        toast(variantKind === 'copy' ? 'New copy applied' : 'Arrangement applied', 'ok');
      } catch {
        toast('Could not apply that', 'error');
      } finally {
        setWorking(null);
      }
    },
    [projectId, variantKind],
  );

  /** Instant deterministic tweaks — no AI, no waiting. */
  const applyTweak = useCallback(
    async (slideId: string, tweak: 'bigger-headline' | 'smaller-headline' | 'invert' | 'un-invert') => {
      if (refuseWhileExporting()) return;
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
    [projectId, refuseWhileExporting],
  );

  /**
   * Move a slide left/right in the deck. Optimistic — the deck reorders under
   * the pointer — with a rollback to the previous order if the write fails.
   */
  const moveSlide = useCallback(
    async (from: number, dir: -1 | 1) => {
      if (!project) return;
      const sorted = [...project.slides].sort((a, b) => a.order - b.order);
      const to = from + dir;
      if (to < 0 || to >= sorted.length) return;
      const next = [...sorted];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      const renumbered = next.map((s, i) => ({ ...s, order: i }));
      const prevSlides = project.slides;
      setProject((p) => (p ? { ...p, slides: renumbered } : p));
      setSel(to); // selection follows the slide you moved
      try {
        const updated = await updateProject(projectId, { slides: renumbered as Slide[] });
        setProject((p) => (p ? { ...p, slides: updated.slides } : p));
      } catch {
        setProject((p) => (p ? { ...p, slides: prevSlides } : p));
        setSel(from);
        toast('Could not reorder — the deck was put back', 'error');
      }
    },
    [project, projectId],
  );

  // ── Caption ───────────────────────────────────────────────────────────────
  /** "#one two,#three" → ['#one','#two','#three'] — loose in, tidy out. */
  const parseTags = (raw: string) =>
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .slice(0, 30);

  const saveCaption = useCallback(async () => {
    setCapBusy('save');
    try {
      const updated = await updateProject(projectId, {
        caption: { text: capText, hashtags: parseTags(capTags) },
      });
      setProject((p) => (p ? { ...p, caption: updated.caption } : p));
      setCapDirty(false);
      toast('Caption saved', 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the caption', 'error');
    } finally {
      setCapBusy(null);
    }
  }, [projectId, capText, capTags]);

  const checkImageCopy = useCallback(async () => {
    setPairBusy(true);
    try {
      const res = await fetch(api(`/projects/${projectId}/image-copy-check`), { method: 'POST' });
      setPairing(await res.json());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not check the images', 'error');
    } finally {
      setPairBusy(false);
    }
  }, [projectId, toast]);

  const regenCaption = useCallback(async () => {
    setCapBusy('regen');
    try {
      const updated = await generateProjectCaption(projectId);
      setProject((p) => (p ? { ...p, caption: updated.caption } : p));
      setCapText(updated.caption?.text ?? '');
      setCapTags((updated.caption?.hashtags ?? []).join(' '));
      setCapDirty(false);
      toast('Caption rewritten in the brand voice', 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not write a caption', 'error');
    } finally {
      setCapBusy(null);
    }
  }, [projectId]);

  // ── Version history ───────────────────────────────────────────────────────
  const refreshVersions = useCallback(async () => {
    try {
      const r = await listProjectVersions(projectId);
      setHistVersions(r.versions);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load the history', 'error');
      setHistVersions([]);
    }
  }, [projectId]);

  const openHistory = useCallback(() => {
    setHistOpen(true);
    setHistVersions(null);
    void refreshVersions();
  }, [refreshVersions]);

  const saveSnapshot = useCallback(async () => {
    setHistBusy('save');
    try {
      await saveProjectVersion(projectId, histLabel.trim() || undefined);
      setHistLabel('');
      toast('Snapshot saved', 'ok');
      await refreshVersions();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save a snapshot', 'error');
    } finally {
      setHistBusy(null);
    }
  }, [projectId, histLabel, refreshVersions]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      const ok = await confirm({
        title: 'Restore this version?',
        message: 'Restore this version? Current state is snapshotted first, so you can always come back.',
        confirmText: 'Restore',
      });
      if (!ok) return;
      setHistBusy(versionId);
      try {
        await restoreProjectVersion(projectId, versionId);
        const fresh = await getProject(projectId);
        setProject(fresh);
        setSel(0);
        setEditId(null);
        setEditEls([]);
        setCanvasEl(null);
        setVariants(null);
        toast('Version restored', 'ok');
        await refreshVersions();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not restore that version', 'error');
      } finally {
        setHistBusy(null);
      }
    },
    [projectId, refreshVersions],
  );

  /** Save a fetched blob response as a download. */
  /**
   * Hand a streamed export to the browser as a download.
   *
   * The object URL is revoked on a TIMER, not on the next line. Revoking
   * immediately after `.click()` races the browser: the download has not begun
   * reading the blob yet, so the URL dies under it and nothing is ever saved —
   * silently, because the click itself "succeeded". A PNG zip usually won that
   * race; a multi-megabyte video zip reliably lost it, which is why video
   * exports finished, said "downloaded", and produced no file.
   */
  const saveBlob = useCallback(async (res: Response, fallback: string) => {
    const blob = await res.blob();
    // An empty body is a server-side failure wearing a success costume.
    if (blob.size === 0) throw new Error('The export came back empty — nothing was saved.');
    const name =
      (res.headers.get('Content-Disposition') ?? '').match(/filename="?([^"]+)"?/)?.[1] ?? fallback;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
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
          // The export just created the renders /share needs — surface the
          // phone hand-off link now that the page has something to show.
          getShareInfo(projectId)
            .then((info) => setPhoneShare(info.shareUrl || null))
            .catch(() => {});
          return;
        }

        const start = await fetch(api(`/projects/${projectId}/export-video`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secondsPerSlide: videoSeconds }),
        });
        if (!start.ok) {
          const msg = await start.json().catch(() => null);
          throw new Error(msg?.error ?? `Video export failed (HTTP ${start.status})`);
        }
        const { jobId } = (await start.json()) as { jobId: string };
        setVideoPct(0);
        setVideoJob(jobId);
        videoCancelRef.current = false;
        toast('Rendering one video per slide…');

        /**
         * Poll until the job finishes, STALLS, or is cancelled — never on a
         * fixed clip count.
         *
         * The old loop gave up after 220 polls (5.5 minutes). A seven-slide deck
         * at ten seconds each needs longer than that to render, so the client
         * abandoned a job that was working perfectly and reported a timeout —
         * while the server carried on and finished into nothing. Progress is
         * reported for real, so the honest condition is "has it stopped moving",
         * not "has it taken a while".
         */
        let lastPct = -1;
        let stalledPolls = 0;
        const STALL_LIMIT = 120; // 3 minutes with no movement at all
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          // Cancelled from the button — it already told the server and toasted.
          if (videoCancelRef.current) return;
          const poll = await fetch(api(`/projects/${projectId}/export-video/${jobId}`));
          if (!poll.ok) {
            if (poll.status === 410) {
              throw new Error('That export has expired on the server — start a new one.');
            }
            const msg = await poll.json().catch(() => null);
            throw new Error(msg?.error ?? `Video export failed (HTTP ${poll.status})`);
          }
          const type = poll.headers.get('Content-Type') ?? '';
          // A zip (several slides) or a lone mp4 means it's finished.
          if (type.startsWith('video/') || type.includes('zip')) {
            setVideoPct(100);
            await saveBlob(poll, type.includes('zip') ? 'videos.zip' : 'project.mp4');
            toast(type.includes('zip') ? 'Slide videos downloaded' : 'Video downloaded', 'ok');
            return;
          }
          const body = (await poll.json().catch(() => null)) as
            | { state?: string; percent?: number }
            | null;
          if (body?.state === 'cancelled') {
            // Cancelled from elsewhere (another tab) — stop cleanly.
            if (!videoCancelRef.current) toast('Video export cancelled');
            return;
          }
          if (typeof body?.percent === 'number') {
            if (body.percent === lastPct) stalledPolls += 1;
            else {
              stalledPolls = 0;
              lastPct = body.percent;
            }
            setVideoPct(body.percent);
          }
          if (stalledPolls >= STALL_LIMIT) {
            throw new Error('The export stopped making progress — please try again.');
          }
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Export failed', 'error');
      } finally {
        setExporting(null);
        setVideoJob(null);
      }
    },
    [projectId, saveBlob, videoSeconds],
  );

  /** Stop the running video job: stop polling at once, then tell the server. */
  const cancelVideo = useCallback(async () => {
    if (!videoJob) return;
    videoCancelRef.current = true;
    toast('Video export cancelled');
    try {
      await cancelVideoExport(projectId, videoJob);
    } catch {
      // The poll loop has already stopped; a failed cancel just lets the
      // server-side job run to completion unobserved.
    }
  }, [projectId, videoJob]);

  /**
   * PHONE SIZE, because that is the only size that matters.
   *
   * The strip shows slides as small cards, which is the one view in which seven
   * near-identical gradient panels look fine — a deck's monotony was obvious
   * only after export, at full size. 393px is the CSS width of a typical
   * handset, so this is the post at the size it will actually be read.
   */
  const [phoneView, setPhoneView] = useState(false);
  const PHONE_W = 393;

  const share = useCallback(async () => {
    try {
      const info = await getShareInfo(projectId);
      await navigator.clipboard.writeText(info.previewUrl || info.url);
      toast('Interactive preview link copied — opens on any device on your Wi-Fi', 'ok');
    } catch {
      toast('Could not get a share link', 'error');
    }
  }, [projectId]);

  // NOTE: the layout's <main class="container container-wide"> already provides
  // the page frame — no nested .container (it doubled the padding).
  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }
  if (!project) {
    // The Studio's shape while it loads: masthead, deck strip, inspector.
    return (
      <div role="status" aria-label="Loading the studio">
        <Skeleton shape="line" w={140} h={12} style={{ marginBottom: 18 }} />
        <div className="studio">
          <div className="studio-main">
            <Skeleton shape="block" h={180} style={{ borderRadius: 20, marginBottom: 26 }} />
            <Skeleton shape="line" w={180} h={16} style={{ margin: '30px 0 16px' }} />
            <div className="row" style={{ gap: 16, flexWrap: 'nowrap', overflow: 'hidden' }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} shape="block" w={296} h={370} style={{ flex: '0 0 auto' }} />
              ))}
            </div>
          </div>
          <aside className="studio-inspector">
            <Skeleton shape="line" w={100} h={10} />
            <Skeleton shape="block" w={288} h={360} style={{ marginTop: 12 }} />
            <Skeleton shape="line" w={180} h={12} style={{ marginTop: 16 }} />
            <Skeleton shape="line" w={140} h={12} style={{ marginTop: 10 }} />
          </aside>
        </div>
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
    <div>
      {/* top bar */}
      <div className="row" style={{ alignItems: 'center', marginBottom: 18 }}>
        <Link href={`/businesses/${project.businessId}`} style={{ fontSize: 13 }}>
          ← {project.brandKit ? 'Back to brand' : 'Back'}
        </Link>
        <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          {slides.length > 0 && (
            <>
              <a className="btn" href={`/preview/${projectId}`} target="_blank" rel="noopener noreferrer">
                <Icon name="play" /> Preview
              </a>
              <button className="btn" onClick={share}>
                Share
              </button>
              <button className="btn" onClick={openHistory} title="Snapshots of this project — save one or restore an earlier state">
                <Icon name="history" /> History
              </button>
              {/* ONE export affordance. Two buttons sat side by side competing
                  for the same job; the format is a choice you make once you've
                  decided to export, not a permanent pair of controls. */}
              <div className="expw">
                <button
                  className="btn primary"
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={exporting !== null}
                  aria-expanded={exportOpen}
                  aria-haspopup="menu"
                >
                  {exporting === 'zip' ? (
                    'Exporting…'
                  ) : exporting === 'video' ? (
                    `Rendering… ${videoPct}%`
                  ) : (
                    <>
                      <Icon name="download" /> Export
                    </>
                  )}
                </button>
                {exportOpen && exporting === null && (
                  <>
                    <span className="expw-scrim" onClick={() => setExportOpen(false)} />
                    <div className="expm" role="menu">
                      {overflowCount > 0 && (
                        <p className="expm-warn">
                          <Icon name="warning" size={12} />
                          {overflowCount} slide{overflowCount === 1 ? '' : 's'} overflow the canvas and
                          will be clipped in the file. Fix {overflowCount === 1 ? 'it' : 'them'} first,
                          or export anyway.
                        </p>
                      )}
                      <button
                        className="expm-opt"
                        role="menuitem"
                        onClick={() => {
                          setExportOpen(false);
                          void runExport('zip');
                        }}
                      >
                        <Icon name="download" />
                        <span>
                          <b>Images</b>
                          <em>
                            {slides.length} PNG{slides.length === 1 ? '' : 's'} at 1080px, ready to post
                          </em>
                        </span>
                      </button>
                      {authored && (
                        <>
                          <button
                            className="expm-opt"
                            role="menuitem"
                            onClick={() => {
                              setExportOpen(false);
                              void runExport('video');
                            }}
                          >
                            <Icon name="video" />
                            <span>
                              <b>Video</b>
                              <em>
                                {slides.length} animated MP4{slides.length === 1 ? '' : 's'}, one per slide
                              </em>
                            </span>
                          </button>
                          <label className="expm-sec">
                            <span>Seconds per slide</span>
                            <input
                              type="number"
                              min={VIDEO_SECONDS_MIN}
                              max={VIDEO_SECONDS_MAX}
                              value={videoSeconds}
                              onChange={(e) => setVideoSeconds(clampVideoSeconds(e.target.value))}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {frozen && (
        <div className="expfreeze" role="status">
          <Icon name="video" size={12} />
          Exporting this post as it is now — editing is paused until it finishes, so the file
          matches what you see.
        </div>
      )}

      {/* Determinate loader — real render progress, one clip per slide. */}
      {exporting === 'video' && (
        <div className="vid-prog" role="status" aria-live="polite">
          <div className="vid-prog-top">
            <span className="lbl">
              Rendering {slides.length} slide video{slides.length === 1 ? '' : 's'}
            </span>
            <span className="row" style={{ gap: 12, alignItems: 'baseline' }}>
              {videoJob && (
                <button className="btn sm ghost" onClick={() => void cancelVideo()}>
                  <Icon name="close" size={12} /> Cancel
                </button>
              )}
              <span className="pct">{videoPct}%</span>
            </span>
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

      {/* Post-export hand-off: the /share page shows the PNGs this export just
          made, with the native share sheet — open it on a phone to post. */}
      {phoneShare && (
        <div className="sendphone" role="status">
          <Icon name="check" size={14} />
          <span className="sendphone-msg">
            Exported. To post from your phone, open{' '}
            <a href={phoneShare} target="_blank" rel="noopener noreferrer">
              {phoneShare.replace(/^https?:\/\//, '')}
            </a>{' '}
            on the same Wi-Fi.
          </span>
          <button
            className="btn sm ghost"
            onClick={() =>
              void navigator.clipboard
                .writeText(phoneShare)
                .then(() => toast('Send-to-phone link copied', 'ok'))
                .catch(() => toast('Could not copy the link', 'error'))
            }
          >
            <Icon name="copy" size={13} /> Copy link
          </button>
          <button className="sendphone-x" aria-label="Dismiss" onClick={() => setPhoneShare(null)}>
            <Icon name="close" size={12} />
          </button>
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
                  {/* Who this post addresses — a care guide composed in the
                      studio-owner voice is wrong on every slide, and this is
                      where that gets noticed before export rather than after
                      posting. */}
                  {project.settings?.audience && (
                    <div>
                      <div className="k">Audience</div>
                      <div className="v">{project.settings.audience}</div>
                    </div>
                  )}
                  {project.settings?.dmKeyword && (
                    <div>
                      <div className="k">DM keyword</div>
                      <div className="v">{project.settings.dmKeyword}</div>
                    </div>
                  )}
                  <div>
                    <div className="k">Status</div>
                    <div className={`v${authored ? ' ok' : ''}`}>
                      {authored ? (
                        <>
                          On-brand <Icon name="check" size={12} />
                        </>
                      ) : (
                        'Draft'
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="k">Updated</div>
                    <div className="v">{timeAgo(project.updatedAt)}</div>
                  </div>
                </div>
              </div>
            </header>

            {/* WHAT THIS DECK WAS WRITTEN FROM. A slide can make a claim about
                dwell times or pH; the article that produced it is the only way
                to check one, and until now nothing but the prompt ever saw it. */}
            {project.sources?.length ? (
              <section className="studio-sources">
                <span className="lab">Written from</span>
                {project.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" title={s.url}>
                    <Icon name="link" size={12} />
                    {s.title || s.url}
                    {s.byline ? <span className="by">{s.byline}</span> : null}
                  </a>
                ))}
              </section>
            ) : null}

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
                    {/* BOTH faces. Showing only the display family made a
                        reviewer conclude no body face was set — it is
                        (`bodyFamily`), and it is what every line of body copy
                        on every slide renders in. A panel that names half the
                        typography reads as the whole of it. */}
                    <div className="v">
                      {recipe.tokens.displayFamily}
                      <span style={{ opacity: 0.55 }}> · {recipe.tokens.bodyFamily}</span>
                    </div>
                  </div>
                  <div>
                    <div className="k">Signature</div>
                    <div className="v">{recipe.signature.name}</div>
                  </div>
                  <div>
                    <div className="k">Voice</div>
                    {/* When an audience is set, the recipe's base voice is NOT
                        what drove the slides — a hard reader instruction was
                        layered on top at compose. Showing the base voice
                        unlabelled here made the page contradict its own
                        audience chip, and a reviewer could not tell which was
                        in force. */}
                    {project.settings?.audience ? (
                      <div className="v">
                        Addressing a {project.settings.audience}
                        <span style={{ opacity: 0.55 }}>
                          {' '}
                          — overrides the recipe's base register ("
                          {(recipe.voice.description || '').slice(0, 60)}
                          {(recipe.voice.description || '').length > 60 ? '…' : ''}")
                        </span>
                      </div>
                    ) : (
                      <div className="v">{recipe.voice.description || '—'}</div>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section className="studio-card">
              <div className="studio-cardhead">
                <h2>Do the pictures agree with the words?</h2>
                <button className="btn" onClick={() => void checkImageCopy()} disabled={pairBusy}>
                  {pairBusy ? 'Looking…' : 'Check images'}
                </button>
              </div>
              {pairing && pairing.contradictions.length === 0 && (
                <p className="studio-note">
                  Nothing flagged across {pairing.checked} illustrated slide{pairing.checked === 1 ? '' : 's'}.
                </p>
              )}
              {pairing?.contradictions.map((c) => (
                <div key={`${c.slide}-${c.question}`} className="studio-warn">
                  <strong>Slide {c.slide}</strong> — says “{c.says}”, shows “{c.shows}”.
                  <div>{c.question}</div>
                </div>
              ))}
            </section>

            <div className="studio-sec">
              <h2>{project.type === 'story' ? 'The story' : 'The carousel'}</h2>
              <span className="count">{slides.length} slides</span>
              <span className="live">Rendered live</span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 4px' }}>
              Click a slide to select it, then edit it on the right — copy, order, and the brand&apos;s accent, all kept in the recipe&apos;s own design.
            </p>

            {/* Written by an older copywriter or composer. No apply button: a
                recompose rewrites copy that may have been hand-edited since,
                so the offer is to go and recompose deliberately. */}
            <PromptUpdates status={project.promptUpdates} className="studio-pu" />

            <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <button
                className={`btn sm${phoneView ? ' on' : ''}`}
                onClick={() => setPhoneView((v) => !v)}
                title="Stack the deck at the width of a phone — the size it will actually be read at"
                aria-pressed={phoneView}
              >
                <Icon name="phone" size={12} /> {phoneView ? 'Strip view' : 'Phone view'}
              </button>
              {phoneView && (
                <span className="hint" style={{ opacity: 0.6 }}>
                  {PHONE_W}px wide — scroll the deck as a reader would
                </span>
              )}
            </div>

            <DeckScroller className="studio-deck" stacked={phoneView}>
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
                  {workingSlides.length > 1 && (
                    <span className="mv">
                      <button
                        title="Move this slide left"
                        aria-label={`Move slide ${i + 1} left`}
                        disabled={i === 0 || saving}
                        onClick={(e) => {
                          e.stopPropagation();
                          void moveSlide(i, -1);
                        }}
                      >
                        <Icon name="chevron-left" size={13} />
                      </button>
                      <button
                        title="Move this slide right"
                        aria-label={`Move slide ${i + 1} right`}
                        disabled={i === workingSlides.length - 1 || saving}
                        onClick={(e) => {
                          e.stopPropagation();
                          void moveSlide(i, 1);
                        }}
                      >
                        <Icon name="chevron-right" size={13} />
                      </button>
                    </span>
                  )}
                  {unfilledSlots(slide) > 0 && (
                    <span className="needsphoto" title="This slide has an image slot you haven't filled — it exports as a blank panel.">
                      <Icon name="image" size={11} /> Needs photo
                    </span>
                  )}
                  {overflow[slide.id] && (
                    <span className="ovf" title="This slide's content is taller than the canvas — shorten the copy.">
                      <Icon name="warning" size={11} /> Overflows
                    </span>
                  )}
                  {/* Made by an older copywriter or composer, and the app can
                      say what a newer one would do differently HERE. Advisory
                      only — recomposing rewrites copy you may have edited. */}
                  {staleSlides[slide.id] && (
                    <span className="stale" title={`A newer prompt would fix: ${staleSlides[slide.id]!.join('; ')}.`}>
                      <Icon name="sparkle" size={11} /> Improvable
                    </span>
                  )}
                  <ScaledSlide format={project.format} displayWidth={phoneView ? PHONE_W : cardW}>
                    <SlideRenderer
                      onOverflow={(o) =>
                        setOverflow((m) => (m[slide.id] === o ? m : { ...m, [slide.id]: o }))
                      }
                      slide={slide}
                      brandKit={kit}
                      format={project.format}
                      photos={resolveSlidePhotos(slide, project.media)}
                      editing
                      theme={slide.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
                      forExport
                    />
                  </ScaledSlide>
                  {/* WHAT THIS SLIDE WAS ASKED TO DO.
                      Three slides once drifted from their source post and
                      nothing here could show it — noticing meant holding the
                      post and the deck open in two tabs and comparing by hand.
                      A plan FIXES the deck at one slide per entry, in order, so
                      `plan[i]` is this slide's brief. Shown only when the post
                      was composed against one; a free-form idea has no beat to
                      quote, and inventing one would be worse than saying
                      nothing. */}
                  {project.plan?.[i] && (
                    <p className="studio-beat" title="The plan entry this slide was composed against">
                      {project.plan[i]}
                    </p>
                  )}
                </div>
              ))}
            </DeckScroller>

            {/* The caption that ships with the post — editable here, rendered on
                the preview and copied to the clipboard on the phone hand-off. */}
            <section className="capcard">
              <div className="capcard-head">
                <span className="lab">Caption</span>
                {capDirty && <span className="capcard-unsaved">Unsaved changes</span>}
                <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
                  <button
                    className="btn sm"
                    disabled={capBusy !== null || !aiReady}
                    title={
                      aiReady
                        ? 'Write a fresh caption from the slides, in the brand voice'
                        : 'AI is not configured — set ANTHROPIC_API_KEY to enable this'
                    }
                    onClick={() => void regenCaption()}
                  >
                    {capBusy === 'regen' ? (
                      'Writing…'
                    ) : (
                      <>
                        <Icon name="sparkle" size={13} /> Regenerate
                      </>
                    )}
                  </button>
                  <button
                    className="btn sm primary"
                    disabled={capBusy !== null || !capDirty}
                    onClick={() => void saveCaption()}
                  >
                    {capBusy === 'save' ? 'Saving…' : 'Save caption'}
                  </button>
                </div>
              </div>
              <textarea
                className="capcard-text"
                rows={Math.min(8, Math.max(3, Math.ceil((capText.length + 1) / 60)))}
                maxLength={2400}
                placeholder="Write the caption that goes with this post…"
                value={capText}
                onChange={(e) => {
                  setCapText(e.target.value);
                  setCapDirty(true);
                }}
              />
              <input
                className="capcard-tags"
                placeholder="#hashtags separated by spaces or commas"
                value={capTags}
                onChange={(e) => {
                  setCapTags(e.target.value);
                  setCapDirty(true);
                }}
              />
              <p className="capcard-hint">
                Shown under the interactive preview, and copied to the clipboard with the images on
                the phone hand-off page.
              </p>
            </section>
          </div>

          {/* ── inspector ── */}
          <aside className="studio-inspector">
            <p className="studio-eyebrow">Slide {sel + 1} of {slides.length}</p>
            {selectedWorking && (
              <>
                {/* In Edit mode the preview IS the editing surface: the copy on
                    the slide is directly editable in place, so the photo drag
                    overlay (which owns every pointer event) steps aside. */}
                <CanvasCopyEditor
                  enabled={editId === selectedWorking.id}
                  els={editEls}
                  html={editingHtml ?? ''}
                  epoch={playing}
                  active={canvasEl}
                  onActivate={setCanvasEl}
                  onCommit={(key, text) => patchEl(key, { text })}
                >
                <div style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <ScaledSlide
                    format={project.format}
                    displayWidth={inspectorW}
                    overlay={
                      editId === selectedWorking.id ? undefined : (
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
                      )
                    }
                  >
                    <SlideRenderer
                      // Remounting on `playing` restarts the CSS reveal, so the
                      // button replays the exact motion the video will export.
                      key={playing ? `motion-${playing}` : 'still'}
                      slide={selectedWorking}
                      brandKit={kit}
                      format={project.format}
                      photos={resolveSlidePhotos(selectedWorking, project.media)}
                      editing
                      theme={selectedWorking.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
                      forExport
                      motion={playing !== null}
                    />
                  </ScaledSlide>
                </div>
                </CanvasCopyEditor>
                {authored && (
                  <button
                    className="btn sm ghost"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    onClick={() => setPlaying(Date.now())}
                    title="Play the motion this slide will have in a video export"
                  >
                    <Icon name="play" /> Play motion
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
                  Click any text on the slide above to edit it in place — Enter commits, Escape
                  reverts. Edits stay in the brand&apos;s design; the styling never changes.
                </p>
                <div className="aed-list">
                  {editEls.map((el, i) => (
                    <div
                      className={`aed-row${el.key === canvasEl ? ' sync' : ''}`}
                      key={el.key}
                      data-aed-key={el.key}
                      onClick={(e) => {
                        // Row → canvas sync: clicking the row (not its form
                        // fields or buttons) focuses the element on the slide.
                        const t = e.target as HTMLElement;
                        if (/^(TEXTAREA|INPUT|BUTTON|SELECT)$/.test(t.tagName) || t.closest('button')) return;
                        if (el.kind === 'text') setCanvasEl(el.key);
                      }}
                    >
                      <div className="aed-rowtop">
                        <span className="aed-tag">{el.label}</span>
                        <div className="aed-ctl">
                          <button title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => moveEl(el.key, -1)}><Icon name="arrow-up" size={12} /></button>
                          <button title="Move down" aria-label="Move down" disabled={i === editEls.length - 1} onClick={() => moveEl(el.key, 1)}><Icon name="arrow-down" size={12} /></button>
                          <button title="Remove" aria-label="Remove" className="del" onClick={() => removeEl(el.key)}><Icon name="close" size={12} /></button>
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
                      ) : el.kind === 'list' ? (
                        /* An enumeration: one editable line per item, plus its
                           optional half-line of detail. This used to read
                           "kept exactly as designed" and could not be touched. */
                        <div className="aed-rows">
                          {(el.rows ?? []).map((r, ri) => (
                            <div className="aed-item" key={r.key}>
                              <span className="aed-itemnum">{ri + 1}</span>
                              <div className="aed-itemfields">
                                <textarea
                                  className="aed-text"
                                  rows={1}
                                  placeholder="the item"
                                  value={r.text}
                                  onChange={(e) => patchRow(el.key, r.key, { text: e.target.value })}
                                />
                                <input
                                  className="aed-emph"
                                  placeholder="supporting detail — optional"
                                  value={r.note ?? ''}
                                  onChange={(e) => patchRow(el.key, r.key, { note: e.target.value || undefined })}
                                />
                              </div>
                              <button
                                className="aed-itemdel"
                                title="Remove this item"
                                aria-label="Remove this item"
                                onClick={() => removeRow(el.key, r.key)}
                              >
                                <Icon name="close" size={11} />
                              </button>
                            </div>
                          ))}
                          <button className="btn sm" onClick={() => addRow(el.key)}>
                            Add an item
                          </button>
                        </div>
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
                    <div className="studio-tok">
                      <span className="lab">Body</span>
                      <span className="val">{recipe.tokens.bodyFamily}</span>
                    </div>
                    {contrast !== null && (
                      <div className="studio-tok">
                        <span className="lab">Contrast</span>
                        <span className="val" style={{ color: contrast >= 4.5 ? 'var(--accent)' : 'var(--warn)' }}>
                          {contrast.toFixed(1)} : 1 <Icon name={contrast >= 4.5 ? 'check' : 'warning'} size={12} />
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
                      format={project.format}
                      busy={working !== null || saving}
                      selectedFreeId={freeSel}
                      ambient={recipeAmbient(recipe)}
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
                    <Icon name="edit" /> Edit
                  </button>
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled={!selected?.authored?.html || working !== null}
                    title={
                      direction.trim()
                        ? 'Rewrite this slide from your direction'
                        : 'Re-arrange this slide only — the copy is kept'
                    }
                    onClick={() => selected && askVariants(selected.id, direction)}
                  >
                    {working === 'variants' ? (
                      'Thinking…'
                    ) : (
                      <>
                        <Icon name="sparkle" /> {direction.trim() ? 'Rewrite' : 'Alternatives'}
                      </>
                    )}
                  </button>
                </div>
                {/* The two halves of the same idea, side by side: one keeps the
                    words and changes the layout, the other keeps the layout and
                    changes the words. */}
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled={!selected?.authored?.html || working !== null}
                    title="Keep this exact layout — write new copy for it"
                    onClick={() => selected && askRewrite(selected.id, direction)}
                  >
                    {working === 'rewrite' ? (
                      'Writing…'
                    ) : (
                      <>
                        <Icon name="edit" /> New words
                      </>
                    )}
                  </button>
                </div>

                {/* Direct THIS slide. Empty = rearrange what is already there. */}
                <div className="slide-direction">
                  <label htmlFor="slide-direction">Direct this slide</label>
                  <textarea
                    id="slide-direction"
                    value={direction}
                    rows={2}
                    maxLength={MAX_SLIDE_DIRECTION_CHARS}
                    placeholder={'What should this slide say? Put "an exact line" in quotes to use it word for word.'}
                    onChange={(e) => setDirection(e.target.value)}
                  />
                  <p className="muted">
                    {direction.trim()
                      ? 'The copywriter rewrites this slide only — the rest of the deck is untouched.'
                      : 'Leave empty to keep the copy and only try other arrangements.'}
                  </p>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Version history — snapshots of the deck, restorable at any time. */}
      {histOpen && (
        <div className="vh-scrim" role="presentation" onClick={() => setHistOpen(false)}>
          <aside
            className="vh"
            role="dialog"
            aria-modal="true"
            aria-label="Version history"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="vh-head">
              <Icon name="history" size={15} />
              <h3>History</h3>
              <button className="vh-x" aria-label="Close history" onClick={() => setHistOpen(false)}>
                <Icon name="close" size={14} />
              </button>
            </header>
            <p className="vh-sub">
              Snapshots of the whole deck. Exports save one automatically; restoring snapshots the
              current state first, so nothing is ever lost.
            </p>
            <div className="vh-save">
              <input
                placeholder="Label this snapshot (optional)"
                maxLength={80}
                value={histLabel}
                onChange={(e) => setHistLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && histBusy === null) void saveSnapshot();
                }}
              />
              <button
                className="btn sm primary"
                disabled={histBusy !== null}
                onClick={() => void saveSnapshot()}
              >
                {histBusy === 'save' ? 'Saving…' : 'Save snapshot'}
              </button>
            </div>
            <div className="vh-list">
              {histVersions === null ? (
                <>
                  <Skeleton shape="block" h={52} style={{ borderRadius: 10 }} />
                  <Skeleton shape="block" h={52} style={{ borderRadius: 10 }} />
                </>
              ) : histVersions.length === 0 ? (
                <p className="vh-empty">
                  No snapshots yet. Save one above, or export — exports snapshot automatically.
                </p>
              ) : (
                histVersions.map((v) => (
                  <div className="vh-row" key={v._id}>
                    <div className="vh-meta">
                      <span className="vh-lab">{v.label}</span>
                      <span className="vh-when">
                        {timeAgo(v.createdAt)} · {v.slideCount} slide{v.slideCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <button
                      className="btn sm"
                      disabled={histBusy !== null}
                      onClick={() => void restoreVersion(v._id)}
                    >
                      {histBusy === v._id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
