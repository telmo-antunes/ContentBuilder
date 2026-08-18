import type { ReactNode, SVGProps } from 'react';

/**
 * The app's single icon vocabulary — small stroke-based glyphs drawn on a 24px
 * grid at 1.5px stroke, matching the weight of the three nav-rail icons. They
 * inherit `currentColor`, so they tint with whatever text they sit beside.
 *
 * These are CHROME icons only: anything rendered inside an authored slide or
 * seeded brand content is content, not chrome, and never uses this set.
 */
const GLYPHS = {
  sparkle: (
    <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" />
  ),
  play: <path d="M8 5.5v13l11-6.5-11-6.5z" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  video: (
    <>
      <rect x="3" y="6.5" width="13.5" height="11" rx="2" />
      <path d="M16.5 10.8l4.5-2.8v8l-4.5-2.8" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l1-4L16.6 4.4a2 2 0 013 3L8 19l-4 1z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 5v14M6 13l6 6 6-6" />,
  'chevron-left': <path d="M14.5 5.5L8 12l6.5 6.5" />,
  'chevron-right': <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  ellipsis: (
    <g fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </g>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
      <path d="M10.6 5.2h2.8" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 15.5L16 11l-8.5 8" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4L2.8 19.5h18.4L12 4z" />
      <path d="M12 10.2v4.2M12 17.2v.1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  circle: <circle cx="12" cy="12" r="7.5" />,
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2L5.6 5.6" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v.5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 109-9 9.5 9.5 0 00-6.9 3L3 8" />
      <path d="M3 3v5h5M12 7v5l4 2" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 019-9 9.5 9.5 0 016.9 3L21 8M21 3v5h-5" />
      <path d="M21 12a9 9 0 01-9 9 9.5 9.5 0 01-6.9-3L3 16M3 21v-5h5" />
    </>
  ),
  /** A cited source — the page a brief says the post is made from. */
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 005.7 0l3.3-3.3a4 4 0 10-5.7-5.7l-1.6 1.6" />
      <path d="M13.5 10.5a4 4 0 00-5.7 0l-3.3 3.3a4 4 0 105.7 5.7l1.6-1.6" />
    </>
  ),
  /** Copy the user locked with quotation marks — used word for word. */
  quote: (
    <>
      <path d="M9.5 6.5C7 7.6 5.5 9.9 5.5 12.6v4.9h5.2v-5.2H8.1c0-2 .6-3.4 2.2-4.3z" />
      <path d="M19 6.5c-2.5 1.1-4 3.4-4 6.1v4.9h5.2v-5.2h-2.6c0-2 .6-3.4 2.2-4.3z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

export function Icon({
  name,
  size = 16,
  className,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : 'icon'}
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  );
}
