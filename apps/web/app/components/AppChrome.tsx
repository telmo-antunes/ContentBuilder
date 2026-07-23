'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import ThemeToggle from './ThemeToggle';

/** Routes shared with people OUTSIDE the tool — no internal chrome. */
const PUBLIC_PREFIXES = ['/preview', '/share', '/render'];

const NAV: { href: string; label: string; icon: ReactNode; match: (p: string) => boolean }[] = [
  {
    href: '/',
    label: 'Studio',
    match: (p) => p === '/' || p.startsWith('/businesses') || p.startsWith('/projects'),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 11.5L12 5l8 6.5" />
        <path d="M6 10.5V19h12v-8.5" />
      </svg>
    ),
  },
  {
    href: '/projects/new',
    label: 'New project',
    match: (p) => p === '/projects/new',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3.5l1.7 4.9 4.9 1.6-4.9 1.7L12 16.5l-1.7-4.8L5.4 10l4.9-1.6L12 3.5z" />
        <path d="M18 16l.9 2.6L21.5 19l-2.6.9L18 22.5l-.9-2.6L14.5 19l2.6-.4L18 16z" strokeOpacity=".6" />
      </svg>
    ),
  },
  // NOTE: /gallery is an internal engine reference (generic archetypes, no AI /
  // no DB) — deliberately NOT in the product rail, since "layouts" in this
  // product means a brand's OWN recipe compositions, not generic ones. Still
  // reachable by URL for engineering.
  {
    href: '/settings',
    label: 'Settings',
    match: (p) => p.startsWith('/settings'),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" />
      </svg>
    ),
  },
];

/**
 * The app's left rail. Hidden on public/client-facing routes so a shared
 * preview link never exposes the internal navigation, DB status, or settings.
 */
export default function AppChrome() {
  const pathname = usePathname() || '/';
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return (
    <aside className="rail">
      <Link href="/" className="rail-mark" title="ContentBuilder">
        C
      </Link>
      <nav className="rail-nav">
        {NAV.map((n) => {
          const active = n.match(pathname);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`rail-link${active ? ' active' : ''}`}
              title={n.label}
              aria-label={n.label}
              aria-current={active ? 'page' : undefined}
            >
              {n.icon}
            </Link>
          );
        })}
      </nav>
      <div className="rail-sp" />
      <ThemeToggle />
    </aside>
  );
}
