'use client';

import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse } from '../lib/api';

/** Small connectivity indicator shown in the top bar. */
export default function HealthDot() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setDown(true));
    return () => {
      alive = false;
    };
  }, []);

  const ok = !down && health?.db === 'connected';
  const label = down ? 'API offline' : health ? `db: ${health.db}` : 'checking…';

  return (
    <span className={`badge health-pill ${down ? 'bad' : ok ? 'ok' : ''}`} title={label}>
      <span className="dot" /> <span className="health-label">{label}</span>
    </span>
  );
}
