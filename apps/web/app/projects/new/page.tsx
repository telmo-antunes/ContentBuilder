'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { AssetType, Format, Slide } from '@contentbuilder/shared';
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
  composeProjectAI,
  getHealth,
  listProjects,
  getProject,
  type BusinessSummary,
  type ProjectDetail,
} from '../../lib/api';
import { SlideRenderer } from '../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../lib/render/SlideFrame';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from '../../../lib/render/projectRender';

/** Render one real slide at a small size — a live sample of the brand's own layouts. */
function SlideThumb({ detail, slide, width }: { detail: ProjectDetail; slide: Slide; width: number }) {
  return (
    <ScaledSlide format={detail.format as Format} displayWidth={width}>
      <SlideRenderer
        slide={slide}
        brandKit={toRenderKit(detail.brandKit)}
        format={detail.format as Format}
        image={resolveSlideImage(slide, detail.media)}
        imageLayout={resolveImageLayout(slide, detail.media)}
        theme={slide.overrides?.theme ?? detail.settings?.theme ?? 'editorial'}
        forExport
      />
    </ScaledSlide>
  );
}

// Two ways to start, by design: let the AI compose it, or start from a blank
// canvas. Everything else goes through AI — no guided scaffolds, no shorthand.
type Mode = 'compose' | 'empty';

function NewProjectForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [businessId, setBusinessId] = useState(params.get('businessId') ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssetType>('carousel');
  const [format, setFormat] = useState<Format>('1080x1350');
  const [mode, setMode] = useState<Mode>('empty');
  const [idea, setIdea] = useState('');
  const [slideCount, setSlideCount] = useState(5);
  const [aiReady, setAiReady] = useState(false);
  // The selected brand's most recent post — shown as a live sample of its own
  // layouts when starting empty (undefined = loading, null = none yet).
  const [seed, setSeed] = useState<ProjectDetail | null | undefined>(undefined);

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

  const formats = ALLOWED_FORMATS[type];
  useEffect(() => {
    if (!formats.includes(format)) setFormat(defaultFormatFor(type));
  }, [type, formats, format]);

  // Front the empty-start option with the brand's own most recent layouts.
  useEffect(() => {
    if (!businessId) {
      setSeed(null);
      return;
    }
    let alive = true;
    setSeed(undefined);
    (async () => {
      try {
        const projs = await listProjects(businessId);
        const newest = [...projs].sort(
          (x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
        )[0];
        const detail = newest ? await getProject(newest._id) : null;
        if (alive) setSeed(detail && detail.slides.length ? detail : null);
      } catch {
        if (alive) setSeed(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [businessId]);

  const selectedBiz = businesses?.find((b) => b._id === businessId);
  const profileReady = Boolean(selectedBiz?.hasProfile);
  const canCompose = aiReady && profileReady;

  // Lead with Compose whenever the brand can be composed for.
  useEffect(() => {
    setMode((m) => (canCompose ? (m === 'empty' ? 'compose' : m) : 'empty'));
  }, [canCompose]);

  const ideaTooLong = idea.length > MAX_DRAFT_PARAGRAPH_CHARS;
  const canSubmit =
    Boolean(businessId && title.trim() && format) &&
    (mode === 'empty' || (mode === 'compose' && idea.trim().length > 0 && !ideaTooLong));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({ businessId, title: title.trim(), type, format });

      if (mode === 'compose') {
        try {
          await composeProjectAI(project._id, idea.trim(), slideCount);
        } catch (err) {
          setError(
            `${err instanceof Error ? err.message : 'Compose failed'} Opening the empty project so you can build manually.`,
          );
          router.push(`/projects/${project._id}`);
          return;
        }
        router.push(`/projects/${project._id}/review`);
        return;
      }
      router.push(`/projects/${project._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (businesses && businesses.length === 0) {
    return (
      <div style={{ maxWidth: 640 }}>
        <p className="muted">
          <Link href="/">← Businesses</Link>
        </p>
        <h1>New project</h1>
        <div className="empty">
          No business has an approved brand kit yet. Add a business and approve its kit first.
          <div style={{ marginTop: 12 }}>
            <Link className="btn" href="/">
              Go to Businesses
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="create-wrap">
      <p className="muted" style={{ marginBottom: 10 }}>
        <Link href="/">← Businesses</Link>
      </p>
      <header className="create-hero">
        <p className="eyebrow">New post{selectedBiz ? ` · ${selectedBiz.name}` : ''}</p>
        <h1>
          What are we <span className="it">making</span> today?
        </h1>
        <p className="lede">
          Pick a brand, describe the idea, and the AI composes it into on-brand slides using the
          brand&apos;s recipe — or start from a blank canvas.
        </p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={submit}>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="grid-2">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="np-biz">Business</label>
              <select id="np-biz" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
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
          <div className="row" style={{ marginBottom: mode === 'compose' ? 14 : 0 }}>
            <span className="section-label" style={{ margin: 0 }}>
              Start method
            </span>
            {canCompose && (
              <button
                type="button"
                className={`btn sm ${mode === 'compose' ? 'primary' : ''}`}
                onClick={() => setMode('compose')}
              >
                Compose with AI ✦
              </button>
            )}
            <button
              type="button"
              className={`btn sm ${mode === 'empty' ? 'primary' : ''}`}
              onClick={() => setMode('empty')}
            >
              Start empty
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {mode === 'compose'
                ? 'The AI writes on-brand copy and composes it into your brand’s design system.'
                : 'A blank project — build it slide by slide in the editor.'}
            </span>
          </div>

          {aiReady && selectedBiz && !profileReady && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              ✦ AI compose unlocks once you{' '}
              <Link href={`/businesses/${selectedBiz._id}`}>complete {selectedBiz.name}&apos;s profile</Link>.
            </p>
          )}

          {mode === 'compose' && (
            <div style={{ marginTop: 4 }}>
              <div className="row" style={{ marginBottom: 6, justifyContent: 'space-between' }}>
                <label htmlFor="np-idea" className="section-label" style={{ margin: 0 }}>
                  What&apos;s the post about?
                </label>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>Slides</span>
                  {[3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`btn sm ${slideCount === n ? 'primary' : ''}`}
                      onClick={() => setSlideCount(n)}
                    >
                      {n}
                    </button>
                  ))}
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
          )}

          {mode === 'empty' && seed && (
            <div className="seed-row" style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  You&apos;ll start from {selectedBiz?.name ?? 'your brand'}&apos;s own layouts —
                  most recently
                </span>
                <Link
                  href={`/projects/${seed._id}/review`}
                  className="muted"
                  style={{ fontSize: 12 }}
                >
                  {seed.title} →
                </Link>
              </div>
              <div className="seed-strip">
                {[...seed.slides]
                  .sort((a, b) => a.order - b.order)
                  .slice(0, 4)
                  .map((s) => (
                    <div className="seed-frame" key={s.id}>
                      <SlideThumb detail={seed} slide={s} width={seed.format === '1080x1920' ? 66 : 108} />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        <div className="row">
          <button className="btn primary" type="submit" disabled={!canSubmit || busy}>
            {busy
              ? mode === 'compose'
                ? 'Composing…'
                : 'Creating…'
              : mode === 'compose'
                ? 'Compose with AI ✦'
                : 'Create empty project'}
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
