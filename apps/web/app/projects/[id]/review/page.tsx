'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  FORMAT_LABELS,
  MAX_SLIDE_DIRECTION_CHARS,
  archetypeFor,
  authoredSlots,
  contrastRatio,
  VIDEO_SECONDS_DEFAULT,
  VIDEO_SECONDS_MAX,
  VIDEO_SECONDS_MIN,
  clampVideoSeconds,
  dimensionsFor,
  maxSlackFor,
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
  /**
   * The rest of what the same measurement already publishes.
   *
   * Every slide on this page renders live and the guard writes `collide` and
   * `slack` onto the DOM beside `overflow` — the page simply threw them away.
   * That cost a real deck: removing two wrong photographs took both slides to
   * 65% slack, past the 50% a content role is allowed, and nothing said so
   * because the layout gates run during COMPOSE and a person editing photos
   * afterwards passes through none of them.
   */
  const [layout, setLayout] = useState<Record<string, { collide: boolean; slack: number }>>({});
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
    | {
        contradictions: Array<{ slide: number; says: string; shows: string; question: string }>;
        /** Pictures that are not ABOUT their slide — see the API's `Unrelated`. */
        unrelated?: Array<{ slide: number; about: string; shows: string; question: string }>;
        checked: number;
      }
    | null
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
  /** The detail sheet + caption tile, so check chips can jump to their fix. */
  const sheetRef = useRef<HTMLElement | null>(null);
  const capRef = useRef<HTMLElement | null>(null);

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
  }, [projectId]);

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
    // The Line's shape while it loads: header + ship bar, checks, strip, sheet.
    return (
      <div className="mo-page mo-studio" role="status" aria-label="Loading the studio">
        <Skeleton shape="line" w={140} h={12} style={{ marginBottom: 14 }} />
        <Skeleton shape="block" w={420} h={34} style={{ marginBottom: 20 }} />
        <div className="row" style={{ gap: 8, marginBottom: 18 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="block" w={170} h={30} style={{ borderRadius: 999 }} />
          ))}
        </div>
        <Skeleton shape="block" h={420} style={{ borderRadius: 20, marginBottom: 14 }} />
        <Skeleton shape="block" h={260} style={{ borderRadius: 20 }} />
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

  /**
   * THE CHECKS — everything the page already measures, promoted from scattered
   * badges to the strip that drives the ship bar. Each chip names one thing and
   * clicking it selects the offending slide and brings its sheet into view.
   */
  type ChipTone = 'warn' | 'bad' | 'info';
  const chips: Array<{ key: string; tone: ChipTone; label: string; hint?: string; slide?: number }> = [];
  slides.forEach((s, i) => {
    const n = i + 1;
    // A background (full-bleed) photo satisfies the slide's need for a picture:
    // empty slots are removed at render, so flagging them here sent people to
    // fill a slot the design never wanted — a deck was "fixed" from full-bleed
    // into an inset card chasing exactly this chip.
    const hasBgPhoto = (s.photos ?? []).some((p) => p.placement === 'background');
    const arch = archetypeFor(s.authored?.archetype);
    if (unfilledSlots(s) > 0 && !hasBgPhoto) {
      chips.push({
        key: `photo-${s.id}`,
        tone: 'warn',
        label: `Slide ${n} needs a photo`,
        hint: 'An image slot the composer left is still empty — it exports as a blank panel.',
        slide: i,
      });
    } else if (arch?.placement === 'bleed' && arch.photo === 'required' && !hasBgPhoto) {
      chips.push({
        key: `bleed-${s.id}`,
        tone: 'warn',
        label: `Slide ${n} needs its background photo`,
        hint: 'This composition is full-bleed — the photograph IS the frame. Attach one as the background, not into a slot.',
        slide: i,
      });
    }
    if (overflow[s.id]) {
      chips.push({
        key: `ovf-${s.id}`,
        tone: 'warn',
        label: `Slide ${n} overflows`,
        hint: "This slide's content is taller than the canvas — shorten the copy or shrink the headline.",
        slide: i,
      });
    } else if (layout[s.id]?.collide) {
      chips.push({
        key: `col-${s.id}`,
        tone: 'warn',
        label: `Slide ${n}: elements touching`,
        hint: 'Two elements on this slide are touching — the type has nowhere to breathe.',
        slide: i,
      });
    } else if (layout[s.id] !== undefined && layout[s.id]!.slack > maxSlackFor(s.authored?.role)) {
      chips.push({
        key: `slack-${s.id}`,
        tone: 'warn',
        label: `Slide ${n} looks empty`,
        hint: `${Math.round(layout[s.id]!.slack * 100)}% of this slide is empty — give it something to say, or a photograph.`,
        slide: i,
      });
    }
    if (staleSlides[s.id]) {
      chips.push({
        key: `stale-${s.id}`,
        tone: 'info',
        label: `Slide ${n} improvable`,
        hint: `A newer prompt would fix: ${staleSlides[s.id]!.join('; ')}.`,
        slide: i,
      });
    }
  });
  // The compose step's decision ledger — calls the code took on the deck's
  // behalf (e.g. a full-bleed photo dropped for fighting the brand ground).
  // Info tone: they explain the deck, they don't gate shipping.
  (project.composeNotes ?? []).forEach((cn, idx) => {
    chips.push({
      key: `note-${idx}`,
      tone: 'info',
      label: cn.slide ? `Slide ${cn.slide}: a call was made` : 'A call was made',
      hint: cn.note,
      ...(cn.slide ? { slide: cn.slide - 1 } : {}),
    });
  });
  for (const c of pairing?.contradictions ?? []) {
    chips.push({
      key: `pair-${c.slide}-${c.question}`,
      tone: 'bad',
      label: `Slide ${c.slide}: words ≠ picture`,
      hint: `Says “${c.says}”, shows “${c.shows}”. ${c.question}`,
      slide: c.slide - 1,
    });
  }
  for (const u of pairing?.unrelated ?? []) {
    chips.push({
      key: `unrel-${u.slide}-${u.question}`,
      tone: 'warn',
      label: `Slide ${u.slide}: picture unrelated`,
      hint: `About “${u.about}”, shows “${u.shows}”. ${u.question}`,
      slide: u.slide - 1,
    });
  }
  const capOk = Boolean((project.caption?.text ?? '').trim() || capText.trim());
  // Advisory chips (improvable) don't gate shipping — only warn/bad do.
  const issues = chips.filter((c) => c.tone !== 'info');
  const cleanSlideCount = slides.filter((_, i) => !issues.some((c) => c.slide === i)).length;
  const pairingRan = pairing !== null;
  const pairingClean = pairingRan && issues.every((c) => !c.key.startsWith('pair-') && !c.key.startsWith('unrel-'));
  const totalChecks = slides.length + 1 + (pairingRan ? 1 : 0);
  const passedChecks = cleanSlideCount + (capOk ? 1 : 0) + (pairingClean ? 1 : 0);
  const checksLeft = issues.length + (capOk ? 0 : 1);
  const shipPct = totalChecks === 0 ? 100 : Math.round((100 * passedChecks) / totalChecks);

  const selectSlide = (i: number) => {
    if (editId && slides[i]?.id !== editId) cancelEdit();
    setSel(i);
    sheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  /** The selected slide's own blockers, for the sheet's fix-first column. */
  const selIssues = selected ? issues.filter((c) => c.slide === sel) : [];
  const selAdvice = selected ? chips.filter((c) => c.tone === 'info' && c.slide === sel) : [];

  return (
    <div className="mo-page mo-studio">
      <p className="mo-crumb">
        <Link href="/">Home</Link>
        {' / '}
        <Link href={`/businesses/${project.businessId}`}>{project.brandKit ? 'Brand' : 'Back'}</Link>
        {' / '}
        {project.type === 'story' ? 'Story' : 'Carousel'}
      </p>

      <header className="mo-shead">
        <div>
          <h1>{project.title}</h1>
          <div className="meta">
            <span><b>{slides.length}</b> slide{slides.length === 1 ? '' : 's'}</span>
            <span>Format <b>{FORMAT_LABELS[project.format as Format] ?? project.format}</b></span>
            {project.settings?.audience && <span>Audience <b>{project.settings.audience}</b></span>}
            {project.settings?.dmKeyword && <span>DM keyword <b>{project.settings.dmKeyword}</b></span>}
            <span>{authored ? <b style={{ color: 'var(--mo-green)' }}>On-brand ✓</b> : 'Draft'}</span>
            <span>Updated <b>{timeAgo(project.updatedAt)}</b></span>
          </div>
        </div>
        {slides.length > 0 && (
          <div className="side">
            <div className="actions">
              <a className="mo-btn sm" href={`/preview/${projectId}`} target="_blank" rel="noopener noreferrer">
                <Icon name="play" size={13} /> Preview
              </a>
              <button className="mo-btn sm" onClick={share}>Share</button>
              <button
                className="mo-btn sm"
                onClick={openHistory}
                title="Snapshots of this project — save one or restore an earlier state"
              >
                <Icon name="history" size={13} /> History
              </button>
              {/* ONE export affordance — the format is a choice made after
                  deciding to export, not a permanent pair of buttons. */}
              <div className="expw">
                <button
                  className={`mo-btn prim${checksLeft === 0 ? ' ready' : ''}`}
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
                      <Icon name="download" size={13} /> Export
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
            </div>
            <div className="mo-ship" aria-label={`Ready to ship: ${shipPct}%`}>
              <div className="lbl">
                <span>Ready to ship</span>
                <b>{shipPct}%</b>
              </div>
              <div className="mo-pbar">
                <i style={{ width: `${shipPct}%` }} />
              </div>
              <div className="hint">
                {checksLeft > 0 ? (
                  <>
                    <b>
                      {checksLeft} check{checksLeft === 1 ? '' : 's'} left
                    </b>{' '}
                    — clear them and Export lights up
                  </>
                ) : (
                  <b className="done">All clear — ready to export</b>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

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
                <button className="mo-btn sm" onClick={() => void cancelVideo()}>
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
            className="mo-btn sm"
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
        <div className="mo-tile" style={{ maxWidth: 520 }}>
          This project has no slides yet. Start a{' '}
          <Link href="/projects/new">new AI-composed project</Link>.
        </div>
      ) : (
        <>
          {/* ── The checks strip: status, navigation, and to-do in one line ── */}
          <div className="mo-checks" role="list" aria-label="Checks">
            {chips.map((c) => (
              <button
                key={c.key}
                role="listitem"
                className={`mo-chk ${c.tone}`}
                title={c.hint}
                onClick={() => c.slide !== undefined && selectSlide(c.slide)}
              >
                <i />
                {c.label}
                {c.slide !== undefined && <span className="go">{c.tone === 'bad' ? 'Look →' : 'Fix →'}</span>}
              </button>
            ))}
            {capOk ? (
              <span className="mo-chk ok">
                <i />
                Caption written
              </span>
            ) : (
              <button
                className="mo-chk warn"
                onClick={() => capRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              >
                <i />
                Caption is empty <span className="go">Write it →</span>
              </button>
            )}
            {pairingRan && pairingClean ? (
              <span className="mo-chk ok">
                <i />
                Pictures agree with the words
              </span>
            ) : !pairingRan ? (
              <button className="mo-chk info" disabled={pairBusy} onClick={() => void checkImageCopy()}>
                <i />
                {pairBusy ? 'Looking at the pictures…' : 'Check the pictures against the words'}
              </button>
            ) : null}
          </div>

          {/* ── Where this deck came from, demoted to one quiet line ── */}
          {(project.sources?.length || recipe) && (
            <div className="mo-context">
              {project.sources?.length ? (
                <>
                  <span className="lab">Written from</span>
                  {project.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" title={s.url}>
                      {s.title || s.url}
                      {s.byline ? ` — ${s.byline}` : ''}
                    </a>
                  ))}
                  {recipe && <span className="sep">·</span>}
                </>
              ) : null}
              {recipe && (
                <>
                  <span className="lab">Recipe</span>
                  <span>
                    <span className="sw" style={{ background: recipe.tokens.ground }} />
                    <span className="sw" style={{ background: recipe.tokens.accent }} />
                    {recipe.signature.name} · {recipe.tokens.displayFamily}
                  </span>
                  {/* When an audience is set, a hard reader instruction was
                      layered over the recipe's base voice at compose. */}
                  {project.settings?.audience ? (
                    <span title={`Overrides the recipe's base register ("${recipe.voice.description ?? ''}")`}>
                      voice: addressing a {project.settings.audience}
                    </span>
                  ) : recipe.voice.description ? (
                    <span title={recipe.voice.description}>
                      voice: {recipe.voice.description.slice(0, 48)}
                      {recipe.voice.description.length > 48 ? '…' : ''}
                    </span>
                  ) : null}
                  <Link href={`/businesses/${project.businessId}/brand-kit`}>Edit recipe →</Link>
                </>
              )}
            </div>
          )}

          {/* Written by an older copywriter or composer. No apply button: a
              recompose rewrites copy that may have been hand-edited since. */}
          <PromptUpdates status={project.promptUpdates} className="studio-pu" />

          {/* ── The deck: the spine of the line ── */}
          <section className="mo-line-wrap" aria-label="The deck">
            <div className="mo-line-h">
              <span className="t">{project.type === 'story' ? 'The story' : 'The carousel'}</span>
              <span className="b">{slides.length} slides</span>
              <span className="live">
                <i />
                rendered live
              </span>
              <div className="views">
                <button
                  className={`mo-btn sm${phoneView ? '' : ' prim'}`}
                  onClick={() => setPhoneView(false)}
                  aria-pressed={!phoneView}
                >
                  Strip
                </button>
                <button
                  className={`mo-btn sm${phoneView ? ' prim' : ''}`}
                  onClick={() => setPhoneView(true)}
                  aria-pressed={phoneView}
                  title="Stack the deck at the width of a phone — the size it will actually be read at"
                  style={{ marginLeft: 6 }}
                >
                  <Icon name="phone" size={12} /> Phone
                </button>
              </div>
            </div>
            <p className="mo-line-hint">
              {phoneView
                ? `${PHONE_W}px wide — scroll the deck as a reader would`
                : 'Click a slide to open its sheet below — the words, the pictures, and everything it needs.'}
            </p>

            <DeckScroller className="mo-strip" stacked={phoneView}>
              {workingSlides.map((slide, i) => {
                const slideChips = issues.filter((c) => c.slide === i);
                const advice = chips.filter((c) => c.tone === 'info' && c.slide === i);
                return (
                  <div
                    key={slide.id}
                    role="button"
                    tabIndex={0}
                    className={`mo-fcard${i === sel ? ' sel' : ''}${slide.id === editId ? ' editing' : ''}`}
                    onClick={() => selectSlide(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectSlide(i);
                      }
                    }}
                  >
                    <div className="top">
                      <span className="idx">
                        {String(i + 1).padStart(2, '0')}
                        {slide.authored?.role ? ` · ${slide.authored.role}` : ''}
                      </span>
                      {slideChips.length === 0 && advice.length === 0 && (
                        <span className="mo-flag ok">Clean</span>
                      )}
                      {slideChips.slice(0, 2).map((c) => (
                        <span key={c.key} className={`mo-flag ${c.tone}`} title={c.hint}>
                          {c.label.replace(/^Slide \d+:? /, '')}
                        </span>
                      ))}
                      {advice.length > 0 && slideChips.length === 0 && (
                        <span className="mo-flag info" title={advice[0]!.hint}>
                          Improvable
                        </span>
                      )}
                    </div>
                    <div className="artwrap">
                      {workingSlides.length > 1 && !phoneView && (
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
                      <ScaledSlide format={project.format} displayWidth={phoneView ? PHONE_W : cardW}>
                        <SlideRenderer
                          onOverflow={(o, signals) => {
                            setOverflow((m) => (m[slide.id] === o ? m : { ...m, [slide.id]: o }));
                            if (!signals) return;
                            setLayout((m) => {
                              const was = m[slide.id];
                              if (was && was.collide === signals.collide && was.slack === signals.slack) return m;
                              return { ...m, [slide.id]: { collide: signals.collide, slack: signals.slack } };
                            });
                          }}
                          slide={slide}
                          brandKit={kit}
                          format={project.format}
                          photos={resolveSlidePhotos(slide, project.media)}
                          /**
                           * Phone view renders the way the EXPORT does: no
                           * editing affordances filling empty slots, so a slide
                           * that will look empty in the file looks empty here.
                           */
                          editing={!phoneView}
                          theme={slide.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
                          forExport
                        />
                      </ScaledSlide>
                    </div>
                    {/* The plan entry this slide was composed against. */}
                    {project.plan?.[i] && (
                      <p className="beat" style={{ maxWidth: phoneView ? PHONE_W : cardW }} title="The plan entry this slide was composed against">
                        {project.plan[i]}
                      </p>
                    )}
                  </div>
                );
              })}
            </DeckScroller>
          </section>

          {/* ── The detail sheet: everything about the selected slide ── */}
          {selectedWorking && (
            <section className="mo-sheet" ref={sheetRef} aria-label={`Slide ${sel + 1} details`}>
              <div>
                <h3 className="colh">
                  Slide {sel + 1} of {slides.length} <span className="n">selected</span>
                </h3>
                {/* The model's own one-line reasoning for this slide's calls —
                    role, image, alignment. Insight, not instruction. */}
                {selectedWorking.rationale && (
                  <p className="beat" title="Why the AI made this slide's calls (role, image, alignment)">
                    AI: {selectedWorking.rationale}
                  </p>
                )}
                <CanvasCopyEditor
                  enabled={editId === selectedWorking.id}
                  els={editEls}
                  html={editingHtml ?? ''}
                  epoch={playing}
                  active={canvasEl}
                  onActivate={setCanvasEl}
                  onCommit={(key, text) => patchEl(key, { text })}
                >
                  <div className="preview-frame">
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
                        // Remounting on `playing` restarts the CSS reveal, so
                        // the button replays the exact motion a video exports.
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
                    className="mo-btn sm"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                    onClick={() => setPlaying(Date.now())}
                    title="Play the motion this slide will have in a video export"
                  >
                    <Icon name="play" size={12} /> Play motion
                  </button>
                )}
                {recipe && (
                  <details className="mo-tokens">
                    <summary>Brand tokens</summary>
                    <div className="tk">
                      <span>Ground</span>
                      <span className="v">
                        <span className="sw" style={{ background: recipe.tokens.ground }} />
                        {recipe.tokens.ground}
                      </span>
                    </div>
                    <div className="tk">
                      <span>Accent</span>
                      <span className="v">
                        <span className="sw" style={{ background: recipe.tokens.accent }} />
                        {recipe.tokens.accent}
                      </span>
                    </div>
                    <div className="tk">
                      <span>Display</span>
                      <span className="v">{recipe.tokens.displayFamily}</span>
                    </div>
                    <div className="tk">
                      <span>Body</span>
                      <span className="v">{recipe.tokens.bodyFamily}</span>
                    </div>
                    {contrast !== null && (
                      <div className="tk">
                        <span>Contrast</span>
                        <span className="v" style={{ color: contrast >= 4.5 ? 'var(--mo-green)' : 'var(--mo-amber)' }}>
                          {contrast.toFixed(1)} : 1
                        </span>
                      </div>
                    )}
                  </details>
                )}
              </div>

              {editId && selectedWorking.id === editId ? (
                /* ── Edit mode: the words, in the recipe's own markup ── */
                <div className="mo-scol2 aed" style={{ gridColumn: '2 / -1' }}>
                  <h3 className="colh">
                    The words <span className="n">click a line here or type straight on the slide</span>
                  </h3>
                  <div className="aed-list">
                    {editEls.map((el, i) => (
                      <div
                        className={`aed-row${el.key === canvasEl ? ' sync' : ''}`}
                        key={el.key}
                        data-aed-key={el.key}
                        onClick={(e) => {
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
                            <button className="mo-btn sm" onClick={() => addRow(el.key)}>
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
                    <button className="mo-btn prim sm" disabled={saving} onClick={() => saveEdit(slides)}>
                      {saving ? 'Saving…' : 'Save slide'}
                    </button>
                    <button className="mo-btn sm" disabled={saving} onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {/* ── Fix-first: what this slide needs, then its pictures ── */}
                  <div className="mo-scol2">
                    <h3 className="colh">What this slide needs</h3>
                    {selIssues.length === 0 && selAdvice.length === 0 && (
                      <div className="mo-allclear">
                        <span className="tick"><Icon name="check" size={12} /></span>
                        Nothing — this slide is clean. The tools on the right are for taste.
                      </div>
                    )}
                    {selIssues.map((c) => (
                      <div key={c.key} className={`mo-fix${c.tone === 'bad' ? ' bad' : ''}`}>
                        <div className="t">{(() => { const t = c.label.replace(/^Slide \d+:?\s*/, ''); return t.charAt(0).toUpperCase() + t.slice(1); })()}</div>
                        <div className="d">{c.hint}</div>
                        {c.key.startsWith('ovf-') || c.key.startsWith('col-') ? (
                          <div className="row">
                            <button
                              className="mo-btn sm prim"
                              disabled={working !== null}
                              onClick={() => applyTweak(selectedWorking.id, 'smaller-headline')}
                            >
                              Smaller headline
                            </button>
                            <button className="mo-btn sm" onClick={() => startEdit(selectedWorking)}>
                              Tighten the words
                            </button>
                          </div>
                        ) : c.key.startsWith('slack-') ? (
                          <div className="row">
                            <button
                              className="mo-btn sm"
                              disabled={working !== null}
                              onClick={() => applyTweak(selectedWorking.id, 'bigger-headline')}
                            >
                              Bigger headline
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {selAdvice.map((c) => (
                      <div key={c.key} className="mo-fix info">
                        <div className="t">A newer prompt would improve this slide</div>
                        <div className="d">{c.hint}</div>
                      </div>
                    ))}

                    {/* Photos: fill the composer's slots, set a background, or
                        drop images anywhere on the canvas. */}
                    {selected?.authored?.html && (
                      <>
                        <h3 className="colh" style={{ marginTop: 16 }}>Pictures</h3>
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
                  </div>

                  {/* ── Taste tools: adjust, alternatives, direction ── */}
                  <div className="mo-scol3">
                    <h3 className="colh">Quick adjustments</h3>
                    <div className="mo-qrow">
                      <button
                        className="mo-btn sm"
                        disabled={working !== null || !selected?.authored?.html}
                        onClick={() => selected && applyTweak(selected.id, 'bigger-headline')}
                      >
                        Bigger headline
                      </button>
                      <button
                        className="mo-btn sm"
                        disabled={working !== null || !selected?.authored?.html}
                        onClick={() => selected && applyTweak(selected.id, 'smaller-headline')}
                      >
                        Smaller headline
                      </button>
                      <button
                        className="mo-btn sm"
                        disabled={working !== null || !recipe?.surfaces?.inverse || !selected?.authored?.html}
                        title={
                          recipe?.surfaces?.inverse
                            ? 'Flip this slide to the brand’s light surface'
                            : 'This brand has no inverse surface yet'
                        }
                        onClick={() =>
                          selected &&
                          applyTweak(selected.id, selected.authored?.bg === 'inverse' ? 'un-invert' : 'invert')
                        }
                      >
                        {selected?.authored?.bg === 'inverse' ? 'Un-invert' : 'Invert colors'}
                      </button>
                      <button
                        className="mo-btn sm"
                        disabled={!selected?.authored?.html}
                        onClick={() => selected && startEdit(selected)}
                      >
                        <Icon name="edit" size={12} /> Edit the words
                      </button>
                      <button
                        className="mo-btn sm"
                        disabled={!selected?.authored?.html || working !== null}
                        title={
                          direction.trim()
                            ? 'Rewrite this slide from your direction'
                            : 'Re-arrange this slide only — the copy is kept'
                        }
                        onClick={() => selected && askVariants(selected.id, direction)}
                      >
                        {working === 'variants' ? 'Thinking…' : (
                          <>
                            <Icon name="sparkle" size={12} /> {direction.trim() ? 'Rewrite' : 'Other arrangements'}
                          </>
                        )}
                      </button>
                      <button
                        className="mo-btn sm"
                        disabled={!selected?.authored?.html || working !== null}
                        title="Keep this exact layout — write new copy for it"
                        onClick={() => selected && askRewrite(selected.id, direction)}
                      >
                        {working === 'rewrite' ? 'Writing…' : 'New words'}
                      </button>
                    </div>

                    {/* Candidates: nothing saved until one is picked. */}
                    {variants && variants.length > 0 && (
                      <div className="mo-variants">
                        <h3 className="colh">
                          Pick one <span className="n">{variantKind === 'copy' ? 'new words' : 'same words, new arrangement'}</span>
                        </h3>
                        <div className="sv-row">
                          {variants.map((v, i) => (
                            <button
                              key={i}
                              className="sv-card"
                              disabled={working !== null}
                              onClick={() => selected && applyVariant(selected.id, v, slides)}
                              title="Apply this one"
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

                    {/* Direct THIS slide. Empty = rearrange what is already there. */}
                    <div className="mo-direct">
                      <label htmlFor="slide-direction">Direct this slide</label>
                      <textarea
                        id="slide-direction"
                        value={direction}
                        rows={3}
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
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── The caption: the last thing before export ── */}
          <section className="mo-captile" ref={capRef} aria-label="Caption">
            <div>
              <h3 className="colh" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Caption
                {capDirty && <span className="mo-cap-unsaved">Unsaved</span>}
              </h3>
              <textarea
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
                placeholder="#hashtags separated by spaces or commas"
                value={capTags}
                onChange={(e) => {
                  setCapTags(e.target.value);
                  setCapDirty(true);
                }}
              />
              <p className="hint">
                Shown under the interactive preview, and copied to the clipboard with the images on
                the phone hand-off page.
              </p>
            </div>
            <div className="side">
              <h3 className="colh">&nbsp;</h3>
              <span className="st">
                {project.caption?.text
                  ? 'Written against the brand voice.'
                  : 'No caption yet — the post ships silent without one.'}
              </span>
              <div className="row">
                <button
                  className="mo-btn sm"
                  disabled={capBusy !== null || !aiReady}
                  title={
                    aiReady
                      ? 'Write a fresh caption from the slides, in the brand voice'
                      : 'AI is not configured — set ANTHROPIC_API_KEY to enable this'
                  }
                  onClick={() => void regenCaption()}
                >
                  {capBusy === 'regen' ? 'Writing…' : (
                    <>
                      <Icon name="sparkle" size={13} /> Regenerate
                    </>
                  )}
                </button>
                <button
                  className="mo-btn sm prim"
                  disabled={capBusy !== null || !capDirty}
                  onClick={() => void saveCaption()}
                >
                  {capBusy === 'save' ? 'Saving…' : 'Save caption'}
                </button>
              </div>
            </div>
          </section>
        </>
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
                className="mo-btn sm prim"
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
                      className="mo-btn sm"
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
