import type { CSSProperties } from 'react';

/**
 * The app's loading vocabulary, part 1 of 2: shimmer skeletons for PAGE loads.
 * Pages compose these primitives into a rough shape of the content they're
 * waiting for — recognizable, not pixel-perfect ghosts. (Part 2 is
 * WorkingPanel, which narrates LONG AI waits; keep using that for those.)
 */
export function Skeleton({
  shape = 'block',
  w,
  h,
  style,
  className,
}: {
  shape?: 'block' | 'line' | 'circle';
  w?: number | string;
  h?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`skel skel-${shape}${className ? ` ${className}` : ''}`}
      style={{
        width: w ?? (shape === 'circle' ? h : undefined),
        height: h ?? (shape === 'circle' ? w : undefined),
        ...style,
      }}
    />
  );
}
