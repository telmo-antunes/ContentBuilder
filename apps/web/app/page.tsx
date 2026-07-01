'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listBusinesses,
  createBusiness,
  updateBusiness,
  deleteBusiness,
  type BusinessSummary,
} from './lib/api';
import { confirm } from './components/ConfirmDialog';

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setBusinesses(await listBusinesses());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div>
      <h1>Businesses</h1>
      <p className="muted">
        Each business gets a brand kit derived from its website (or entered manually), then drives
        on-brand carousels &amp; stories. Add a business to begin.
      </p>

      {error && <div className="error-box">{error}</div>}

      <AddBusiness onCreated={reload} onError={setError} />

      <h2>All businesses {businesses ? `(${businesses.length})` : ''}</h2>
      {!businesses && !error && <p className="muted">Loading…</p>}
      {businesses && businesses.length === 0 && (
        <div className="empty">
          <strong>Welcome 👋</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Add your first business above. Then derive a brand kit from its website (or enter one
            manually), and start building on-brand carousels &amp; stories.
          </p>
        </div>
      )}
      {businesses && businesses.length > 0 && (
        <div className="list">
          {businesses.map((b) => (
            <BusinessRow key={b._id} biz={b} onChanged={reload} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

function AddBusiness({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createBusiness({ name: name.trim(), websiteUrl: websiteUrl.trim() || undefined });
      setName('');
      setWebsiteUrl('');
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 8 }}>
      <div className="grid-2">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="biz-name">Business name *</label>
          <input
            id="biz-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Apex Auto Detailing"
            required
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="biz-url">Website URL (optional)</label>
          <input
            id="biz-url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={busy || !name.trim()} type="submit">
          {busy ? 'Adding…' : 'Add business'}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          No website? Add it anyway and enter a brand kit manually later.
        </span>
      </div>
    </form>
  );
}

function BusinessRow({
  biz,
  onChanged,
  onError,
}: {
  biz: BusinessSummary;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(biz.name);
  const [websiteUrl, setWebsiteUrl] = useState(biz.websiteUrl ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await updateBusiness(biz._id, { name: name.trim(), websiteUrl: websiteUrl.trim() });
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({
      title: 'Delete business?',
      message: `Delete "${biz.name}"? This also deletes its brand kits and projects.`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    setBusy(true);
    try {
      await deleteBusiness(biz._id);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="item" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
        <div className="grid-2">
          <div className="field" style={{ margin: 0 }}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Website URL</label>
            <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary sm" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const created = new Date(biz.createdAt).toLocaleDateString();

  return (
    <div className="item">
      <div className="grow">
        <div className="title">
          <Link href={`/businesses/${biz._id}`}>{biz.name}</Link>
        </div>
        <div className="sub">
          {biz.websiteUrl ? (
            <a href={biz.websiteUrl} target="_blank" rel="noreferrer">
              {biz.websiteUrl}
            </a>
          ) : (
            'No website'
          )}{' '}
          · added {created}
        </div>
        <div className="badges">
          {biz.hasApprovedKit ? (
            <span className="badge ok">
              <span className="dot" /> Approved kit
            </span>
          ) : biz.hasDraftKit ? (
            <span className="badge warn">
              <span className="dot" /> Draft kit — needs approval
            </span>
          ) : (
            <span className="badge">
              <span className="dot" /> No brand kit
            </span>
          )}
          <span className="badge accent">{biz.projectCount} project{biz.projectCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <Link className="btn sm" href={`/businesses/${biz._id}/brand-kit`}>
          Brand kit
        </Link>
        <button className="btn sm" onClick={() => setEditing(true)} disabled={busy}>
          Edit
        </button>
        <button className="btn danger sm" onClick={remove} disabled={busy}>
          {busy ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
