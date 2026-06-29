'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface FitResult {
  containerRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  /** True when content can't fit even at the minimum scale (warn, don't clip). */
  overflow: boolean;
}

/**
 * Auto-fits a block stack inside a bounded container by searching a single
 * scale multiplier in [floor, 1], written to the `--fit-scale` CSS variable
 * (each block's font-size is `clamp(min, max * --fit-scale, max)`). At `floor`
 * every block is at the legibility floor; if it still overflows, `overflow` is
 * reported true rather than shrinking more.
 *
 * Text is allowed to wrap to the container width (see `overflowWrap` in
 * blocks.tsx), so the binding constraint is height — the reliable measurement.
 * The fit re-runs after fonts load because brand fonts use `font-display: swap`:
 * a fallback paints first, then the real font swaps in and reflows the text
 * WITHOUT resizing the fixed-size container, so the ResizeObserver alone won't
 * catch it.
 */
export function useFitScale(floor: number, deps: unknown[]): FitResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    let cancelled = false;

    const setScale = (s: number) => container.style.setProperty('--fit-scale', String(s));
    const fits = (s: number) => {
      setScale(s);
      // +1px tolerance for sub-pixel rounding. Check BOTH axes: height is the
      // primary constraint (text wraps to the column width); width is a backstop.
      return (
        content.scrollHeight <= container.clientHeight + 1 &&
        content.scrollWidth <= container.clientWidth + 1
      );
    };

    const run = () => {
      if (cancelled || container.clientHeight === 0) return;
      if (fits(1)) {
        setOverflow(false);
        return;
      }
      if (!fits(floor)) {
        setScale(floor);
        setOverflow(true);
        return;
      }
      let lo = floor;
      let hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      setScale(lo);
      setOverflow(false);
    };

    let ro: ResizeObserver | undefined;
    const start = () => {
      if (cancelled) return;
      run();
      // Re-measure on the next frame to catch late layout settling.
      requestAnimationFrame(() => run());
      ro = new ResizeObserver(() => run());
      ro.observe(container);
    };

    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts?.ready) fonts.ready.then(start).catch(start);
    else start();

    // Re-fit whenever a font finishes loading (the swap reflow doesn't resize the
    // container, so the ResizeObserver above won't fire), plus a one-shot safety
    // pass in case the swap completed before this listener was attached.
    const refit = () => run();
    fonts?.addEventListener?.('loadingdone', refit);
    const safety = setTimeout(refit, 300);

    return () => {
      cancelled = true;
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', refit);
      clearTimeout(safety);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { containerRef, contentRef, overflow };
}
