'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSettings, updateSettings, getUsage, type AiSettings, type SettingsResponse, type UsageSummary } from '../lib/api';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * SETTINGS — the machine room, as ledger lines (The Ledger, batch 7).
 *
 * Each AI touchpoint is one line: the job in plain words, the model that
 * ACTUALLY runs it today (override or default, stated as such), and an
 * Override that expands the line into its input. The cost table becomes
 * readable bars, with the full per-model detail one <details> away.
 */
export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<AiSettings | null>(null);
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getSettings()
      .then((d) => {
        setData(d);
        setForm(d.settings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    getUsage()
      .then(setUsage)
      .catch(() => {});
  };

  useEffect(load, []);

  const set = (patch: Partial<AiSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const onSave = async () => {
    if (!form) return;
    setSave('saving');
    try {
      await updateSettings(form);
      setSave('saved');
      toast('Settings saved');
      setTimeout(() => setSave('idle'), 1500);
    } catch (e) {
      setSave('error');
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const maxCost = useMemo(
    () => Math.max(...(usage?.byModel.map((m) => m.costUsd) ?? [0]), 0.0001),
    [usage],
  );

  if (error && !data) {
    return (
      <div className="mo-page mo-kit">
        <p className="mo-crumb"><Link href="/">Home</Link> / Settings</p>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!data || !form) {
    return (
      <div className="mo-page mo-kit" style={{ maxWidth: 860 }} role="status" aria-label="Loading settings">
        <Skeleton shape="line" w={120} h={12} style={{ marginBottom: 14 }} />
        <Skeleton shape="block" w={280} h={34} style={{ marginBottom: 18 }} />
        <Skeleton shape="block" h={380} style={{ borderRadius: 22 }} />
      </div>
    );
  }

  const env = data.envModels;
  const visionDefault = env.modelLarge || env.model || 'env default';
  const judgmentDefault = env.modelLarge || env.modelSmall || env.model || 'env default';
  const smallDefault = env.modelSmall || env.model || 'env default';
  const designDefault = env.modelDesign || env.modelLarge || env.modelSmall || env.model || 'env default';
  const rows: Array<{ key: keyof AiSettings; label: string; hint: string; ph: string }> = [
    { key: 'recipeModel', label: 'Brand recipe', hint: 'designs the look — once per brand', ph: designDefault },
    { key: 'composeModel', label: 'Slide compose', hint: 'writes & arranges the deck', ph: smallDefault },
    { key: 'visionModel', label: 'Brand analysis', hint: 'reads colors, type & voice from websites', ph: visionDefault },
    { key: 'captionModel', label: 'Captions', hint: 'writes the caption in the brand voice', ph: judgmentDefault },
  ];
  const anyOverride = rows.some((r) => (form[r.key] as string).trim() !== '');

  return (
    <div className="mo-page mo-kit mo-ledger" style={{ maxWidth: 900, margin: '0 auto' }}>
      <p className="mo-crumb"><Link href="/">Home</Link> / Settings</p>
      <h1 style={{ fontFamily: 'var(--mo-disp)', fontWeight: 600, fontSize: 27, letterSpacing: '-0.03em', margin: '0 0 18px' }}>
        The machine room
      </h1>

      <div className="mo-dossier" style={{ marginBottom: 14 }}>
        <div className="mo-dhead">
          <div>
            <div className="t">What runs each job</div>
            <div className="s">the model shown is the one that actually runs today — blank override means the environment default</div>
          </div>
        </div>
        {rows.map((r) => {
          const override = (form[r.key] as string).trim();
          const isOpen = open === r.key;
          return (
            <div className="lgrow" key={r.key}>
              <span className="l">
                {r.label}
                <small>{r.hint}</small>
              </span>
              <span className="v">
                {override || r.ph}
                {!override && <span className="def"> · the default</span>}
              </span>
              <span className="side">
                <span className={`mo-dst ${override ? 'busy' : 'ok'}`}>{override ? 'override' : 'default'}</span>
                <button className="edit" onClick={() => setOpen(isOpen ? null : r.key)}>
                  {isOpen ? 'Close' : override ? 'Edit' : 'Override'}
                </button>
              </span>
              {isOpen && (
                <div className="mo-drow-body">
                  <input
                    value={form[r.key] as string}
                    placeholder={r.ph}
                    autoFocus
                    onChange={(e) => set({ [r.key]: e.target.value } as Partial<AiSettings>)}
                  />
                  <p style={{ fontSize: 11.5, color: 'var(--mo-faint)', margin: '6px 0 0' }}>
                    Blank uses the environment default ({r.ph}). Changes apply to the next generation — no restart.
                    {override && (
                      <>
                        {' '}
                        <button className="edit" onClick={() => set({ [r.key]: '' } as Partial<AiSettings>)}>
                          Clear this override
                        </button>
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          );
        })}
        <div className="lgrow">
          <span className="l">
            Stock photos
            <small>the editor&rsquo;s Pexels picker</small>
          </span>
          <span className="v" style={{ fontFamily: 'var(--ui, inherit)', fontSize: 13 }}>
            {data.stock?.configured ? (
              'Connected — stock search runs against the live catalogue'
            ) : (
              <>
                Not configured — get a free key at{' '}
                <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">pexels.com/api</a> and add{' '}
                <code>PEXELS_API_KEY</code> to <code>.env</code>
              </>
            )}
          </span>
          <span className={`mo-dst ${data.stock?.configured ? 'ok' : 'warn'}`}>
            {data.stock?.configured ? '✓ configured' : 'off'}
          </span>
        </div>

        {usage && (
          <div className="mo-ubars">
            <div className="uh">
              <span className="t">Usage, all time</span>
              <span className="tot">
                {usage.totals.calls} call{usage.totals.calls === 1 ? '' : 's'} · {compact(usage.totals.inputTokens)} in /{' '}
                {compact(usage.totals.outputTokens)} out · <b>{usd(usage.totals.costUsd)}</b> estimated
              </span>
            </div>
            {usage.byModel.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--mo-faint)', margin: 0 }}>No drafts generated yet.</p>
            ) : (
              <>
                {usage.byModel.map((m) => (
                  <div className="mo-ubar" key={m.model}>
                    <span className="m" title={m.model}>{m.model}</span>
                    <span className="track">
                      <i style={{ width: `${Math.max(3, Math.round((100 * m.costUsd) / maxCost))}%` }} />
                    </span>
                    <span className="c">{usd(m.costUsd)}</span>
                  </div>
                ))}
                <details>
                  <summary>The full table</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Calls</th>
                        <th>Tokens (in/out)</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.byModel.map((m) => (
                        <tr key={m.model}>
                          <td><code>{m.model}</code></td>
                          <td>{m.calls}</td>
                          <td>
                            {compact(m.inputTokens)} / {compact(m.outputTokens)}
                          </td>
                          <td>{usd(m.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                <p className="foot">Costs are estimated from list prices — indicative, not billing-grade.</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button className="mo-btn prim" onClick={onSave} disabled={save === 'saving'}>
          {save === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
        {anyOverride && (
          <button
            className="mo-btn"
            onClick={() => set(Object.fromEntries(rows.map((r) => [r.key, ''])) as Partial<AiSettings>)}
          >
            Clear all overrides
          </button>
        )}
        {save === 'error' && <span style={{ color: 'var(--mo-red)', fontSize: 13 }}>Save failed</span>}
      </div>
    </div>
  );
}
