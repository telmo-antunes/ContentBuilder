'use client';

import { useEffect } from 'react';

/**
 * Root error boundary — catches errors thrown in the root layout itself (which
 * `error.tsx` cannot). Must render its own <html>/<body> since it replaces the
 * whole document when it fires.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Renders OUTSIDE the app layout (it replaces the whole document), so the
  // Atelier dark palette is hard-coded here rather than read from globals.css.
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "'Inter', system-ui, sans-serif", background: '#17140e', color: '#ece6d8' }}>
        <div style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}>
          <h1 style={{ marginBottom: 8, fontFamily: "'Playfair Display', Georgia, serif", letterSpacing: '-0.5px' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#a69c86', marginTop: 0 }}>{error.message || 'An unexpected error occurred.'}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
            <button
              onClick={reset}
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(140deg, #6fab9f, #4d8a7f)',
                color: '#17140e',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #47402e', color: '#ece6d8', textDecoration: 'none' }}
            >
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
