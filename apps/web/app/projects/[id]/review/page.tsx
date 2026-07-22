'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { REFINE_INTENTS, type RefineIntent } from '@contentbuilder/shared';
import { getProject, refineProjectSlide, type ProjectDetail } from '../../../lib/api';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../../../../lib/render/projectRender';
import { toast } from '../../../components/Toast';

/**
 * The design-first review surface. Each slide is shown as a finished candidate;
 * you react with a high-level INTENT (a chip) and the change lands instantly.
 * Precise, hands-on editing lives one level deeper in the studio editor.
 */
export default function ReviewPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getProject(projectId)
      .then((p) => alive && setProject(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load project'));
    return () => {
      alive = false;
    };
  }, [projectId]);

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
  const slides = [...project.slides].sort((a, b) => a.order - b.order);
  const cardW = project.format === '1080x1920' ? 232 : 336;

  return (
    <div className="container">
      <div style={{ marginBottom: 6 }}>
        <Link href={`/businesses/${project.businessId}`} style={{ fontSize: 13 }}>
          ← Back to business
        </Link>
      </div>
      <div className="review-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>{project.title}</h1>
          <p className="muted" style={{ margin: 0, maxWidth: '58ch' }}>
            Review each slide as it will post. Nudge it with an intent — instant and on-brand — or open the studio for
            precise, hands-on edits.
          </p>
        </div>
        <Link className="btn" href={`/projects/${projectId}`}>
          Open studio editor →
        </Link>
      </div>

      {slides.length === 0 ? (
        <div className="empty">This project has no slides yet. Open the studio editor to build it.</div>
      ) : (
        <div className="review-grid">
          {slides.map((slide, i) => (
            <div className="card review-card" key={slide.id}>
              <div className="review-slide">
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
              <div className="review-controls">
                <div className="section-label" style={{ margin: '0 0 10px' }}>
                  Slide {i + 1} of {slides.length} · refine
                </div>
                <div className="review-chips">
                  {REFINE_INTENTS.map(({ intent, label, hint }) => (
                    <button
                      key={intent}
                      className="btn sm"
                      title={hint}
                      disabled={busy !== null}
                      onClick={() => applyIntent(slide.id, intent)}
                    >
                      {busy === `${slide.id}:${intent}` ? '…' : label}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
                  Changes are bounded to the brand and the safe area — copy is never touched.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
