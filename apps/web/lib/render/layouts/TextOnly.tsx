'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { AccentRule, LogoMark, paddingCss, safeInsets, surface, vScale } from '../primitives';
import { useRenderCtx } from '../RenderContext';

/** Text blocks on a brand background, strong typographic hierarchy — grouped as
 *  one centered cluster with a logo + accent-rule header (no orphan chrome). */
export default function TextOnly({ brandKit, blocks, format, onOverflow }: LayoutProps) {
  const { theme } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vScale(format, 16), marginBottom: vScale(format, 10) }}>
      {brandKit.logo?.url && <LogoMark kit={brandKit} height={vScale(format, 54)} bg={bg} />}
      <AccentRule kit={brandKit} width={vScale(format, 72)} />
    </div>
  );

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
          gap={vScale(format, 26)}
          header={header}
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );
}
