'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { AssetType, Format } from '@contentbuilder/shared';
import {
  ALLOWED_FORMATS,
  ASSET_TYPES,
  FORMAT_LABELS,
  MAX_DRAFT_PARAGRAPH_CHARS,
  defaultFormatFor,
} from '@contentbuilder/shared';
import {
  listBusinesses,
  createProject,
  updateProject,
  getProject,
  composeProjectAI,
  getHealth,
  type BusinessSummary,
} from '../../lib/api';

function NewProjectForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Set when the Desk sent us here to pick up a parked Ideas card: we compose
  // THAT project rather than creating a second one alongside it.
  const ideaFrom = params.get('ideaFrom');
  const [loadingIdea, setLoadingIdea] = useState(Boolean(ideaFrom));

  const [businessId, setBusinessId] = useState(params.get('businessId') ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssetType>('carousel');
  const [format, setFormat] = useState<Format>('1080x1350');
  const [idea, setIdea] = useState('');
  const [slideCount, setSlideCount] = useState(5);
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
    listBusinesses()
      .then((all) => {
        const approved = all.filter((b) => b.hasApprovedKit);
        setBusinesses(approved);
        setBusinessId((cur) => cur || approved[0]?._id || '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    getHealth()
      .then((h) => setAiReady(Boolean(h.ai?.draft)))
      .catch(() => setAiReady(false));
  }, []);

  useEffect(() => {
    if (!ideaFrom) return;
    getProject(ideaFrom)
      .then((p) => {
        setBusinessId(String(p.businessId));
        setTitle(p.title);
        setType(p.type);
        setFormat(p.format);
        setIdea(p.idea ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingIdea(false));
  }, [ideaFrom]);

  const formats = ALLOWED_FORMATS[type];
  useEffect(() => {
    if (!formats.includes(format)) setFormat(defaultFormatFor(type));
  }, [type, formats, format]);

  const selectedBiz = businesses?.find((b) => b._id === businessId);
  const profileReady = Boolean(selectedBiz?.hasProfile);
  const canCompose = aiReady && profileReady;

  const ideaTooLong = idea.length > MAX_DRAFT_PARAGRAPH_CHARS;
  const canSubmit =
    Boolean(businessId && title.trim() && format) &&
    canCompose &&
    idea.trim().length > 0 &&
    !ideaTooLong &&
    !loadingIdea;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // Resuming a parked idea composes THAT card in place, rather than
      // leaving a duplicate behind in the Ideas column.
      let projectId: string;
      if (ideaFrom) {
        await updateProject(ideaFrom, { title: title.trim(), idea: idea.trim(), type, format });
        projectId = ideaFrom;
      } else {
        const created = await createProject({ businessId, title: title.trim(), type, format, idea: idea.trim() });
        projectId = created._id;
      }
      try {
        await composeProjectAI(projectId, idea.trim(), slideCount);
      } catch (err) {
        // Compose failed after the project was created — surface it inline; the
        // empty editor route no longer exists, so there's nowhere else to send them.
        setError(err instanceof Error ? err.message : 'Compose failed. Please try again.');
        setBusy(false);
        return;
      }
      router.push(`/projects/${projectId}/review`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (loadingIdea) return <p className="muted">Opening your idea…</p>;

  if (businesses && businesses.length === 0) {
    return (
      <div style={{ maxWidth: 640 }}>
        <p className="muted">
          <Link href="/">← Studio</Link>
        </p>
        <h1>New project</h1>
        <div className="empty">
          No brand has an approved kit yet. Add a brand and approve its kit first.
          <div style={{ marginTop: 12 }}>
            <Link className="btn" href="/">
              Go to your studio
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="create-wrap">
      <p className="muted" style={{ marginBottom: 10 }}>
        <Link href="/">← Studio</Link>
      </p>
      <header className="create-hero">
        <p className="eyebrow">
          {ideaFrom ? 'Parked idea' : 'New post'}
          {selectedBiz ? ` · ${selectedBiz.name}` : ''}
        </p>
        <h1>
          {ideaFrom ? (
            <>
              Ready to <span className="it">make</span> this one?
            </>
          ) : (
            <>
              What are we <span className="it">making</span> today?
            </>
          )}
        </h1>
        <p className="lede">
          {ideaFrom
            ? 'Your saved prompt, as you left it. Edit anything, then compose it into slides.'
            : 'Pick a brand, describe the idea, and the AI composes it into on-brand slides using the brand’s recipe.'}
        </p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={submit}>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="grid-2">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="np-biz">Brand</label>
              {/* A parked idea already belongs to a brand — offering a picker
                  that can't persist the change would be a lie. */}
              <select
                id="np-biz"
                value={businessId}
                disabled={Boolean(ideaFrom)}
                onChange={(e) => setBusinessId(e.target.value)}
              >
                {!businesses && <option>Loading…</option>}
                {businesses?.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="np-title">Project title</label>
              <input
                id="np-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="3 traits of resilient founders"
                required
              />
            </div>
          </div>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Type</label>
              <div className="row">
                {ASSET_TYPES.map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={`btn sm ${type === t ? 'primary' : ''}`}
                    onClick={() => setType(t)}
                  >
                    {t === 'carousel' ? 'Carousel' : 'Story'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="np-format">Format</label>
              <select id="np-format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                {formats.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          {aiReady && selectedBiz && !profileReady && (
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
              ✦ AI compose unlocks once you{' '}
              <Link href={`/businesses/${selectedBiz._id}`}>complete {selectedBiz.name}&apos;s profile</Link>.
            </p>
          )}

          <div className="row" style={{ marginBottom: 6, justifyContent: 'space-between' }}>
            <label htmlFor="np-idea" className="section-label" style={{ margin: 0 }}>
              What&apos;s the post about?
            </label>
            <div className="slide-step">
              <button
                type="button"
                className="slide-step-btn"
                aria-label="Fewer slides"
                disabled={slideCount <= 2}
                onClick={() => setSlideCount((n) => Math.max(2, n - 1))}
              >
                −
              </button>
              <span className="slide-step-val">
                {slideCount} <span className="u">slide{slideCount === 1 ? '' : 's'}</span>
              </span>
              <button
                type="button"
                className="slide-step-btn"
                aria-label="More slides"
                disabled={slideCount >= 12}
                onClick={() => setSlideCount((n) => Math.min(12, n + 1))}
              >
                +
              </button>
            </div>
          </div>
          <textarea
            id="np-idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. Three small habits that quietly build discipline over a year — why motivation is unreliable, discipline as a system, and showing up on the bad days."
            style={{ minHeight: 140 }}
          />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <span className="muted" style={{ fontSize: 12, maxWidth: 560 }}>
              Describe the idea in your own words — the AI writes it in your brand voice and lays it
              out in your brand&apos;s design system.
            </span>
            <span
              className="muted"
              style={{ fontSize: 12, color: ideaTooLong ? 'var(--danger)' : undefined }}
            >
              {idea.length}/{MAX_DRAFT_PARAGRAPH_CHARS}
            </span>
          </div>
        </div>

        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={busy || !businessId || !title.trim()}
            title="Save the prompt and compose it later from the desk"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                if (ideaFrom) {
                  await updateProject(ideaFrom, { title: title.trim(), idea: idea.trim(), type, format });
                } else {
                  await createProject({
                    businessId,
                    title: title.trim(),
                    type,
                    format,
                    idea: idea.trim(),
                    stage: 'idea',
                  });
                }
                router.push('/');
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);
              }
            }}
          >
            {ideaFrom ? 'Keep as idea' : 'Save as idea'}
          </button>
          <button className="btn primary" type="submit" disabled={!canSubmit || busy}>
            {busy ? 'Composing…' : 'Compose with AI ✦'}
          </button>
          {!aiReady && (
            <span className="muted" style={{ fontSize: 13 }}>
              Set an Anthropic key + model to enable “Compose with AI”.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewProjectForm />
    </Suspense>
  );
}
