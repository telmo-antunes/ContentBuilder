'use client';

import { useEffect, useState } from 'react';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

// Set by the mounted <ConfirmHost/>. Module-level so confirm() can be called
// from anywhere (like window.confirm) without threading a hook through the tree.
let notify: ((p: Pending) => void) | null = null;

/**
 * Promise-based, on-brand replacement for window.confirm(). Resolves true when
 * the user confirms, false otherwise. Renders via <ConfirmHost/> (mounted once
 * in the root layout). Falls back to the native dialog if the host isn't mounted.
 */
export function confirm(input: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof input === 'string' ? { message: input } : input;
  if (!notify) {
    if (typeof window !== 'undefined') return Promise.resolve(window.confirm(opts.message));
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => notify!({ ...opts, resolve }));
}

export default function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    // Replacing an open dialog resolves the previous request as cancelled.
    notify = (p) => setPending((prev) => {
      if (prev) prev.resolve(false);
      return p;
    });
    return () => { notify = null; };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
      else if (e.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
     
  }, [pending]);

  function settle(v: boolean) {
    setPending((prev) => {
      prev?.resolve(v);
      return null;
    });
  }

  if (!pending) return null;
  return (
    <div className="modal-overlay" onClick={() => settle(false)} role="presentation">
      <div
        className="modal"
        style={{ maxWidth: 420 }}
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title ?? 'Confirm'}
        onClick={(e) => e.stopPropagation()}
      >
        {pending.title && <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{pending.title}</h3>}
        <p style={{ margin: '0 0 22px', fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}>
          {pending.message}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => settle(false)}>
            {pending.cancelText ?? 'Cancel'}
          </button>
          <button
            className={`btn ${pending.destructive ? 'danger' : 'primary'}`}
            autoFocus
            onClick={() => settle(true)}
          >
            {pending.confirmText ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
