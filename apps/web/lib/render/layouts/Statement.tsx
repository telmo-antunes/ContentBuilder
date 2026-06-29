'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { AccentRule, paddingCss, safeInsets, surface, vScale } from '../primitives';
import { useRenderCtx } from '../RenderContext';

/** One oversized, left-aligned statement led by a bold accent bar (no logo). */
export default function Statement({ brandKit, blocks, format, onOverflow }: LayoutProps) {
  const { theme } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);
  return (
    <div style={{ position: 'absolute', inset: 0, background: surface(brandKit, theme) }}>
      <div style={{ position: 'absolute', inset: 0, padding: paddingCss(insets) }}>
        <FitStack
          blocks={blocks}
          brandKit={brandKit}
          format={format}
          bg={bg}
          align="start"
          justify="center"
          gap={vScale(format, 28)}
          header={
            <AccentRule
              kit={brandKit}
              width={vScale(format, 96)}
              height={vScale(format, 10)}
              style={{ marginBottom: vScale(format, 22) }}
            />
          }
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );
}
