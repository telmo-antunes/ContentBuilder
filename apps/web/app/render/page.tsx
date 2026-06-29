import { api } from '../lib/config';
import type { ProjectDetail } from '../lib/api';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../../lib/render/projectRender';
import RenderStage from './RenderStage';

// Always fetch fresh — this route is hit per-slide by the export pipeline.
export const dynamic = 'force-dynamic';

export default async function RenderPage({
  searchParams,
}: {
  searchParams: { projectId?: string; slideId?: string };
}) {
  const { projectId, slideId } = searchParams;
  if (!projectId) return <div data-render-error>missing projectId</div>;

  const res = await fetch(api(`/projects/${projectId}`), { cache: 'no-store' });
  if (!res.ok) return <div data-render-error>project not found</div>;
  const project = (await res.json()) as ProjectDetail;

  const ordered = [...project.slides].sort((a, b) => a.order - b.order);
  const idx = Math.max(0, ordered.findIndex((s) => s.id === slideId));
  const slide = ordered[idx] ?? ordered[0];
  if (!slide) return <div data-render-error>no slide</div>;

  const kit = toRenderKit(project.brandKit);
  const image = resolveSlideImage(slide, project.media);

  return (
    <RenderStage
      layoutType={slide.layoutType}
      blocks={slide.blocks}
      format={project.format}
      kit={kit}
      image={image}
      imageLayout={resolveImageLayout(slide)}
      theme={slide.overrides?.theme ?? project.settings?.theme ?? 'editorial'}
      slideIndex={idx}
      slideTotal={ordered.length}
      showCounter={Boolean(project.settings?.slideCounter) && project.type === 'carousel'}
    />
  );
}
