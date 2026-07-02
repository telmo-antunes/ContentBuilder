'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface OverflowItem {
  label: ReactNode;
  onClick: () => void;
  /** Render in the danger color (destructive actions live here, demoted). */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * A "…" overflow menu for secondary/destructive row actions. Keeps Delete off
 * the primary surface (it used to sit at equal prominence with Open/Edit on
 * every list row) while staying one small click away.
 */
export function OverflowMenu({ items, label = 'More actions' }: { items: OverflowItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="btn sm ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        style={{ paddingInline: 10, fontWeight: 700, letterSpacing: 1 }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            zIndex: 40,
            minWidth: 160,
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className="btn sm ghost"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              style={{
                justifyContent: 'flex-start',
                textAlign: 'left',
                width: '100%',
                ...(item.danger ? { color: 'var(--danger, #f87171)' } : {}),
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
