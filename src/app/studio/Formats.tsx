'use client';
import type { CSSProperties } from 'react';
import { formats } from '@/lib/formats';

export function Formats({ width, height, onChange, disabled }: { width: number; height: number; onChange: (size: { width: number; height: number }) => void; disabled?: boolean }) {
  return <div className="formats" role="radiogroup" aria-label="Format">
    {formats.map(format => {
      const on = format.width === width && format.height === height;
      return <button type="button" key={format.id} role="radio" aria-checked={on} className={`format${on ? ' on' : ''}`} disabled={disabled}
        onClick={() => onChange({ width: format.width, height: format.height })}>
        <span className="format-shape" style={{ '--fw': format.width / format.height } as CSSProperties} aria-hidden="true" />
        <span><strong>{format.label}</strong><small>{format.ratio}</small></span>
      </button>;
    })}
  </div>;
}
