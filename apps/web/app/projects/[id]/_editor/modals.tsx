'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MediaAsset, Slide, ThemePreset } from '@contentbuilder/shared';
import { dimensionsFor } from '@contentbuilder/shared';
import {
  listProjectVersions,
  saveProjectVersion,
  restoreProjectVersion,
  type ProjectDetail,
  type ProjectVersion,
} from '../../../lib/api';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import { resolveSlideImage, resolveImageLayout } from '../../../../lib/render/projectRender';
import type { RenderBrandKit } from '../../../../lib/render/types';

/** Full-screen swipe preview of the project's slides (arrows / keyboard / dots). */
export function PreviewOverlay({
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

/** A read-only URL with a copy button — used in the Share modal. */
export function ShareLinkRow({ url, onCopy }: { url: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="row"
      style={{ gap: 8, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}
    >
      <code style={{ fontSize: 13, flex: 1, wordBreak: 'break-all' }}>{url}</code>
      <button
        className="btn sm"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopied(true);
          onCopy();
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

/**
 * Version history (G9): snapshots saved automatically before AI drafts, polish
 * and restores, on every export, and manually. Restoring snapshots the current
 * state first, so nothing is ever lost — and the restore itself is undoable.
 */
export function HistoryModal({
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
