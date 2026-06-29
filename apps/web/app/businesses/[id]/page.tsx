'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FORMAT_LABELS } from '@contentbuilder/shared';
import { getBusiness, deleteProject, createProject, type BusinessDetail } from '../../lib/api';
import ProfileCard from '../../components/ProfileCard';

export default function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [biz, setBiz] = useState<BusinessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setBiz(await getBusiness(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const removeProject = async (pid: string, title: string) => {
    if (!window.confirm(`Delete project "${title}"?`)) return;
    try {
      await deleteProject(pid);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const duplicateProject = async (p: BusinessDetail['projects'][number]) => {
    try {
      await createProject({
        businessId: id,
        title: `${p.title} copy`,
        type: p.type,
        format: p.format,
        slides: p.slides,
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <p className="muted">
        <Link href="/">← Businesses</Link>
      </p>
      {error && <div className="error-box">{error}</div>}
      {!biz && !error && <p className="muted">Loading…</p>}

      {biz && (
        <>
          <h1>{biz.name}</h1>
          <div className="row" style={{ marginBottom: 8 }}>
            {biz.hasApprovedKit ? (
              <span className="badge ok">
                <span className="dot" /> Approved brand kit
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
            {biz.websiteUrl && (
              <a href={biz.websiteUrl} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 13 }}>
                {biz.websiteUrl}
              </a>
            )}
            <Link className="btn sm" href={`/businesses/${biz._id}/brand-kit`} style={{ marginLeft: 'auto' }}>
              {biz.hasApprovedKit || biz.hasDraftKit ? 'Brand kit' : 'Create brand kit'}
            </Link>
          </div>

          <ProfileCard businessId={biz._id} profile={biz.profile} onSaved={reload} />

          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Projects ({biz.projects.length})</h2>
            {biz.hasApprovedKit ? (
              <Link className="btn primary sm" href={`/projects/new?businessId=${biz._id}`}>
                + New project
              </Link>
            ) : (
              <button className="btn sm" disabled title="Approve a brand kit first">
                + New project
              </button>
            )}
          </div>

          {biz.projects.length === 0 ? (
            <div className="empty" style={{ marginTop: 12 }}>
              No projects yet.
              {biz.hasApprovedKit
                ? ' Create one to start building slides.'
                : ' Approve a brand kit first (brand extraction arrives in a later milestone).'}
            </div>
          ) : (
            <div className="list" style={{ marginTop: 12 }}>
              {biz.projects.map((p) => (
                <div className="item" key={p._id}>
                  <div className="grow">
                    <div className="title">
                      <Link href={`/projects/${p._id}`}>{p.title}</Link>
                    </div>
                    <div className="badges">
                      <span className="badge accent">{p.type}</span>
                      <span className="badge">{FORMAT_LABELS[p.format]}</span>
                      <span className="badge">{p.slides.length} slide{p.slides.length === 1 ? '' : 's'}</span>
                      <span className={`badge ${p.status === 'rendered' ? 'ok' : ''}`}>{p.status}</span>
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Link className="btn sm" href={`/projects/${p._id}`}>
                      Open editor
                    </Link>
                    <button className="btn sm" onClick={() => duplicateProject(p)} title="Duplicate this project">
                      Duplicate
                    </button>
                    <button className="btn danger sm" onClick={() => removeProject(p._id, p.title)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
