'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { ImageSlot, LogoMark, paddingCss, rgba, safeInsets, surface, vScale } from '../primitives';
import { useRenderCtx } from '../RenderContext';

/** Title slide: a single centered cluster (logo + title/subtitle stack). */
export default function Cover({ brandKit, blocks, image, format, onOverflow }: LayoutProps) {
  const { theme } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);
  const header = brandKit.logo?.url ? (
    <LogoMark kit={brandKit} height={vScale(format, 92)} bg={bg} style={{ marginBottom: vScale(format, 10) }} />
  ) : null;

  return (
    <div style={{ position: 'absolute', inset: 0, background: surface(brandKit, theme), overflow: 'hidden' }}>
      {image?.url && (
        <>
          <ImageSlot image={image} kit={brandKit} style={{ opacity: 0.22 }} />
          <div style={{ position: 'absolute', inset: 0, background: rgba(bg, 0.4) }} />
        </>
      )}
      <div style={{ position: 'absolute', inset: 0, padding: paddingCss(insets) }}>
        <FitStack
          blocks={blocks}
          brandKit={brandKit}
          format={format}
          bg={bg}
          align="center"
          justify="center"
          gap={vScale(format, 24)}
          header={header}
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );
}
