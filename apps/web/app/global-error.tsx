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

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0c0e13', color: '#f2f4f8' }}>
        <div style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}>
          <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ opacity: 0.7, marginTop: 0 }}>{error.message || 'An unexpected error occurred.'}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
            <button
              onClick={reset}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#5a8cff', color: '#fff', cursor: 'pointer' }}
            >
              Try again
            </button>
            <a href="/" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #333', color: '#f2f4f8', textDecoration: 'none' }}>
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
