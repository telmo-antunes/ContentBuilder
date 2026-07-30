import { api } from '../lib/config';
import type { ProjectDetail } from '../lib/api';
import { toRenderKit, resolveSlidePhotos } from '../../lib/render/projectRender';
import RenderStage from './RenderStage';

// Always fetch fresh — this route is hit per-slide by the export pipeline.
export const dynamic = 'force-dynamic';

export default async function RenderPage({
  searchParams,
}: {
  searchParams: {
    projectId?: string;
    slideId?: string;
    motion?: string;
    /** Render this export job's FROZEN snapshot instead of the live project. */
    srcJob?: string;
  };
}) {
  const { projectId, slideId, motion, srcJob } = searchParams;

  // Server-side fetch straight to the API. When the opt-in APP_PASSWORD gate is
  // on, attach the shared credentials (this runs on the server; never shipped
  // to the client bundle).
  const headers: Record<string, string> = process.env.APP_PASSWORD
    ? { Authorization: `Basic ${Buffer.from(`:${process.env.APP_PASSWORD}`).toString('base64')}` }
    : {};

  if (!projectId) return <div data-render-error>missing projectId</div>;
  /**
   * An export renders from the snapshot taken when its job started, so every
   * slide of one file comes from the same moment. Reading the project live
   * meant editing mid-export produced a torn result — early slides old, later
   * ones new. Falls back to live for a job with no snapshot, and for the
   * design-time preview that has no job at all.
   */
  const source = srcJob
    ? `/projects/${projectId}/export-source/${srcJob}`
    : `/projects/${projectId}`;
  let res = await fetch(api(source), { cache: 'no-store', headers });
  if (!res.ok && srcJob) res = await fetch(api(`/projects/${projectId}`), { cache: 'no-store', headers });
  if (!res.ok) return <div data-render-error>project not found</div>;
  const project = (await res.json()) as ProjectDetail;

  const ordered = [...project.slides].sort((a, b) => a.order - b.order);
  const idx = Math.max(0, ordered.findIndex((s) => s.id === slideId));
  const slide = ordered[idx] ?? ordered[0];
  if (!slide) return <div data-render-error>no slide</div>;

  const kit = toRenderKit(project.brandKit);
  // The user's own photos ride the same path, so PNG + MP4 exports carry them.
  const photos = resolveSlidePhotos(slide, project.media);

  return (
    <RenderStage
      authored={slide.authored}
      photos={photos}
      format={project.format}
      kit={kit}
      theme={slide.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
      slideIndex={idx}
      slideTotal={ordered.length}
      showCounter={Boolean(project.settings?.slideCounter) && project.type === 'carousel'}
      motion={motion === '1'}
    />
  );
}
