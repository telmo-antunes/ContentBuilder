'use client';

import { useState } from 'react';
import {
  BUSINESS_CATEGORIES,
  BUSINESS_GOALS,
  BUSINESS_TONES,
  categoryLabel,
  type BusinessCategory,
  type BusinessGoal,
  type BusinessProfile,
} from '@contentbuilder/shared';
import { updateBusiness } from '../lib/api';

export default function ProfileCard({
  businessId,
  profile,
  onSaved,
}: {
  businessId: string;
  profile?: BusinessProfile;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(!profile);
  const [category, setCategory] = useState<BusinessCategory | ''>(profile?.category ?? '');
  const [offer, setOffer] = useState(profile?.offer ?? '');
  const [audience, setAudience] = useState(profile?.audience ?? '');
  const [tone, setTone] = useState<string[]>(profile?.tone ?? []);
  const [goal, setGoal] = useState<BusinessGoal | ''>(profile?.goal ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTone = (t: string) =>
    setTone((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].slice(0, 6)));

  const save = async () => {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await updateBusiness(businessId, {
        profile: {
          category,
          offer: offer.trim() || undefined,
          audience: audience.trim() || undefined,
          tone: tone.length ? tone : undefined,
          goal: goal || undefined,
        },
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Summary (profile present, not editing) ────────────────────────────────
  if (profile && !editing) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="section-label" style={{ marginTop: 0 }}>
              Profile
            </div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{categoryLabel(profile.category)}</div>
            {profile.offer && <div className="muted" style={{ marginTop: 2 }}>{profile.offer}</div>}
          </div>
          <button className="btn sm" onClick={() => setEditing(true)}>
            Edit profile
          </button>
        </div>
        <div className="badges" style={{ marginTop: 10 }}>
          {profile.audience && <span className="badge">for {profile.audience}</span>}
          {profile.goal && <span className="badge accent">{BUSINESS_GOALS.find((g) => g.value === profile.goal)?.label}</span>}
          {(profile.tone ?? []).map((t) => (
            <span className="badge" key={t}>
              {t}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ── Editing / first-time form ─────────────────────────────────────────────
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-label" style={{ marginTop: 0 }}>
        {profile ? 'Edit profile' : 'Tell us about this brand'}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        This tailors your starter templates and unlocks the AI features (brand extraction &amp;
        draft-from-paragraph). No AI is used to fill it.
      </p>
      {error && <div className="error-box">{error}</div>}

      <div className="field">
        <label htmlFor="pf-cat">Category *</label>
        <select id="pf-cat" value={category} onChange={(e) => setCategory(e.target.value as BusinessCategory)}>
          <option value="">Choose a category…</option>
          {BUSINESS_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} — {c.hint}
            </option>
          ))}
        </select>
      </div>

      <div className="grid-2">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="pf-offer">What you offer (one line)</label>
          <input
            id="pf-offer"
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="e.g. 1:1 mindset coaching for founders"
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="pf-aud">Audience</label>
          <input
            id="pf-aud"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. early-stage founders"
          />
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Tone (pick up to 6)</label>
        <div className="row" style={{ gap: 6 }}>
          {BUSINESS_TONES.map((t) => (
            <button
              type="button"
              key={t}
              className={`btn sm ${tone.includes(t) ? 'primary' : 'ghost'}`}
              onClick={() => toggleTone(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="pf-goal">Primary goal</label>
        <select id="pf-goal" value={goal} onChange={(e) => setGoal(e.target.value as BusinessGoal)}>
          <option value="">No preference</option>
          {BUSINESS_GOALS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn primary" onClick={save} disabled={busy || !category}>
          {busy ? 'Saving…' : profile ? 'Save profile' : 'Save & continue'}
        </button>
        {profile && (
          <button className="btn ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
