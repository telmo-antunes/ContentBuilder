'use client';

/**
 * Interactive preview — a shareable, swipeable live view of a post, rendered
 * from the SAME layout components as the editor and export (so it's WYSIWYG).
 * Unlike /share (static exported PNGs, needs an export first), this renders the
 * slides live, works before any export, and lets a client swipe through the
 * carousel exactly as it will appear. Link-accessible, no auth — like /share.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ThemePreset } from '@contentbuilder/shared';
import { dimensionsFor } from '@contentbuilder/shared';
import { getProject, type ProjectDetail } from '../../lib/api';
import { SlideRenderer } from '../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../lib/render/SlideFrame';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../../../lib/render/projectRender';

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [displayWidth, setDisplayWidth] = useState(340);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const slides = project?.slides ?? [];
  const total = slides.length;
  const kit = useMemo(() => (project?.brandKit ? toRenderKit(project.brandKit) : null), [project]);
  const theme = (project?.settings?.theme ?? 'editorial') as ThemePreset;
  const isStory = project?.format === '1080x1920';

  // Fit the slide to the viewport (phone-first, but capped on desktop).
  useEffect(() => {
    if (!project) return;
    const fit = () => {
      const dim = dimensionsFor(project.format);
      const availW = Math.min(window.innerWidth - 40, 460);
      const availH = window.innerHeight - 250; // room for caption + chrome
      const byW = availW;
      const byH = (availH * dim.width) / dim.height;
      setDisplayWidth(Math.max(220, Math.round(Math.min(byW, byH))));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [project]);

  const go = useCallback(
    (d: number) => setIdx((i) => Math.max(0, Math.min(total - 1, i + d))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const captionText = useMemo(() => {
    const c = project?.caption;
    if (!c?.text && !c?.hashtags?.length) return '';
    return [c.text, (c.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n');
  }, [project]);

  if (error) return <div className="error-box" style={{ margin: 24 }}>{error}</div>;
  if (!project || !kit) return <p className="muted" style={{ margin: 24 }}>Loading preview…</p>;
  if (total === 0) return <p className="muted" style={{ margin: 24 }}>This post has no slides yet.</p>;

  const { height, width } = dimensionsFor(project.format);
  const slideH = Math.round((displayWidth * height) / width);
  const label = isStory ? 'Frame' : 'Slide';

  return (
    <div className="preview-page">
      <div className="preview-page-head">
        <h1>{project.title}</h1>
        <p className="muted">
          {total} {isStory ? 'frame' : 'slide'}{total === 1 ? '' : 's'} · swipe or use ← →
        </p>
      </div>

      {/* Swipeable stage: a track of all slides translated by index. */}
      <div
        className="preview-stage-wrap"
        style={{ width: displayWidth, height: slideH }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = touchStart.current;
          const t = e.changedTouches[0];
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
          touchStart.current = null;
        }}
      >
        <div
          className="preview-track"
          style={{ width: displayWidth * total, transform: `translateX(${-idx * displayWidth}px)` }}
        >
          {slides.map((s, i) => (
            <div key={s.id} style={{ width: displayWidth, flex: '0 0 auto' }} aria-hidden={i !== idx}>
              <ScaledSlide format={project.format} displayWidth={displayWidth}>
                <SlideRenderer
                  slide={s}
                  brandKit={kit}
                  format={project.format}
                  image={resolveSlideImage(s, project.media)}
                  imageLayout={resolveImageLayout(s, project.media)}
                  theme={s.overrides?.theme ?? theme}
                  slideIndex={i}
                  slideTotal={total}
                  showCounter={Boolean(project.settings?.slideCounter)}
                  forExport
                />
              </ScaledSlide>
            </div>
          ))}
        </div>

        {/* Tap zones (left / right half) for desktop clicking. */}
        {idx > 0 && <button className="preview-tap left" onClick={() => go(-1)} aria-label={`Previous ${label.toLowerCase()}`} />}
        {idx < total - 1 && <button className="preview-tap right" onClick={() => go(1)} aria-label={`Next ${label.toLowerCase()}`} />}
      </div>

      {total > 1 && (
        <div className="preview-dots" style={{ marginTop: 14 }}>
          {slides.map((s, i) => (
            <button
              key={s.id}
              className={`preview-dot ${i === idx ? 'active' : ''}`}
              onClick={() => setIdx(i)}
              aria-label={`Go to ${label.toLowerCase()} ${i + 1}`}
            />
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        {label} {idx + 1} of {total}
      </p>

      {captionText && (
        <div className="preview-caption">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Caption</strong>
            <button
              className="btn sm"
              onClick={() => void navigator.clipboard?.writeText(captionText)}
            >
              Copy
            </button>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 0 }}>{captionText}</p>
        </div>
      )}

      <p className="preview-foot muted">Made with ContentBuilder</p>
    </div>
  );
}
