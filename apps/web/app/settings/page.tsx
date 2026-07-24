'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSettings, updateSettings, getUsage, type AiSettings, type SettingsResponse, type UsageSummary } from '../lib/api';
import { toast } from '../components/Toast';

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<AiSettings | null>(null);
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    getSettings()
      .then((d) => {
        setData(d);
        setForm(d.settings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    getUsage()
      .then(setUsage)
      .catch(() => {});
  }, []);

  const set = (patch: Partial<AiSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const onSave = async () => {
    if (!form) return;
    setSave('saving');
    setError(null);
    try {
      await updateSettings(form);
      setSave('saved');
      toast('Settings saved');
      setTimeout(() => setSave('idle'), 1500);
    } catch (e) {
      setSave('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error && !data) {
    return (
      <div>
        <p className="muted"><Link href="/">← Studio</Link></p>
        <div className="error-box">{error}</div>
      </div>
    );
  }
  if (!data || !form) return <p className="muted">Loading settings…</p>;

  const labelStyle = { fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' } as const;

  return (
    <div style={{ maxWidth: 860 }}>
      <p className="muted" style={{ marginBottom: 6 }}><Link href="/">← Studio</Link></p>
      <h1 style={{ fontFamily: 'var(--display)', marginBottom: 4 }}>AI Settings</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Every AI touchpoint's model is overridable here. Leave a field blank to use the environment
        default. Changes apply to the next generation.
      </p>

      {error && <div className="error-box" style={{ fontSize: 13 }}>{error}</div>}

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="section-label" style={{ marginTop: 0 }}>Models — every AI touchpoint</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Each field overrides ONE touchpoint. Blank = the environment default shown as the
          placeholder. Changes apply to the next generation — no restart needed.
        </p>
        {(() => {
          const env = data.envModels;
          const visionDefault = env.modelLarge || env.model || 'env default';
          const judgmentDefault = env.modelLarge || env.modelSmall || env.model || 'env default';
          const smallDefault = env.modelSmall || env.model || 'env default';
          const designDefault = env.modelDesign || env.modelLarge || env.modelSmall || env.model || 'env default';
          const groups: Array<{ name: string; fields: Array<{ key: keyof AiSettings; label: string; hint: string; ph: string }> }> = [
            {
              name: 'On-brand generation (the recipe path)',
              fields: [
                { key: 'recipeModel', label: 'Brand recipe', hint: 'authors the brand’s design system — once per brand (design tier)', ph: designDefault },
                { key: 'composeModel', label: 'Slide compose', hint: 'writes + arranges an idea into on-brand authored slides', ph: smallDefault },
              ],
            },
            {
              name: 'Analysis & imagery',
              fields: [
                { key: 'visionModel', label: 'Brand analysis', hint: 'reads colors, type & voice from the site', ph: visionDefault },
                { key: 'photoFitModel', label: 'Photo fit', hint: 'picks the stock photo that matches the copy', ph: visionDefault },
              ],
            },
            {
              name: 'Content',
              fields: [
                { key: 'captionModel', label: 'Captions', hint: 'writes the post caption in the brand voice', ph: judgmentDefault },
              ],
            },
          ];
          const fields = groups.flatMap((g) => g.fields);
          return (
            <>
              {groups.map((g) => (
                <div key={g.name} style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {g.name}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
                    {g.fields.map((f) => (
                      <div key={f.key}>
                        <label style={labelStyle}>
                          {f.label}
                          {(form[f.key] as string).trim() !== '' && (
                            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent, #f5b657)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              override active
                            </span>
                          )}
                        </label>
                        <input
                          value={form[f.key] as string}
                          placeholder={f.ph}
                          onChange={(e) => set({ [f.key]: e.target.value } as Partial<AiSettings>)}
                        />
                        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{f.hint}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {fields.some((f) => (form[f.key] as string).trim() !== '') && (
                <button
                  className="btn sm ghost"
                  style={{ marginTop: 10 }}
                  onClick={() =>
                    set(Object.fromEntries(fields.map((f) => [f.key, ''])) as Partial<AiSettings>)
                  }
                >
                  Clear all model overrides (use env policy)
                </button>
              )}
            </>
          );
        })()}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="section-label" style={{ marginTop: 0 }}>Stock photos (Pexels)</div>
        {data.stock?.configured ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            ✓ Configured — AI drafts place fitting stock photos automatically on image slides.
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Not configured — drafts leave image placeholders. Get a free key at{' '}
            <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">pexels.com/api</a>{' '}
            and add <code>PEXELS_API_KEY=…</code> to <code>.env</code> (restart the API).
          </p>
        )}
      </div>

      {usage && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="section-label" style={{ marginTop: 0 }}>AI usage &amp; estimated cost</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {usage.totals.calls} draft {usage.totals.calls === 1 ? 'call' : 'calls'} ·{' '}
            {compact(usage.totals.inputTokens)} in / {compact(usage.totals.outputTokens)} out tokens ·{' '}
            <strong style={{ color: 'var(--text)' }}>{usd(usage.totals.costUsd)}</strong> total (estimated).
          </p>
          {usage.byModel.length > 0 ? (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>Model</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Calls</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Tokens (in/out)</th>
                  <th style={{ padding: '4px 0 4px 8px', fontWeight: 600 }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.byModel.map((m) => (
                  <tr key={m.model} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 8px 5px 0' }}><code>{m.model}</code></td>
                    <td style={{ padding: '5px 8px' }}>{m.calls}</td>
                    <td style={{ padding: '5px 8px' }}>{compact(m.inputTokens)} / {compact(m.outputTokens)}</td>
                    <td style={{ padding: '5px 0 5px 8px' }}>{usd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>No drafts generated yet.</p>
          )}
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Costs are estimated from list prices and are indicative, not billing-grade.
          </p>
        </div>
      )}

      <div className="row" style={{ marginTop: 16, gap: 10, alignItems: 'center' }}>
        <button className="btn primary" onClick={onSave} disabled={save === 'saving'}>
          {save === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
        {save === 'error' && <span style={{ color: 'var(--danger)' }}>Save failed</span>}
      </div>
    </div>
  );
}
