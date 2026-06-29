'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {error.message || 'An unexpected error occurred.'}
      </p>
      <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
        <button className="btn primary" onClick={reset}>
          Try again
        </button>
        <Link className="btn" href="/">
          Back to businesses
        </Link>
      </div>
    </div>
  );
}
