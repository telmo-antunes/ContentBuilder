'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { AssetType, Format } from '@contentbuilder/shared';
import {
  ALLOWED_FORMATS,
  ASSET_TYPES,
  FORMAT_LABELS,
  MAX_DRAFT_PARAGRAPH_CHARS,
  MAX_PLAN_SLIDES,
  MAX_SLIDE_DIRECTION_CHARS,
  defaultFormatFor,
  parseBrief,
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
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { Skeleton } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

/** A cited link, shortened to the thing a person recognises. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The composer's shape while it loads: centered hero, two form cards. */
function ComposerSkeleton() {
  return (
    <div className="create-wrap" role="status" aria-label="Loading">
      <div className="create-hero" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Skeleton shape="line" w={90} h={10} />
        <Skeleton shape="block" w={340} h={44} />
        <Skeleton shape="line" w={280} h={12} />
      </div>
      <Skeleton shape="block" h={150} style={{ marginBottom: 14 }} />
      <Skeleton shape="block" h={240} />
    </div>
  );
}

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
  /**
   * The slide plan. Empty means "you decide" — how many slides the deck needs
   * is derived from the brief, which is what replaced the manual slide-count
   * stepper. Adding rows pins it: one slide per row, in this order.
   */
  const [plan, setPlan] = useState<string[]>([]);
  const [aiReady, setAiReady] = useState(false);

  const load = useCallback(() => {
    setError(null);
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
    if (ideaFrom) {
      setLoadingIdea(true);
      getProject(ideaFrom)
        .then((p) => {
          setBusinessId(String(p.businessId));
          setTitle(p.title);
          setType(p.type);
          setFormat(p.format);
          setIdea(p.idea ?? '');
          setPlan(p.plan ?? []);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoadingIdea(false));
    }
  }, [ideaFrom]);

  useEffect(() => {
    load();
  }, [load]);

  const formats = ALLOWED_FORMATS[type];
  useEffect(() => {
    if (!formats.includes(format)) setFormat(defaultFormatFor(type));
  }, [type, formats, format]);

  const selectedBiz = businesses?.find((b) => b._id === businessId);
  const profileReady = Boolean(selectedBiz?.hasProfile);
  const canCompose = aiReady && profileReady;

  // Memoised on the rows themselves, so the derived brief below is stable
  // across renders that only touched the textarea the plan doesn't feed.
  const filledPlan = useMemo(() => plan.map((p) => p.trim()).filter(Boolean), [plan]);
  /**
   * What the machine will make of this brief — computed from the SAME parser the
   * API runs, so the summary under the box is a promise, not a guess. Shows the
   * page it will read and the words it will keep before a compose is spent.
   */
  const brief = useMemo(() => parseBrief(idea, filledPlan), [idea, filledPlan]);

  const ideaTooLong = idea.length > MAX_DRAFT_PARAGRAPH_CHARS;
  const canSubmit =
    Boolean(businessId && title.trim() && format) &&
    canCompose &&
    (idea.trim().length > 0 || filledPlan.length > 0) &&
    !ideaTooLong &&
    !loadingIdea;

  const setPlanAt = (i: number, value: string) =>
    setPlan((rows) => rows.map((r, j) => (j === i ? value.slice(0, MAX_SLIDE_DIRECTION_CHARS) : r)));
  const addPlanRow = () => setPlan((rows) => (rows.length >= MAX_PLAN_SLIDES ? rows : [...rows, '']));
  const removePlanRow = (i: number) => setPlan((rows) => rows.filter((_, j) => j !== i));
  const movePlanRow = (i: number, by: -1 | 1) =>
    setPlan((rows) => {
      const to = i + by;
      if (to < 0 || to >= rows.length) return rows;
      const next = [...rows];
      [next[i], next[to]] = [next[to]!, next[i]!];
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Resuming a parked idea composes THAT card in place, rather than
      // leaving a duplicate behind in the Ideas column.
      let projectId: string;
      if (ideaFrom) {
        await updateProject(ideaFrom, { title: title.trim(), idea: idea.trim(), plan: filledPlan, type, format });
        projectId = ideaFrom;
      } else {
        const created = await createProject({
          businessId,
          title: title.trim(),
          type,
          format,
          idea: idea.trim(),
          plan: filledPlan,
        });
        projectId = created._id;
      }
      try {
        const composed = await composeProjectAI(projectId, idea.trim(), filledPlan);
        // Say what actually happened to the brief — which page was read, which
        // link was skipped and why. A silently-ignored source is the difference
        // between "the AI wrote something generic" and "your link 404s".
        const report = composed.brief;
        if (report?.failures.length) {
          toast(`Could not read ${report.failures[0]!.url} — ${report.failures[0]!.reason}`, 'error');
        } else if (report?.sources.length) {
          toast(`Read “${report.sources[0]!.title}” and wrote the deck from it.`);
        }
      } catch (err) {
        // Compose failed after the project was created — the card is parked in
        // Ideas, so the toast plus the untouched form is a safe place to retry.
        toast(err instanceof Error ? err.message : 'Compose failed. Please try again.', 'error');
        setBusy(false);
        return;
      }
      router.push(`/projects/${projectId}/review`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      setBusy(false);
    }
  };

  if (loadingIdea) return <ComposerSkeleton />;

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

      {error && <ErrorState message={error} onRetry={load} />}

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
              <Icon name="sparkle" size={12} /> AI compose unlocks once you{' '}
              <Link href={`/businesses/${selectedBiz._id}`}>complete {selectedBiz.name}&apos;s profile</Link>.
            </p>
          )}

          <div className="row" style={{ marginBottom: 6, justifyContent: 'space-between' }}>
            <label htmlFor="np-idea" className="section-label" style={{ margin: 0 }}>
              What&apos;s the post about?
            </label>
            <span className="muted" style={{ fontSize: 12 }}>
              {filledPlan.length
                ? `${filledPlan.length} slide${filledPlan.length === 1 ? '' : 's'} — your plan`
                : 'Slide count: automatic'}
            </span>
          </div>
          <textarea
            id="np-idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={
              'e.g. Create a carousel based on this blog post https://…\n' +
              'or: Three small habits that quietly build discipline over a year.\n' +
              'Paste a link and it gets read. Put "an exact line" in quotes to use it word for word.'
            }
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

          {/* What the machine understood, before a compose is spent on it. */}
          {(brief.urls.length > 0 || brief.locks.length > 0) && (
            <div className="brief-read">
              {brief.urls.map((u) => (
                <span className="brief-chip" key={u} title={u}>
                  <Icon name="link" size={11} /> will read {hostOf(u)}
                </span>
              ))}
              {brief.locks.map((l) => (
                <span className="brief-chip lock" key={l} title={l}>
                  <Icon name="quote" size={11} /> word for word: “{l.length > 42 ? `${l.slice(0, 42)}…` : l}”
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── The slide plan ─────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <label className="section-label" style={{ margin: 0 }}>
              Plan the slides <span className="muted" style={{ fontWeight: 400 }}>— optional</span>
            </label>
            <button
              type="button"
              className="btn sm"
              onClick={addPlanRow}
              disabled={plan.length >= MAX_PLAN_SLIDES}
            >
              <Icon name="plus" size={12} /> Add slide
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: plan.length ? 12 : 0 }}>
            Leave this empty and the deck is shaped for you — as many slides as the material earns.
            Add rows to say what each slide is about, in order. Anything you put in{' '}
            <b>&ldquo;double quotes&rdquo;</b> is used word for word, exactly as you typed it.
          </p>

          {plan.map((row, i) => (
            <div className="plan-row" key={i}>
              <span className="plan-num">{i + 1}</span>
              <textarea
                value={row}
                onChange={(e) => setPlanAt(i, e.target.value)}
                placeholder={
                  i === 0
                    ? 'The hook. e.g. Open on the promise: "How often should you actually reapply?"'
                    : 'What this slide says. e.g. The signs of wear, as a list of three.'
                }
                rows={2}
              />
              <div className="plan-tools">
                <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => movePlanRow(i, -1)}>
                  <Icon name="arrow-up" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move down"
                  disabled={i === plan.length - 1}
                  onClick={() => movePlanRow(i, 1)}
                >
                  <Icon name="arrow-down" size={13} />
                </button>
                <button type="button" className="icon-btn" aria-label="Remove slide" onClick={() => removePlanRow(i)}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={busy || !businessId || !title.trim()}
            title="Save the prompt and compose it later from the desk"
            onClick={async () => {
              setBusy(true);
              try {
                if (ideaFrom) {
                  await updateProject(ideaFrom, {
                    title: title.trim(),
                    idea: idea.trim(),
                    plan: filledPlan,
                    type,
                    format,
                  });
                } else {
                  await createProject({
                    businessId,
                    title: title.trim(),
                    type,
                    format,
                    idea: idea.trim(),
                    plan: filledPlan,
                    stage: 'idea',
                  });
                }
                router.push('/');
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), 'error');
                setBusy(false);
              }
            }}
          >
            {ideaFrom ? 'Keep as idea' : 'Save as idea'}
          </button>
          <button className="btn primary" type="submit" disabled={!canSubmit || busy}>
            {busy ? (
              'Composing…'
            ) : (
              <>
                <Icon name="sparkle" /> Compose with AI
              </>
            )}
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
    <Suspense fallback={<ComposerSkeleton />}>
      <NewProjectForm />
    </Suspense>
  );
}
