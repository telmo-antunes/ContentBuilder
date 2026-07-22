'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import HealthDot from './HealthDot';
import ThemeToggle from './ThemeToggle';
import TopNav from './TopNav';

/** Routes that are shared with people OUTSIDE the tool — no internal chrome. */
const PUBLIC_PREFIXES = ['/preview', '/share', '/render'];

/**
 * The app's top bar. Hidden on public/client-facing routes so a shared
 * preview link never exposes the internal navigation, DB status, or settings.
 */
export default function AppChrome() {
  const pathname = usePathname() || '/';
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return (
    <header className="topbar">
      <div className="inner">
        <Link href="/" className="brand" style={{ color: 'var(--text)' }}>
          Content<span className="dot">Builder</span>
        </Link>
        <span className="tagline muted">internal asset studio</span>
        <TopNav />
        <ThemeToggle />
        <HealthDot />
      </div>
    </header>
  );
}
