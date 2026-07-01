'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FORMAT_LABELS, type Campaign } from '@contentbuilder/shared';
import { getCampaign, draftConcept } from '../../lib/api';

export default function CampaignPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);

  useEffect(() => {
    getCampaign(id)
      .then(setCampaign)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const onDraft = async (conceptId: string) => {
    setDrafting(conceptId);
    setError(null);
    try {
      const project = await draftConcept(id, conceptId);
      router.push(`/projects/${project._id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDrafting(null);
    }
  };

  if (error && !campaign) {
    return (
      <div>
        <p className="muted">
          <Link href="/">← Businesses</Link>
        </p>
        <div className="error-box">{error}</div>
      </div>
    );
  }
  if (!campaign) return <p className="muted">Loading campaign…</p>;

  const drafted = campaign.concepts.filter((c) => c.projectId).length;

  return (
    <div style={{ maxWidth: 820 }}>
      <p className="muted" style={{ marginBottom: 6 }}>
        <Link href={`/businesses/${campaign.businessId}`}>← Back to business</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{campaign.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {campaign.type} · {FORMAT_LABELS[campaign.format]} · {campaign.concepts.length} posts · {drafted} drafted
      </p>
      {campaign.brief && (
        <p style={{ marginTop: 8, fontStyle: 'italic' }} className="muted">
          &ldquo;{campaign.brief}&rdquo;
        </p>
      )}

      {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
        {campaign.concepts.map((c, i) => (
          <div key={c.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <strong>
                  {i + 1}. {c.title}
                </strong>
                {c.angle && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{c.angle}</div>}
                <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                  {c.paragraph.length > 220 ? `${c.paragraph.slice(0, 220)}…` : c.paragraph}
                </p>
              </div>
              <div style={{ flexShrink: 0 }}>
                {c.projectId ? (
                  <Link className="btn sm" href={`/projects/${c.projectId}`}>
                    Open post →
                  </Link>
                ) : (
                  <button
                    className="btn sm primary"
                    onClick={() => void onDraft(c.id)}
                    disabled={drafting !== null}
                  >
                    {drafting === c.id ? 'Drafting…' : '✦ Draft this post'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
