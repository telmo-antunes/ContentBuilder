'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { AccentRule, LogoMark, paddingCss, safeInsets, surface, vScale } from '../primitives';
import { RenderProvider, useRenderCtx } from '../RenderContext';

/** List-forward layout — `list` blocks render as check-circle rows w/ dividers. */
export default function Checklist({ brandKit, blocks, format, onOverflow }: LayoutProps) {
  const ctx = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vScale(format, 16), marginBottom: vScale(format, 10) }}>
      {brandKit.logo?.url && <LogoMark kit={brandKit} height={vScale(format, 50)} bg={bg} />}
      <AccentRule kit={brandKit} width={vScale(format, 72)} />
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, background: surface(brandKit, ctx.theme) }}>
      <div style={{ position: 'absolute', inset: 0, padding: paddingCss(insets) }}>
        <RenderProvider value={{ ...ctx, checklist: true }}>
          <FitStack
            blocks={blocks}
            brandKit={brandKit}
            format={format}
            bg={bg}
            align="start"
            justify="center"
            gap={vScale(format, 24)}
            header={header}
            onOverflow={onOverflow}
          />
        </RenderProvider>
      </div>
    </div>
  );
}
