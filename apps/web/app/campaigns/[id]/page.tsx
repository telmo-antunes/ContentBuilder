'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FORMAT_LABELS, type Campaign, type MediaAsset, type Project } from '@contentbuilder/shared';
import {
  getCampaign,
  draftConcept,
  editConcept,
  moveConcept,
  regenerateConcept,
  listProjects,
  getBrandKit,
  listMedia,
} from '../../lib/api';
import { OverflowMenu } from '../../components/OverflowMenu';
import { ProjectThumb, type ProjectThumbData } from '../../components/ProjectThumb';
import { useStagedProgress, DRAFT_STAGES } from '../../components/useStagedProgress';
import { toRenderKit } from '../../../lib/render/projectRender';

export default function CampaignPage() {
  const params = useParams();
  const id = String(params.id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kitRaw, setKitRaw] = useState<Awaited<ReturnType<typeof getBrandKit>>['approved']>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const draftLabel = useStagedProgress(drafting !== null, DRAFT_STAGES);
  const renderKit = useMemo(() => (kitRaw ? toRenderKit(kitRaw) : null), [kitRaw]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p._id, p])), [projects]);

  useEffect(() => {
    getCampaign(id)
      .then(async (c) => {
        setCampaign(c);
        const [ps, k, m] = await Promise.all([
          listProjects(c.businessId).catch(() => []),
          getBrandKit(c.businessId).catch(() => ({ draft: null, approved: null })),
          listMedia(c.businessId).catch(() => []),
        ]);
        setProjects(ps);
        setKitRaw(k.approved);
        setMedia(m);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const refreshProjects = async (businessId: string) => {
    setProjects(await listProjects(businessId).catch(() => []));
  };

  const onDraft = async (conceptId: string) => {
    if (!campaign) return;
    setDrafting(conceptId);
    setError(null);
    try {
      await draftConcept(id, conceptId);
      // Stay on the overview (the row flips to a thumbnail + "Open post") so
      // drafting several posts in a row doesn't bounce you around the app.
      setCampaign(await getCampaign(id));
      await refreshProjects(campaign.businessId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(null);
    }
  };

  const onMove = async (conceptId: string, dir: -1 | 1) => {
    setError(null);
    try {
      setCampaign(await moveConcept(id, conceptId, dir));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRegenerate = async (conceptId: string) => {
    setRegenerating(conceptId);
    setError(null);
    try {
      setCampaign(await regenerateConcept(id, conceptId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(null);
    }
  };

  if (error && !campaign) {
    return (
      <div>
        <p className="muted">
          <Link href="/">← Studio</Link>
        </p>
        <div className="error-box">{error}</div>
      </div>
    );
  }
  if (!campaign) return <p className="muted">Loading campaign…</p>;

  const drafted = campaign.concepts.filter((c) => c.projectId).length;

  return (
    <div style={{ maxWidth: 860 }}>
      <p className="muted" style={{ marginBottom: 6 }}>
        <Link href={`/businesses/${campaign.businessId}`}>← Back to brand</Link>
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
        {campaign.concepts.map((c, i) => {
          const project = c.projectId ? projectById.get(String(c.projectId)) : undefined;
          const busy = drafting !== null || regenerating !== null;
          return (
            <div key={c.id} className="card">
              {editing === c.id ? (
                <ConceptEditor
                  concept={c}
                  onCancel={() => setEditing(null)}
                  onSaved={(updated) => {
                    setCampaign(updated);
                    setEditing(null);
                  }}
                  campaignId={id}
                  onError={setError}
                />
              ) : (
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
                  {project && (
                    <Link href={`/projects/${project._id}/review`} aria-label={`Open ${c.title}`}>
                      <ProjectThumb project={project as ProjectThumbData} kit={renderKit} media={media} width={84} />
                    </Link>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>
                      {i + 1}. {c.title}
                    </strong>
                    {c.angle && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{c.angle}</div>}
                    <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                      {c.paragraph.length > 220 ? `${c.paragraph.slice(0, 220)}…` : c.paragraph}
                    </p>
                  </div>
                  <div className="row" style={{ flexShrink: 0, flexWrap: 'nowrap', gap: 6 }}>
                    {c.projectId ? (
                      <Link className="btn sm" href={`/projects/${c.projectId}/review`}>
                        Open post →
                      </Link>
                    ) : (
                      <button
                        className="btn sm primary"
                        onClick={() => void onDraft(c.id)}
                        disabled={busy}
                        style={{ minWidth: drafting === c.id ? 220 : undefined }}
                      >
                        {drafting === c.id
                          ? draftLabel ?? 'Drafting…'
                          : regenerating === c.id
                            ? 'Rethinking the angle…'
                            : '✦ Draft this post'}
                      </button>
                    )}
                    <OverflowMenu
                      items={[
                        { label: 'Edit copy', onClick: () => setEditing(c.id), disabled: busy },
                        ...(c.projectId
                          ? []
                          : [{ label: 'Regenerate concept', onClick: () => void onRegenerate(c.id), disabled: busy }]),
                        { label: '↑ Move up', onClick: () => void onMove(c.id, -1), disabled: busy || i === 0 },
                        {
                          label: '↓ Move down',
                          onClick: () => void onMove(c.id, 1),
                          disabled: busy || i === campaign.concepts.length - 1,
                        },
                      ]}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline editor for a concept's copy — the paragraph IS the post's source text. */
function ConceptEditor({
  campaignId,
  concept,
  onSaved,
  onCancel,
  onError,
}: {
  campaignId: string;
  concept: Campaign['concepts'][number];
  onSaved: (c: Campaign) => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
  const [title, setTitle] = useState(concept.title);
  const [angle, setAngle] = useState(concept.angle ?? '');
  const [paragraph, setParagraph] = useState(concept.paragraph);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await editConcept(campaignId, concept.id, { title: title.trim(), angle: angle.trim(), paragraph: paragraph.trim() }));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="grid-2">
        <div className="field" style={{ margin: 0 }}>
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Angle</label>
          <input value={angle} onChange={(e) => setAngle(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
        <label>Post copy (this exact text gets laid out onto the slides)</label>
        <textarea value={paragraph} rows={5} onChange={(e) => setParagraph(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary sm" onClick={() => void save()} disabled={busy || !title.trim() || !paragraph.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn ghost sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
