import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <h1 style={{ marginBottom: 8 }}>Page not found</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        That page doesn&apos;t exist or may have been deleted.
      </p>
      <div style={{ marginTop: 16 }}>
        <Link className="btn primary" href="/">
          ← Back to the studio
        </Link>
      </div>
    </div>
  );
}
