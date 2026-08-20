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
import { ErrorState } from '../../components/ErrorState';
import { toast } from '../../components/Toast';
import { Icon } from '../../components/Icon';
import { Skeleton } from '../../components/Skeleton';
import { SlideRenderer } from '../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../lib/render/SlideFrame';
import { toRenderKit, resolveSlidePhotos } from '../../../lib/render/projectRender';

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [displayWidth, setDisplayWidth] = useState(340);
  /** The wings need the stage's real width to center the current slide. */
  const [outerW, setOuterW] = useState(0);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback(() => {
    setError(null);
    getProject(id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => setOuterW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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

  if (error) {
    return (
      <div style={{ margin: 24 }}>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!project || !kit) {
    // The preview's shape while it loads: title over a portrait stage.
    return (
      <div
        role="status"
        aria-label="Loading the preview"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '48px 20px' }}
      >
        <Skeleton shape="line" w={70} h={10} />
        <Skeleton shape="block" w={260} h={34} />
        <Skeleton shape="block" w={320} h={400} style={{ borderRadius: 16, marginTop: 12 }} />
        <Skeleton shape="line" w={90} h={12} />
      </div>
    );
  }
  if (total === 0) return <p className="muted" style={{ margin: 24 }}>This post has no slides yet.</p>;

  const { height, width } = dimensionsFor(project.format);
  const slideH = Math.round((displayWidth * height) / width);
  const label = isStory ? 'Frame' : 'Slide';
  const pad = (n: number) => String(n).padStart(2, '0');

  // Brand-tint the ambient field from the kit's own palette — the surrounding
  // chrome stays quiet so the post itself is the only bold thing on screen.
  const tint = {
    '--b1': kit.colors.accent ?? kit.colors.primary,
    '--b2': kit.colors.primary,
    '--b3': kit.colors.secondary ?? kit.colors.primary,
  } as React.CSSProperties;

  return (
    <div className="pv-shell" style={tint}>
      <div className="pv-atmo" aria-hidden>
        <span className="pv-aur a" />
        <span className="pv-aur b" />
        <span className="pv-grain" />
        <span className="pv-vignette" />
      </div>

      <div className="pv-inner">
        <header className="pv-head">
          <p className="pv-eyebrow">
            {isStory ? 'Story' : 'Carousel'} · {total} {isStory ? 'frame' : 'slide'}
            {total === 1 ? '' : 's'}
          </p>
          {/* The marquee is set in the BRAND's own display face — the theatre
              belongs to the client's brand, not to the app. */}
          <h1 className="sr-marquee" style={{ fontFamily: `'${project.brandKit?.fonts.render.heading ?? 'inherit'}', serif` }}>
            {project.title}
          </h1>
          <p className="pv-sub">
            <span className="pv-hint">swipe, tap a wing, or use ← →</span>
          </p>
        </header>

        {/* The stage: the current slide center-frame, its neighbours dimmed in
            the wings. Swipe stays native; a wing click walks to that slide. */}
        <div
          className="sr-stage-outer"
          ref={outerRef}
          style={{ height: slideH }}
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
            className="sr-track"
            style={{
              transform: `translateX(${Math.round((outerW - displayWidth) / 2 - idx * (displayWidth + 18))}px)`,
            }}
          >
            {slides.map((s, i) => (
              <div
                key={s.id}
                className={`sr-item ${i === idx ? 'on' : 'dim'}`}
                style={{ width: displayWidth }}
                aria-hidden={i !== idx}
                onClick={i === idx ? undefined : () => setIdx(i)}
                role={i === idx ? undefined : 'button'}
                aria-label={i === idx ? undefined : `Go to ${label.toLowerCase()} ${i + 1}`}
              >
                <ScaledSlide format={project.format} displayWidth={displayWidth}>
                  <SlideRenderer
                    slide={s}
                    brandKit={kit}
                    format={project.format}
                    photos={resolveSlidePhotos(s, project.media)}
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
          {idx > 0 && (
            <button className="sr-arrow l" onClick={() => go(-1)} aria-label={`Previous ${label.toLowerCase()}`}>
              ←
            </button>
          )}
          {idx < total - 1 && (
            <button className="sr-arrow r" onClick={() => go(1)} aria-label={`Next ${label.toLowerCase()}`}>
              →
            </button>
          )}
        </div>

        <div className="pv-nav">
          <span className="pv-count">
            <span className="on">{pad(idx + 1)}</span>
            <span className="sep">/</span>
            {pad(total)}
          </span>
          {total > 1 && (
            <div className="pv-dots">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  className={`pv-dot ${i === idx ? 'active' : ''}`}
                  onClick={() => setIdx(i)}
                  aria-label={`Go to ${label.toLowerCase()} ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        {captionText && (
          <div className="pv-caption">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="pv-caption-lab">Caption</span>
              <div className="cap-btns">
                <button
                  className="btn sm ghost"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(captionText)
                      .then(() => toast('Caption copied', 'ok'))
                  }
                >
                  <Icon name="copy" size={13} /> Copy caption
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(window.location.href)
                      .then(() => toast('Link copied — anyone on this Wi-Fi can open it', 'ok'))
                      .catch(() => toast('Could not copy the link', 'error'))
                  }
                >
                  <Icon name="link" size={13} /> Copy link
                </button>
              </div>
            </div>
            <p>{captionText}</p>
          </div>
        )}

        <p className="pv-foot">
          Made with <span className="wm">ContentBuilder</span>
        </p>
      </div>
    </div>
  );
}
