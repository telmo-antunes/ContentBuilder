'use client';

/**
 * Send-to-phone hand-off page (no Meta API): opened on a phone via the LAN
 * link the editor shows after an export. Uses the Web Share API with the exported
 * PNGs as FILES — the native share sheet opens and Instagram is one tap away,
 * with the caption on the clipboard. Falls back to per-image downloads where
 * file-sharing isn't available.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Project } from '@contentbuilder/shared';
import { getProject, type ProjectDetail } from '../../lib/api';

/** Route stored absolute media URLs through the same-origin /api proxy so they
 *  load on a phone (the phone can't resolve the dev machine's "localhost"). */
function proxied(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return `/api${u.pathname}`;
    return url;
  } catch {
    return url;
  }
}

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    getProject(id)
      .then((p) => setProject(p))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    const n = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' });
    setCanShareFiles(Boolean(n.canShare?.({ files: [probe] })));
  }, []);

  const renders = useMemo(
    () => ((project as (Project & { renders?: string[] }) | null)?.renders ?? []).map(proxied),
    [project],
  );
  const captionText = useMemo(() => {
    const c = project?.caption;
    if (!c?.text && !c?.hashtags?.length) return '';
    return [c.text, (c.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n');
  }, [project]);

  const share = async () => {
    setStatus('Preparing images…');
    try {
      const files = await Promise.all(
        renders.map(async (url, i) => {
          const blob = await (await fetch(url)).blob();
          return new File([blob], `${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' });
        }),
      );
      if (captionText) await navigator.clipboard?.writeText(captionText).catch(() => {});
      setStatus(captionText ? 'Caption copied — pick Instagram in the share sheet' : null);
      await navigator.share({ files, title: project?.title ?? 'Post' });
      setStatus('Shared ✓ — paste the caption in Instagram');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setStatus(null);
        setError(e instanceof Error ? e.message : String(e));
      } else {
        setStatus(null);
      }
    }
  };

  const copyCaption = async () => {
    await navigator.clipboard?.writeText(captionText);
    setStatus('Caption copied ✓');
  };

  if (error && !project) return <div className="error-box" style={{ margin: 16 }}>{error}</div>;
  if (!project) return <p className="muted" style={{ margin: 16 }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '8px 16px 40px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 2 }}>{project.title}</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {renders.length} {renders.length === 1 ? 'image' : 'images'} · exported and ready to post
      </p>

      {renders.length === 0 ? (
        <div className="empty">
          No export yet — export the project from the editor first, then reopen this page.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
            {renders.map((url, i) => (
              <img
                key={url}
                src={url}
                alt={`Slide ${i + 1}`}
                style={{ height: 170, borderRadius: 10, border: '1px solid var(--border)' }}
              />
            ))}
          </div>

          {canShareFiles ? (
            <button className="btn primary" style={{ width: '100%', marginTop: 14, padding: '12px 0', fontSize: 16 }} onClick={() => void share()}>
              📲 Share… (pick Instagram)
            </button>
          ) : (
            <div style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontSize: 13 }}>
                This browser can&rsquo;t share files directly — open this page on your PHONE (copy the
                link from the editor&rsquo;s &ldquo;Post from your phone&rdquo; dialog), or save the images below.
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {renders.map((url, i) => (
                  <a key={url} className="btn sm" href={url} download={`${String(i + 1).padStart(2, '0')}.png`}>
                    ⬇ Slide {i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}

          {captionText && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>Caption</strong>
                <button className="btn sm" onClick={() => void copyCaption()}>Copy</button>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 0 }}>{captionText}</p>
            </div>
          )}

          {status && <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>{status}</p>}
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
