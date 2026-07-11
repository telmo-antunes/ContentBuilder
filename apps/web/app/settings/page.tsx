'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSettings, updateSettings, getUsage, type AiSettings, type SettingsResponse, type UsageSummary } from '../lib/api';

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const FREE_TOKENS = '{{width}} {{height}} {{xMin}} {{xMax}} {{yMin}} {{yMax}} {{blockTypes}} {{maxSlides}}';

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
      setTimeout(() => setSave('idle'), 1500);
    } catch (e) {
      setSave('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error && !data) {
    return (
      <div>
        <p className="muted"><Link href="/">← Businesses</Link></p>
        <div className="error-box">{error}</div>
      </div>
    );
  }
  if (!data || !form) return <p className="muted">Loading settings…</p>;

  const labelStyle = { fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' } as const;
  const taStyle = { width: '100%', minHeight: 220, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.5 } as const;

  return (
    <div style={{ maxWidth: 860 }}>
      <p className="muted" style={{ marginBottom: 6 }}><Link href="/">← Businesses</Link></p>
      <h1 style={{ fontFamily: "'Montserrat', sans-serif", marginBottom: 4 }}>AI Settings</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Every AI touchpoint's model is overridable here, plus the draft system prompts. Leave a
        field blank to use the environment/built-in default. Changes apply to the next generation.
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
          const fields: Array<{ key: keyof AiSettings; label: string; hint: string; ph: string }> = [
            { key: 'designerModel', label: 'Draft — Designer', hint: 'arranges copy into preset layouts', ph: smallDefault },
            { key: 'freeModel', label: 'Draft — Free canvas', hint: 'positions blocks freely (hardest task)', ph: judgmentDefault },
            { key: 'visionModel', label: 'Brand analysis', hint: 'reads colors, type & voice from the site', ph: visionDefault },
            { key: 'critiqueModel', label: 'Layout critique', hint: 'reviews rendered slides (Polish)', ph: visionDefault },
            { key: 'captionModel', label: 'Captions', hint: 'writes the post caption in the brand voice', ph: judgmentDefault },
            { key: 'campaignModel', label: 'Campaign planning', hint: 'turns a brief into a post series', ph: judgmentDefault },
            { key: 'backgroundModel', label: 'Background picker', hint: 'ranks motifs from the vetted menu', ph: smallDefault },
            { key: 'templatesModel', label: 'Brand compositions', hint: 'designs the brand’s signature layout pack', ph: judgmentDefault },
            { key: 'alternativesModel', label: 'Slide alternatives', hint: 'proposes 3 layout variants of a slide', ph: judgmentDefault },
          ];
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
              {fields.map((f) => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  <input
                    value={form[f.key] as string}
                    placeholder={f.ph}
                    onChange={(e) => set({ [f.key]: e.target.value } as Partial<AiSettings>)}
                  />
                  <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{f.hint}</div>
                </div>
              ))}
            </div>
          );
        })()}
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

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="section-label" style={{ marginTop: 0 }}>Designer system prompt</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => set({ designerSystem: data.defaults.designerSystem })}>Load default</button>
            <button className="btn sm ghost" onClick={() => set({ designerSystem: '' })}>Clear (use default)</button>
          </div>
        </div>
        <textarea style={taStyle} value={form.designerSystem} placeholder="(blank → built-in default — click “Load default” to edit it)" onChange={(e) => set({ designerSystem: e.target.value })} />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="section-label" style={{ marginTop: 0 }}>Free system prompt (template)</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => set({ freeSystem: data.defaults.freeSystem })}>Load default</button>
            <button className="btn sm ghost" onClick={() => set({ freeSystem: '' })}>Clear (use default)</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Tokens are filled in per request: <code>{FREE_TOKENS}</code>
        </p>
        <textarea style={taStyle} value={form.freeSystem} placeholder="(blank → built-in default — click “Load default” to edit it)" onChange={(e) => set({ freeSystem: e.target.value })} />
        <div style={{ marginTop: 8, maxWidth: 200 }}>
          <label style={labelStyle}>Free max tokens</label>
          <input
            type="number"
            value={form.freeMaxTokens ?? ''}
            placeholder={String(data.defaults.freeMaxTokens)}
            onChange={(e) => set({ freeMaxTokens: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 16, gap: 10, alignItems: 'center' }}>
        <button className="btn primary" onClick={onSave} disabled={save === 'saving'}>
          {save === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
        {save === 'saved' && <span className="muted">Saved ✓</span>}
        {save === 'error' && <span style={{ color: 'var(--danger)' }}>Save failed</span>}
      </div>
    </div>
  );
}
