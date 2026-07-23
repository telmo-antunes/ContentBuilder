'use client';

import { memo, useState, type ReactNode } from 'react';
import type { MediaAsset, Slide, ThemePreset } from '@contentbuilder/shared';
import { FORMAT_LABELS } from '@contentbuilder/shared';
import type { ProjectDetail } from '../../../lib/api';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import { resolveSlideImage, resolveImageLayout } from '../../../../lib/render/projectRender';
import type { RenderBrandKit } from '../../../../lib/render/types';
import type { SaveState } from './lib';

// ── Inspector ────────────────────────────────────────────────────────────────
/** Collapsible inspector group with a header chevron + smooth height motion. */
export function Section({
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

export function SaveBadge({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
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

export function EmptyProject({
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
        style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--display)', marginBottom: 6 }}
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

/**
 * One rail thumbnail, memoized: rendering a slide runs the full layout +
 * text-fit machinery, so re-running ALL of them on every keystroke makes the
 * editor visibly laggy past ~10 slides. Props are stable by construction
 * (`mutateSlide` preserves the identity of untouched slides; `kit` is memoized;
 * `onOverflowById` is a useCallback), so only the edited slide re-renders.
 */
export const RailThumb = memo(function RailThumb({
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
