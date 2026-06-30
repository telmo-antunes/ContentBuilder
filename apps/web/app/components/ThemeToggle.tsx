'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/**
 * Toggles the app between dark/light by flipping `data-theme` on <html> and
 * persisting to localStorage. The initial theme is applied before paint by the
 * inline script in the root layout, so this just mirrors + flips it.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || 'dark';
    setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cb-theme', next);
    } catch {
      /* private mode — ignore */
    }
  };

  const nextLabel = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${nextLabel} theme`}
      title={`Switch to ${nextLabel} theme`}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb">{theme === 'dark' ? '☾' : '☀'}</span>
      </span>
    </button>
  );
}
