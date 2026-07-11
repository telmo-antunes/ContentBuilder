'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { Block, Format } from '@contentbuilder/shared';
import type { RenderBrandKit } from './types';
import { typeScale, type BlockStyle } from './typeScale';
import { resolveColor, onColor, mix, rgba } from './color';
import { useFitScale } from './useFitScale';
import { useRenderCtx } from './RenderContext';
import { themeTokens } from './theme';

/** Whether a block carries renderable content (empty blocks are skipped). */
export function blockHasContent(block: Block): boolean {
  if (block.type === 'list') return (block.items?.some((i) => i.trim() !== '')) ?? false;
  return block.text.trim() !== '';
}

/**
 * Absolute legibility floor (px on the 1080 canvas). The fitter shrinks text down
 * to this size to keep the whole post visible — fully showing the copy wins over
 * holding each block at its design minimum and clipping the overflow.
 */
export const HARD_MIN_PX = 13;

function fontSizeCss(style: BlockStyle): string {
  // Lower bound is the hard floor (not the design min), so a long stack can shrink
  // past its design minimum to fit instead of being cut off. The fit search always
  // picks the LARGEST scale that fits, so well-sized copy still renders at its
  // designed size — only over-long copy dips below the design min.
  return `clamp(${HARD_MIN_PX}px, calc(${style.max}px * var(--fit-scale, 1)), ${style.max}px)`;
}

function baseTextStyle(style: BlockStyle, kit: RenderBrandKit, bg: string): CSSProperties {
  return {
    fontFamily: `'${kit.fonts.render[style.role]}', sans-serif`,
    fontSize: fontSizeCss(style),
    fontWeight: style.weight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textTransform: style.transform,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: resolveColor(style.color, kit, bg),
    margin: 0,
    maxWidth: '100%',
    // Wrapping policy differs by role — this is what stops mid-word butchery:
    // · HEADINGS: `overflowWrap: normal` means an over-long word does NOT break —
    //   it widens scrollWidth, the fitter detects it, and SHRINKS the type until
    //   the word fits on one line. Headlines never split mid-word. `text-wrap:
    //   balance` evens the lines so a wrap never strands one orphan word.
    // · BODY: shrinking body copy below readability to save a long URL is worse
    //   than wrapping it — `break-word` breaks only a word wider than the whole
    //   column, and `hyphens: auto` adds a hyphen when the dictionary allows.
    ...(style.role === 'heading'
      ? { overflowWrap: 'normal' as const, textWrap: 'balance' as CSSProperties['textWrap'] }
      : { overflowWrap: 'break-word' as const, hyphens: 'auto' as const }),
    wordBreak: 'normal',
  };
}

