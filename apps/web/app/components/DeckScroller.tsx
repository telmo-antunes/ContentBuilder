'use client';

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A horizontal strip that tells you when there's more: edge fades on the
 * scroller (via the .fade-l/.fade-r mask classes) and prev/next arrows that
 * only exist while slides are actually hidden. Hand-rolled — no dependencies.
 */
export default function DeckScroller({
  className,
  children,
  stacked = false,
}: {
  /** Class of the scrolling strip itself (e.g. "mo-strip"). */
  className: string;
  children: ReactNode;
  /**
   * Lay the deck out as a vertical column instead of a horizontal strip. The
   * arrows and edge fades are a strip's affordance and go with it — a stacked
   * deck scrolls with the page, the way a reader scrolls a feed.
   */
  stacked?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  const count = Children.count(children);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    // Container resizes change what fits; card count changes are caught by the
    // effect re-running (count dep).
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, count]);

  const scrollByCard = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const gap = 16; // .mo-strip gap
    const step = card ? card.offsetWidth + gap : Math.round(el.clientWidth * 0.8);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * step, behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  if (stacked) {
    return (
      <div className="deck-wrap stacked">
        <div className={`${className} stacked`}>{children}</div>
      </div>
    );
  }

  return (
    <div className="deck-wrap">
      <div
        ref={ref}
        className={`${className}${canPrev ? ' fade-l' : ''}${canNext ? ' fade-r' : ''}`}
        onScroll={update}
      >
        {children}
      </div>
      {canPrev && (
        <button
          type="button"
          className="deck-arrow prev"
          aria-label="Scroll to earlier slides"
          onClick={() => scrollByCard(-1)}
        >
          <Icon name="chevron-left" />
        </button>
      )}
      {canNext && (
        <button
          type="button"
          className="deck-arrow next"
          aria-label="Scroll to later slides"
          onClick={() => scrollByCard(1)}
        >
          <Icon name="chevron-right" />
        </button>
      )}
    </div>
  );
}
