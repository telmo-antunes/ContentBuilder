import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import HealthDot from './components/HealthDot';
import ThemeToggle from './components/ThemeToggle';

export const metadata: Metadata = {
  title: 'ContentBuilder',
  description: 'On-brand Instagram carousel & story asset generator',
};

// Runs before paint so the saved theme is applied with no flash of the wrong one.
const themeInit = `(function(){try{var t=localStorage.getItem('cb-theme')||'dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <header className="topbar">
          <div className="inner">
            <Link href="/" className="brand" style={{ color: 'var(--text)' }}>
              Content<span className="dot">Builder</span>
            </Link>
            <span className="tagline muted">internal asset studio</span>
            <nav className="topnav">
              <Link href="/">Businesses</Link>
              <Link href="/projects/new">New project</Link>
              <Link href="/gallery">Layouts</Link>
              <Link href="/settings">Settings</Link>
            </nav>
            <ThemeToggle />
            <HealthDot />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
