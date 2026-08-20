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
  slideCountFor,
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

/** The composer's shape while it loads: title, then the three beats. */
function ComposerSkeleton() {
  return (
    <div className="mo-page mo-compose" role="status" aria-label="Loading">
      <Skeleton shape="line" w={120} h={12} style={{ marginBottom: 14 }} />
      <Skeleton shape="block" w={380} h={34} style={{ marginBottom: 22 }} />
      <Skeleton shape="block" h={72} style={{ borderRadius: 20, marginBottom: 22 }} />
      <Skeleton shape="block" h={280} style={{ borderRadius: 20, marginBottom: 22 }} />
      <Skeleton shape="block" h={160} style={{ borderRadius: 20 }} />
    </div>
  );
}

/**
 * THE COMPOSER — the batch-4 hybrid: Three Beats' wizard rhythm as the spine
 * (who's it for → what should it say → compose), The Brief's writing desk as
 * the middle beat with the parser's findings as live margin notes, and The
 * Forecast as the final beat — the deck the AI intends, shown right where you
 * decide to spend the compose.
 */
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

  const preselected = params.get('businessId');
  const [businessId, setBusinessId] = useState(preselected ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssetType>('carousel');
  const [format, setFormat] = useState<Format>('1080x1350');
  const [idea, setIdea] = useState('');
  /**
   * The slide plan. Empty means "you decide" — how many slides the deck needs
   * is derived from the brief. Adding rows pins it: one slide per row, in order.
   */
  const [plan, setPlan] = useState<string[]>([]);
  const [aiReady, setAiReady] = useState(false);
  /**
   * Beat 1 collapses to a receipt once answered. Arriving with a brand in hand
   * (the Desk's "For Dynatós" buttons, or a parked idea) starts it collapsed —
   * the question was answered before the page opened.
   */
  const [whoOpen, setWhoOpen] = useState(() => !preselected && !ideaFrom);
  const [planOpen, setPlanOpen] = useState(false);

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
   * What the machine will make of this brief — computed from the SAME parser
   * the API runs, so every margin note and forecast card is a promise, not a
   * guess.
   */
  const brief = useMemo(() => parseBrief(idea, filledPlan), [idea, filledPlan]);
  /** How many slides the material is worth — the ghost storyboard's honest count. */
  const count = useMemo(
    () =>
      slideCountFor({
        planLength: brief.plan.length || undefined,
        ideaChars: brief.idea.length || undefined,
      }),
    [brief],
  );

  const ideaTooLong = idea.length > MAX_DRAFT_PARAGRAPH_CHARS;
  const briefReady = idea.trim().length > 0 || filledPlan.length > 0;
  const canSubmit =
    Boolean(businessId && title.trim() && format) && canCompose && briefReady && !ideaTooLong && !loadingIdea;
  const whoDone = Boolean(businessId && title.trim());

  const setPlanAt = (i: number, value: string) =>
    setPlan((rows) => rows.map((r, j) => (j === i ? value.slice(0, MAX_SLIDE_DIRECTION_CHARS) : r)));
  const addPlanRow = () => {
    setPlanOpen(true);
    setPlan((rows) => (rows.length >= MAX_PLAN_SLIDES ? rows : [...rows, '']));
  };
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

  const park = async () => {
    setBusy(true);
    try {
      if (ideaFrom) {
        await updateProject(ideaFrom, { title: title.trim(), idea: idea.trim(), plan: filledPlan, type, format });
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
  };

  if (loadingIdea) return <ComposerSkeleton />;

  if (businesses && businesses.length === 0) {
    return (
      <div className="mo-page mo-compose">
        <p className="mo-crumb">
          <Link href="/">Home</Link> / New post
        </p>
        <h1>What are we making today?</h1>
        <div className="mo-tile" style={{ maxWidth: 520 }}>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--mo-muted)' }}>
            No brand has an approved kit yet — composing needs a recipe to compose against. Set up a
            brand and approve its kit first.
          </p>
          <Link className="mo-go" href="/start" style={{ display: 'inline-block' }}>
            ＋ Set up a brand
          </Link>
        </div>
      </div>
    );
  }

  /** The forecast's ghost slides: the plan's beats, or the derived count. */
  const ghosts: Array<{ gist: string; locked: boolean }> = brief.plan.length
    ? brief.plan.map((beat) => ({
        gist: beat,
        locked: brief.locks.some((l) => beat.includes(l)),
      }))
    : Array.from({ length: count.target }, () => ({ gist: '', locked: false }));

  return (
    <div className="mo-page mo-compose">
      <p className="mo-crumb">
        <Link href="/">Home</Link> / {ideaFrom ? 'Parked idea' : 'New post'}
      </p>
      <h1>
        {ideaFrom ? (
          <>
            Ready to <span className="g">make this one</span>?
          </>
        ) : (
          <>
            What are we <span className="g">making today</span>?
          </>
        )}
      </h1>

      {error && <ErrorState message={error} onRetry={load} />}

      <form onSubmit={submit}>
        {/* ── Beat 1: who's it for ── */}
        <div className={`mo-beat${whoDone && !whoOpen ? ' done' : ' on'}`}>
          <div className="snum">{whoDone && !whoOpen ? '✓' : '1'}</div>
          <span className="rail-ln" aria-hidden />
          <div className="bcard">
            <div className="bh">
              <span className="t">Who&rsquo;s it for</span>
              {!whoOpen && selectedBiz && (
                <span className="sum">
                  <span
                    className="k"
                    style={{
                      background: `linear-gradient(135deg, ${selectedBiz.kit?.colors.background ?? 'var(--mo-faint)'} 60%, ${selectedBiz.kit?.colors.primary ?? 'var(--mo-line-strong)'})`,
                    }}
                  />
                  <b>{selectedBiz.name}</b> · {type} · {FORMAT_LABELS[format]}
                  {title.trim() && <> · “{title.trim()}”</>}
                </span>
              )}
              {!whoOpen && (
                <button type="button" className="edit" onClick={() => setWhoOpen(true)}>
                  Edit
                </button>
              )}
            </div>
            {whoOpen && (
              <div className="mo-who">
                <div>
                  <span className="lab">Brand — the recipe the deck composes against</span>
                  {/* A parked idea already belongs to a brand — offering a
                      picker that can't persist the change would be a lie. */}
                  <div className="mo-brandrow">
                    {!businesses && <span style={{ fontSize: 13, color: 'var(--mo-faint)' }}>Loading…</span>}
                    {businesses?.map((b) => (
                      <button
                        type="button"
                        key={b._id}
                        className={b._id === businessId ? 'on' : undefined}
                        disabled={Boolean(ideaFrom)}
                        onClick={() => setBusinessId(b._id)}
                      >
                        <span
                          className="k"
                          style={{
                            background: `linear-gradient(135deg, ${b.kit?.colors.background ?? 'var(--mo-faint)'} 60%, ${b.kit?.colors.primary ?? 'var(--mo-line-strong)'})`,
                          }}
                        />
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="row2">
                  <div>
                    <span className="lab">Type</span>
                    <div className="mo-toggle">
                      {ASSET_TYPES.map((t) => (
                        <button type="button" key={t} className={type === t ? 'on' : undefined} onClick={() => setType(t)}>
                          {t === 'carousel' ? 'Carousel' : 'Story'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="lab">Format</span>
                    <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                      {formats.map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="lab">Title</span>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="3 traits of resilient founders"
                      required
                    />
                  </div>
                </div>
                <div className="next">
                  <button
                    type="button"
                    className="mo-btn prim"
                    disabled={!whoDone}
                    onClick={() => setWhoOpen(false)}
                  >
                    Looks right →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Beat 2: the writing desk ── */}
        <div className={`mo-beat${briefReady ? ' done' : ' on'}`}>
          <div className="snum">{briefReady ? '✓' : '2'}</div>
          <span className="rail-ln" aria-hidden />
          <div className="bcard">
            <div className="bh">
              <span className="t">What should it say?</span>
              <span className="sum">links become sources · “quotes” become locks</span>
            </div>
            <div className="mo-paper">
              <div>
                <div className="writing">
                  <textarea
                    id="np-idea"
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder={
                      'Write it the way you’d brief a designer.\n' +
                      'Paste a link and it gets read. Put "an exact line" in quotes to use it word for word.'
                    }
                  />
                  <div className="foot">
                    <span>The AI writes it in the brand voice, in the brand&rsquo;s design system.</span>
                    <span className={`cnt${ideaTooLong ? ' over' : ''}`}>
                      {idea.length} / {MAX_DRAFT_PARAGRAPH_CHARS}
                    </span>
                  </div>
                </div>

                {/* The slide plan, folded into the writing beat as an outline. */}
                <div className="mo-plan">
                  <div className="ph">
                    <button
                      type="button"
                      className="ph"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit', display: 'inline-flex', gap: 9 }}
                      onClick={() => setPlanOpen((v) => !v)}
                      aria-expanded={planOpen}
                    >
                      Slide-by-slide plan
                      <span className="b">
                        {filledPlan.length ? `${filledPlan.length} beat${filledPlan.length === 1 ? '' : 's'}` : 'optional'}
                      </span>
                      <span aria-hidden>{planOpen ? '▾' : '▸'}</span>
                    </button>
                    <button type="button" className="add" onClick={addPlanRow} disabled={plan.length >= MAX_PLAN_SLIDES}>
                      ＋ Add a slide
                    </button>
                  </div>
                  {planOpen && (
                    <>
                      <p className="hint">
                        Leave it empty and the deck is shaped for you. Add rows to fix one slide per
                        line, in this order — anything in <b>&ldquo;double quotes&rdquo;</b> is used word for word.
                      </p>
                      {plan.map((row, i) => (
                        <div className="mo-planrow" key={i}>
                          <span className="n">{i + 1}</span>
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
                          <div className="ctl">
                            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => movePlanRow(i, -1)}>
                              <Icon name="arrow-up" size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              disabled={i === plan.length - 1}
                              onClick={() => movePlanRow(i, 1)}
                            >
                              <Icon name="arrow-down" size={12} />
                            </button>
                            <button type="button" aria-label="Remove slide" onClick={() => removePlanRow(i)}>
                              <Icon name="close" size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* The margin: the parser's understanding, next to the writing. */}
              <aside className="mo-notes" aria-label="What the AI heard">
                {brief.urls.map((u) => (
                  <div className="mo-note" key={u}>
                    <span className="t">Will read</span>
                    <b>{hostOf(u)}</b> — the deck&rsquo;s claims come from here.
                  </div>
                ))}
                {brief.locks.map((l) => (
                  <div className="mo-note q" key={l}>
                    <span className="t">Word for word</span>
                    <b>“{l.length > 60 ? `${l.slice(0, 60)}…` : l}”</b> — locked; the copywriter can&rsquo;t touch it.
                  </div>
                ))}
                {briefReady && (
                  <div className="mo-note n">
                    <span className="t">Heard</span>
                    {count.fixed ? (
                      <>
                        <b>{count.target} slides</b> — fixed by your plan.
                      </>
                    ) : (
                      <>
                        <b>
                          ~{count.min}–{count.max} slides
                        </b>{' '}
                        — the material decides.
                      </>
                    )}
                  </div>
                )}
                {aiReady && selectedBiz && !profileReady && (
                  <div className="mo-note warn">
                    <span className="t">Before composing</span>
                    Complete <Link href={`/businesses/${selectedBiz._id}`}>{selectedBiz.name}&rsquo;s profile</Link> —
                    the copywriter needs to know who it&rsquo;s talking to.
                  </div>
                )}
                {!briefReady && brief.urls.length === 0 && (
                  <div className="mo-note idle">
                    <span className="t">The margin</span>
                    As you write, what the AI understands appears here — sources, locked lines, the
                    slide count it hears.
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>

        {/* ── Beat 3: the forecast, then the spend ── */}
        <div className={`mo-beat${canSubmit ? ' on' : ' locked'}`}>
          <div className="snum">3</div>
          <div className="bcard">
            <div className="bh">
              <span className="t">Compose</span>
              {!briefReady && <span className="sum">unlocks when the brief has something to say</span>}
            </div>
            {briefReady && (
              <div className="mo-fcast">
                {brief.urls.length > 0 && (
                  <div>
                    <div className="lab" style={{ marginBottom: 8 }}>It will read</div>
                    {brief.urls.map((u) => (
                      <div className="mo-fsrc" key={u} style={{ marginBottom: 8 }}>
                        <span
                          className="fav"
                          style={{
                            background: selectedBiz?.kit?.colors.background ?? 'var(--mo-ink)',
                            color: selectedBiz?.kit?.colors.primary ?? '#fff',
                          }}
                        >
                          {hostOf(u).charAt(0).toUpperCase()}
                        </span>
                        <span>
                          <b>{hostOf(u)}</b>
                          <span>fetched live at compose — failures are reported, never skipped silently</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {brief.locks.length > 0 && (
                  <div>
                    <div className="lab" style={{ marginBottom: 8 }}>Kept word for word</div>
                    {brief.locks.map((l) => (
                      <div className="mo-flock" key={l} style={{ marginBottom: 8 }}>
                        <Icon name="quote" size={12} />
                        <em>“{l}”</em>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <div className="lab" style={{ marginBottom: 8 }}>
                    The deck it intends · {count.fixed ? `${count.target} slides` : `~${count.target} slides`}
                  </div>
                  <div className="mo-ghostrow">
                    {ghosts.map((g, i) => (
                      <div className="mo-ghost" key={i}>
                        <div className={`art${g.locked ? ' q' : ''}`}>
                          <span className="role">{brief.plan.length ? `beat ${i + 1}` : 'auto'}</span>
                          {g.gist && <span className="what">{g.gist}</span>}
                        </div>
                        <div className="cap">
                          {String(i + 1).padStart(2, '0')}
                          {g.locked ? ' · locked' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {selectedBiz && (
                  <div className="mo-frecipe">
                    <span className="sw" style={{ background: selectedBiz.kit?.colors.background ?? 'var(--mo-faint)' }} />
                    <span className="sw" style={{ background: selectedBiz.kit?.colors.primary ?? 'var(--mo-line-strong)' }} />
                    <b>{selectedBiz.name}&rsquo;s recipe</b> · approved — every slide composes against it
                  </div>
                )}
                {canSubmit ? (
                  <div className="mo-verdict ok">
                    <i /> Everything checks out — Compose is ready.
                  </div>
                ) : (
                  <div className="mo-verdict warn">
                    <i />
                    {!aiReady ? (
                      <>Set an Anthropic key + model in Settings to enable composing.</>
                    ) : !profileReady && selectedBiz ? (
                      <>
                        <Link href={`/businesses/${selectedBiz._id}`}>Complete {selectedBiz.name}&rsquo;s profile</Link>
                        &nbsp;to unlock composing.
                      </>
                    ) : ideaTooLong ? (
                      <>The brief is over the {MAX_DRAFT_PARAGRAPH_CHARS}-character limit — tighten it a little.</>
                    ) : !whoDone ? (
                      <>Give the post a title in step 1.</>
                    ) : (
                      <>Almost there.</>
                    )}
                  </div>
                )}
                <div className="acts">
                  <button className="mo-btn-compose" type="submit" disabled={!canSubmit || busy}>
                    {busy ? 'Composing…' : <>✦ Compose with AI</>}
                  </button>
                  <button
                    className="park"
                    type="button"
                    disabled={busy || !businessId || !title.trim()}
                    title="Save the prompt and compose it later from the desk"
                    onClick={() => void park()}
                  >
                    {ideaFrom ? 'Keep as idea' : 'Save as idea instead'}
                  </button>
                </div>
              </div>
            )}
          </div>
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
