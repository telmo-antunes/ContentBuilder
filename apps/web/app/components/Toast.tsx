'use client';

import { useEffect, useState } from 'react';

/**
 * Tiny toast system, same imperative pattern as confirm(): call toast() from
 * anywhere; <ToastHost/> (mounted once in the root layout) renders a stack of
 * quiet, auto-dismissing confirmations bottom-right. For transient "it worked"
 * feedback — contextual errors should stay inline where they happened.
 */

export type ToastKind = 'ok' | 'error' | 'info';

type ToastItem = { id: number; message: string; kind: ToastKind };

let notify: ((t: ToastItem) => void) | null = null;
let nextId = 1;

export function toast(message: string, kind: ToastKind = 'ok'): void {
  notify?.({ id: nextId++, message, kind });
}

const DURATION_MS = 3200;

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    notify = (t) => {
      setItems((prev) => [...prev.slice(-2), t]); // at most 3 on screen
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), DURATION_MS);
    };
    return () => {
      notify = null;
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' ? '✓ ' : t.kind === 'error' ? '⚠ ' : ''}
          {t.message}
        </div>
      ))}
    </div>
  );
}
