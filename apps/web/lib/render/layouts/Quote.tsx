'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { paddingCss, rgba, safeInsets, surface, vScale } from '../primitives';
import { useRenderCtx } from '../RenderContext';

/** Large quote block + attribution, with a decorative quotation mark. */
export default function Quote({ brandKit, blocks, format, onOverflow }: LayoutProps) {
  const { theme } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);
  return (
    <div style={{ position: 'absolute', inset: 0, background: surface(brandKit, theme), overflow: 'hidden' }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: insets.top - vScale(format, 60),
          left: insets.left - vScale(format, 10),
          fontFamily: `'${brandKit.fonts.render.heading}', serif`,
          fontSize: vScale(format, 420),
          lineHeight: 1,
          fontWeight: 800,
          color: rgba(brandKit.colors.accent, 0.16),
          userSelect: 'none',
        }}
      >
        “
      </div>
      <div style={{ position: 'absolute', inset: 0, padding: paddingCss(insets) }}>
        <FitStack
          blocks={blocks}
          brandKit={brandKit}
          format={format}
          bg={bg}
          align="start"
          justify="center"
          gap={vScale(format, 34)}
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );
}
