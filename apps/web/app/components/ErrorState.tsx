'use client';

/**
 * The app's error vocabulary, page-load half: a PAGE that failed to load shows
 * this — the familiar .error-box plus a Retry that re-runs the loader. ACTION
 * failures (save, move, export…) use toast(message, 'error') instead, so the
 * page you were working on stays put.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box error-state" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
