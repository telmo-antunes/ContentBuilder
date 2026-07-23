'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { AssetType, BusinessGoal, Format } from '@contentbuilder/shared';
import {
  ALLOWED_FORMATS,
  ASSET_TYPES,
  FORMAT_LABELS,
  BUSINESS_GOALS,
  defaultFormatFor,
} from '@contentbuilder/shared';
import { listBusinesses, createCampaign, getHealth, type BusinessSummary } from '../../lib/api';

const BRIEF_EXAMPLE =
  'A 5-part educational series that builds trust with detail-shop owners: why software beats spreadsheets, ' +
  'a day-in-the-life with the dashboard, a customer win story, the 3 metrics every shop should track, and a soft CTA to book a demo.';

function NewCampaignForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState(true);

  const [businessId, setBusinessId] = useState(params.get('businessId') ?? '');
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(5);
  const [goal, setGoal] = useState<BusinessGoal | ''>('');
  const [type, setType] = useState<AssetType>('carousel');
  const [format, setFormat] = useState<Format>('1080x1080');

  useEffect(() => {
    listBusinesses()
      .then((all) => {
        const approved = all.filter((b) => b.hasApprovedKit && b.hasProfile);
        setBusinesses(approved);
        setBusinessId((cur) => cur || approved[0]?._id || '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    getHealth()
      .then((h) => setAiDraft(Boolean(h.ai?.draft)))
      .catch(() => setAiDraft(false));
  }, []);

  const formats = ALLOWED_FORMATS[type];
  useEffect(() => {
    if (!formats.includes(format)) setFormat(defaultFormatFor(type));
  }, [type, formats, format]);

  const selectedBiz = useMemo(() => businesses?.find((b) => b._id === businessId), [businesses, businessId]);
  const canSubmit = Boolean(businessId && brief.trim().length > 0 && aiDraft && !busy);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const campaign = await createCampaign(businessId, {
        name: name.trim() || undefined,
        brief: brief.trim(),
        count,
        goal: goal || undefined,
        type,
        format,
      });
      router.push(`/campaigns/${campaign._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (businesses && businesses.length === 0) {
    return (
      <div>
        <p className="muted">
          <Link href="/">← Studio</Link>
        </p>
        <div className="card" style={{ marginTop: 12 }}>
          <p>No brand is ready for a campaign yet.</p>
          <p className="muted">A campaign needs a brand with a completed profile and an approved kit.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <p className="muted" style={{ marginBottom: 6 }}>
        <Link href={businessId ? `/businesses/${businessId}` : '/'}>← Back</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>New campaign</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Describe the series and we&rsquo;ll plan the posts. Nothing is drafted until you open a post — planning is cheap.
      </p>

      {error && <div className="error-box">{error}</div>}
      {!aiDraft && (
        <div className="warn-box" style={{ marginTop: 12 }}>
          AI draft isn&rsquo;t configured, so campaigns are unavailable. Set ANTHROPIC_API_KEY + ANTHROPIC_MODEL_SMALL.
        </div>
      )}

      <form onSubmit={submit} style={{ marginTop: 16, display: 'grid', gap: 14 }}>
        <div>
          <div className="section-label">Brand</div>
          <select value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
            {(businesses ?? []).map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="section-label">Campaign name (optional)</div>
          <input value={name} placeholder="e.g. Q3 education series" onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <div className="section-label">Brief</div>
          <textarea
            value={brief}
            rows={5}
            placeholder="What's the series about? Who's it for? What's the arc?"
            onChange={(e) => setBrief(e.target.value)}
          />
          <button
            type="button"
            className="btn sm ghost"
            style={{ marginTop: 6 }}
            onClick={() => setBrief(BRIEF_EXAMPLE)}
          >
            Use an example
          </button>
        </div>

        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="section-label">Posts</div>
            <input
              type="number"
              min={1}
              max={12}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              style={{ width: 80 }}
            />
          </div>
          <div>
            <div className="section-label">Goal</div>
            <select value={goal} onChange={(e) => setGoal(e.target.value as BusinessGoal | '')}>
              <option value="">— none —</option>
              {BUSINESS_GOALS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="section-label">Type</div>
            <div className="row" style={{ gap: 6 }}>
              {ASSET_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn sm ${type === t ? 'primary' : 'ghost'}`}
                  onClick={() => setType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="section-label">Format</div>
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row" style={{ marginTop: 4 }}>
          <button className="btn primary" type="submit" disabled={!canSubmit}>
            {busy ? 'Planning…' : `Plan ${count} posts`}
          </button>
          {selectedBiz && <span className="muted">for {selectedBiz.name}</span>}
        </div>
      </form>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewCampaignForm />
    </Suspense>
  );
}
