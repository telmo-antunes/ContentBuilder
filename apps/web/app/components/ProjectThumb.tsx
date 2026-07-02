'use client';

import type { MediaAsset, Project, ThemePreset } from '@contentbuilder/shared';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../lib/render/SlideFrame';
import { resolveSlideImage, resolveImageLayout } from '../../lib/render/projectRender';
import type { RenderBrandKit } from '../../lib/render/types';

export type ProjectThumbData = Pick<Project, '_id' | 'title' | 'type' | 'format' | 'status' | 'slides'> & {
  settings?: { theme?: ThemePreset };
};

/**
 * Slide-1 thumbnail for list rows — lists should show the WORK, not just
 * metadata. Quiet dashed placeholder for empty projects / missing kit.
 */
export function ProjectThumb({
  project,
  kit,
  media,
  width,
}: {
  project: ProjectThumbData;
  kit: RenderBrandKit | null;
  media: MediaAsset[];
  /** Display width for non-story formats (stories render narrower). */
  width?: number;
}) {
  const w = width ?? 96;
  const first = [...project.slides].sort((a, b) => a.order - b.order)[0];
  if (!first || !kit) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: project.format === '1080x1920' ? Math.round(w * 0.7) : w,
          aspectRatio:
            project.format === '1080x1920' ? '9/16' : project.format === '1080x1350' ? '4/5' : '1/1',
          borderRadius: 8,
          border: '1px dashed rgba(128,128,128,0.35)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--muted)',
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        empty
      </div>
    );
  }
  return (
    <div style={{ flexShrink: 0, borderRadius: 8, overflow: 'hidden' }}>
      <ScaledSlide format={project.format} displayWidth={project.format === '1080x1920' ? Math.round(w * 0.7) : w}>
        <SlideRenderer
          slide={first}
          brandKit={kit}
          format={project.format}
          image={resolveSlideImage(first, media)}
          imageLayout={resolveImageLayout(first, media)}
          theme={first.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
          forExport
        />
      </ScaledSlide>
    </div>
  );
}
