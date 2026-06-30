'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/', label: 'Businesses', match: (p) => p === '/' || p.startsWith('/businesses') },
  { href: '/projects/new', label: 'New project', match: (p) => p === '/projects/new' },
  { href: '/gallery', label: 'Layouts', match: (p) => p.startsWith('/gallery') },
  { href: '/settings', label: 'Settings', match: (p) => p.startsWith('/settings') },
];

/** Top navigation with an active-section indicator so users always know where they are. */
export default function TopNav() {
  const pathname = usePathname() || '/';
  return (
    <nav className="topnav">
      {LINKS.map((l) => {
        const active = l.match(pathname);
        return (
          <Link key={l.href} href={l.href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
