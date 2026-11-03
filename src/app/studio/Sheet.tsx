'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

// A bottom sheet on phones, a side drawer on wide screens. Closes on Escape or a tap outside.
export function Sheet({ open, title, onClose, children, side = 'right', className = '' }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; side?: 'right' | 'left'; className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); previous?.focus?.({ preventScroll: true }); };
  }, [open, onClose]);
  return <div className={`sheet-root${open ? ' open' : ''} side-${side} ${className}`} aria-hidden={!open} {...(open ? {} : { inert: '' } as object)}>
    <div className="scrim" onClick={onClose} />
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
      <header className="sheet-head"><span className="grabber" aria-hidden="true" /><h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close" /></button></header>
      <div className="sheet-body">{children}</div>
    </div>
  </div>;
}
