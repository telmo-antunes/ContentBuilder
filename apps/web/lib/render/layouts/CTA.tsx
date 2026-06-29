'use client';

import type { LayoutProps } from '../types';
import { FitStack } from '../blocks';
import { AccentRule, LogoMark, paddingCss, rgba, safeInsets, surface, vScale } from '../primitives';
import { useRenderCtx } from '../RenderContext';

/** Closing call-to-action: one centered cluster — accent rule, text, logo. */
export default function CTA({ brandKit, blocks, format, onOverflow }: LayoutProps) {
  const { theme } = useRenderCtx();
  const bg = brandKit.colors.background;
  const insets = safeInsets(format);

  const header = <AccentRule kit={brandKit} width={vScale(format, 72)} style={{ marginBottom: vScale(format, 6) }} />;
  const footer = brandKit.logo?.url ? (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: vScale(format, 16),
        marginTop: vScale(format, 10),
      }}
    >
      <div style={{ width: vScale(format, 120), height: 1, background: rgba(brandKit.colors.text, 0.16) }} />
      <LogoMark kit={brandKit} height={vScale(format, 64)} bg={bg} />
    </div>
  ) : null;

  return (
    <div style={{ position: 'absolute', inset: 0, background: surface(brandKit, theme) }}>
      <div style={{ position: 'absolute', inset: 0, padding: paddingCss(insets) }}>
        <FitStack
          blocks={blocks}
          brandKit={brandKit}
          format={format}
          bg={bg}
          align="center"
          justify="center"
          gap={vScale(format, 26)}
          header={header}
          footer={footer}
          onOverflow={onOverflow}
        />
      </div>
    </div>
  );
}
