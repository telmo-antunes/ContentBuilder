'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

/** Routes shared with people OUTSIDE the tool — no internal chrome. */
const PUBLIC_PREFIXES = ['/preview', '/share', '/render'];

const NAV: { href: string; label: string; match: (p: string) => boolean }[] = [
  {
    href: '/',
    label: 'Home',
    // Home owns the Desk plus the brand rooms and existing projects reached
    // from it — but NOT the New-post route (its own tab), so exactly one tab
    // is ever active.
    match: (p) =>
      p === '/' ||
      p.startsWith('/businesses') ||
      (p.startsWith('/projects') && p !== '/projects/new'),
  },
  { href: '/projects/new', label: 'New post', match: (p) => p === '/projects/new' },
  { href: '/whats-new', label: 'AI learnings', match: (p) => p.startsWith('/whats-new') },
  { href: '/settings', label: 'Settings', match: (p) => p.startsWith('/settings') },
];

/**
 * The app's top bar (Momentum): worded tabs instead of guessable icons, the
 * primary action always in reach. Hidden on public/client-facing routes so a
 * shared preview link never exposes the internal navigation or settings.
 */
export default function AppChrome() {
  const pathname = usePathname() || '/';
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return (
    <header className="mo-top">
      <Link href="/" className="mo-top-mark">
        <i>C</i> ContentBuilder
      </Link>
      <nav className="mo-top-tabs" aria-label="Main">
        {NAV.map((n) => {
          const active = n.match(pathname);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={active ? 'active' : undefined}
              aria-current={active ? 'page' : undefined}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mo-top-sp" />
      <ThemeToggle />
      <Link className="mo-top-cta" href="/projects/new">
        ＋ New post
      </Link>
    </header>
  );
}
