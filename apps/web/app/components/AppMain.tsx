'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Routes that are real WORKSPACES (a canvas plus a side column) get the wide
 * container; everything else keeps the calm reading width. Route-aware here so
 * pages don't each have to know about the shell's layout.
 */
const WIDE = [/^\/projects\/[^/]+\/review$/, /^\/businesses\/[^/]+\/brand-kit$/];

export default function AppMain({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const wide = WIDE.some((re) => re.test(pathname));
  return <main className={`container${wide ? ' container-wide' : ''}`}>{children}</main>;
}
