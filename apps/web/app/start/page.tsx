'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { BusinessCategory } from '@contentbuilder/shared';
import { BUSINESS_CATEGORIES } from '@contentbuilder/shared';
import { createBusiness } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';

/**
 * /START — opening a dossier.
 *
 * The old four-step wizard is gone: everything after creation lives ON the
 * brand's dossier (/businesses/[id]), which fills itself in as the site is
 * read and carries its own queued lines for the look and the first post. This
 * page only asks what a human must answer before a dossier can exist — name,
 * category, optionally a site — then opens it.
 *
 * Old resume links (?b=<id>) redirect straight to the dossier: "resume setup"
 * is no longer a place, it's the state of the document.
 */
function StartInner() {
  const router = useRouter();
  const params = useSearchParams();
  const resumeId = params.get('b');

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<BusinessCategory | ''>('');
  const [offer, setOffer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resumeId) router.replace(`/businesses/${resumeId}`);
  }, [resumeId, router]);

  if (resumeId) {
    return (
      <div className="mo-page mo-kit" role="status" aria-label="Opening the dossier">
        <Skeleton shape="block" w={320} h={34} style={{ marginBottom: 18 }} />
        <Skeleton shape="block" h={420} style={{ borderRadius: 22 }} />
      </div>
    );
  }

  const hint = BUSINESS_CATEGORIES.find((c) => c.value === category)?.hint;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !category) return;
    setBusy(true);
    try {
      const b = await createBusiness({
        name: name.trim(),
        websiteUrl: url.trim() || undefined,
        profile: { category, ...(offer.trim() ? { offer: offer.trim() } : {}) },
      });
      router.push(`/businesses/${b._id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="mo-page mo-kit mo-compose">
      <p className="mo-crumb">
        <Link href="/">Home</Link>
        {' / '}
        New brand
      </p>
      <h1>
        Let&rsquo;s open a <span className="g">dossier</span>.
      </h1>

      <form className="mo-tile mo-open" onSubmit={submit}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--mo-muted)' }}>
          Three answers, then the brand gets its own dossier — a living document that fills itself in
          as the AI reads the site, and that every post composes against.
        </p>
        <div className="fld">
          <label htmlFor="ob-name">Brand name</label>
          <input
            id="ob-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Apex Auto Detailing"
            autoFocus
            required
          />
        </div>
        <div className="fld">
          <label htmlFor="ob-cat">What kind of business is it? — the AI writes differently for each</label>
          <select
            id="ob-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value as BusinessCategory)}
            required
          >
            <option value="" disabled>
              Choose one…
            </option>
            {BUSINESS_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {hint && <p className="hint">{hint}</p>}
        </div>
        <div className="fld">
          <label htmlFor="ob-offer">What does it do, in a line? (optional)</label>
          <input
            id="ob-offer"
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="Paint correction and ceramic coating for enthusiasts"
          />
        </div>
        <div className="fld">
          <label htmlFor="ob-url">Website (optional — but it gets read)</label>
          <input
            id="ob-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
          <p className="hint">
            With a site, the dossier&rsquo;s identity lines fill themselves from its real styles. Without
            one, you enter the colours and type by hand on the dossier.
          </p>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 18 }}>
          <button className="mo-btn-compose" type="submit" disabled={busy || !name.trim() || !category}>
            {busy ? 'Opening…' : 'Open the dossier →'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function StartPage() {
  return (
    <Suspense
      fallback={
        <div className="mo-page mo-kit" role="status" aria-label="Loading">
          <Skeleton shape="block" w={320} h={34} style={{ marginBottom: 18 }} />
          <Skeleton shape="block" h={380} style={{ borderRadius: 22 }} />
        </div>
      }
    >
      <StartInner />
    </Suspense>
  );
}