function BlockView({
  block,
  style,
  kit,
  bg,
}: {
  block: Block;
  style: BlockStyle;
  kit: RenderBrandKit;
  bg: string;
}) {
  // Hooks must run unconditionally — a block whose style/variant changes in the
  // editor would otherwise shift the hook order and corrupt component state.
  const renderCtx = useRenderCtx();
  const text = baseTextStyle(style, kit, bg);

  // Eyebrow kicker — decoration follows the active theme.
  if (style.kicker) {
    const eyebrow = themeTokens(renderCtx.theme).eyebrow;
    if (eyebrow === 'chip') {
      const accent = kit.colors.accent;
      return (
        <span
          style={{ ...text, display: 'inline-block', background: accent, color: onColor(accent, kit), padding: '0.4em 0.85em', borderRadius: '0.45em' }}
        >
          {block.text}
        </span>
      );
    }
    if (eyebrow === 'pill') {
      return (
        <span
          style={{ ...text, display: 'inline-block', background: rgba(kit.colors.accent, 0.16), padding: '0.4em 0.95em', borderRadius: 999 }}
        >
          {block.text}
        </span>
      );
    }
    if (eyebrow === 'plain') {
      return <div style={text}>{block.text}</div>;
    }
    // 'rule' — a short gradient bar leading the label.
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.7em', maxWidth: '100%' }}>
        <span
          style={{
            width: '1.7em',
            height: '0.16em',
            borderRadius: 999,
            flex: '0 0 auto',
            background: `linear-gradient(90deg, ${kit.colors.primary}, ${kit.colors.accent})`,
          }}
        />
        <span style={text}>{block.text}</span>
      </div>
    );
  }

  if (style.variant === 'cta') {
    const accent = kit.colors.accent;
    return (
      <span
        style={{
          ...baseTextStyle(style, kit, accent),
          display: 'inline-block',
          background: `linear-gradient(135deg, ${accent}, ${mix(accent, kit.colors.primary, 0.5)})`,
          color: onColor(accent, kit),
          padding: '0.6em 1.2em',
          borderRadius: '0.7em',
          boxShadow: '0 16px 38px rgba(0,0,0,0.28)',
        }}
      >
        {block.text}
      </span>
    );
  }

  if (style.variant === 'list') {
    const marker = resolveColor('accent', kit, bg);
    const items = (block.items ?? []).filter((i) => i.trim() !== '');
    const asChecklist = renderCtx.checklist;
    if (asChecklist) {
      // Check-circle rows with hairline dividers (the Checklist layout).
      return (
        <ul style={{ ...text, listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.7em', width: '100%' }}>
          {items.map((item, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                gap: '0.6em',
                alignItems: 'center',
                paddingBottom: '0.7em',
                borderBottom: i < items.length - 1 ? `1px solid ${rgba(resolveColor('text', kit, bg), 0.12)}` : 'none',
              }}
            >
              <span
                style={{
                  width: '1.15em',
                  height: '1.15em',
                  borderRadius: 999,
                  background: marker,
                  color: onColor(marker, kit),
                  flex: '0 0 auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7em',
                  fontWeight: 800,
                }}
              >
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <ul style={{ ...text, listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.55em' }}>
        {items.map((item, i) => (
          <li key={i} style={{ display: 'flex', gap: '0.6em', alignItems: 'flex-start' }}>
            <span
              style={{
                width: '0.5em',
                height: '0.5em',
                borderRadius: 3,
                background: marker,
                flex: '0 0 auto',
                marginTop: '0.46em',
              }}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (style.variant === 'quote') {
    return <div style={text}>{`“${block.text}”`}</div>;
  }

  return <div style={text}>{block.text}</div>;
}

/**
 * Floor scale for the fit search: the smallest multiplier at which the largest
 * block reaches the hard legibility floor (smaller blocks clamp there too). This
 * lets the search shrink past each block's design min so long copy fits instead
 * of clipping; `overflow` is only reported if even this floor can't contain it.
 */
function computeFloor(styles: BlockStyle[]): number {
  if (styles.length === 0) return 1;
  return Math.min(...styles.map((s) => HARD_MIN_PX / s.max));
}

export interface FitStackProps {
  blocks: Block[];
  brandKit: RenderBrandKit;
  format: Format;
  /** Background color the text sits on (for contrast). */
  bg: string;
  align?: 'start' | 'center' | 'end';
  justify?: 'start' | 'center' | 'end';
  gap?: number;
  onOverflow?: (overflow: boolean) => void;
  style?: CSSProperties;
  /** Optional chrome (logo, accent rule) rendered inside the fitted group so it
   *  groups + centers with the text instead of being pinned to the slide edges. */
  header?: ReactNode;
  footer?: ReactNode;
}

/**
 * Renders the present blocks in order using the brand type scale, auto-fitting
 * the whole stack into its bounded box. Layouts position this; it never assumes
 * which block types are present.
 */
export function FitStack({
  blocks,
  brandKit,
  format,
  bg,
  align = 'start',
  justify = 'start',
  gap = 22,
  onOverflow,
  style,
  header,
  footer,
}: FitStackProps) {
  const scale = typeScale(format);
  // Keep each block's ORIGINAL index: the editor (frame auto-grow) and the
  // canvas conversion measure rendered blocks by `data-block-idx`, which must
  // address slide.blocks[i], not the filtered render list.
  const presentWithIdx = blocks
    .map((b, i) => [b, i] as const)
    .filter(([b]) => blockHasContent(b));
  const present = presentWithIdx.map(([b]) => b);
  const styles = present.map((b) => scale[b.type]);
  const floor = computeFloor(styles);

  const fit = useFitScale(floor, [JSON.stringify(present), format, bg]);

  useEffect(() => {
    onOverflow?.(fit.overflow);
  }, [fit.overflow, onOverflow]);

  const alignItems = align === 'center' ? 'center' : align === 'end' ? 'flex-end' : 'flex-start';
  const justifyContent = justify === 'center' ? 'center' : justify === 'end' ? 'flex-end' : 'flex-start';
  const textAlign = align === 'center' ? 'center' : align === 'end' ? 'right' : 'left';

  return (
    <div
      ref={fit.containerRef}
      style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent, ...style }}
    >
      <div
        ref={fit.contentRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems,
          textAlign,
          gap: `calc(${gap}px * var(--fit-scale, 1))`,
          width: '100%',
        }}
      >
        {header}
        {presentWithIdx.map(([b, origIdx], i) => (
          <div key={i} data-block-idx={origIdx} style={{ width: '100%', maxWidth: '100%' }}>
            <BlockView block={b} style={scale[b.type]} kit={brandKit} bg={bg} />
          </div>
        ))}
        {footer}
      </div>
    </div>
  );
}
