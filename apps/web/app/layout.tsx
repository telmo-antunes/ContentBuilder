import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import HealthDot from './components/HealthDot';

export const metadata: Metadata = {
  title: 'ContentBuilder',
  description: 'On-brand Instagram carousel & story asset generator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
            <HealthDot />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
