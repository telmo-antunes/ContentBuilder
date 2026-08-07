'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ALLOWED_FORMATS,
  ASSET_TYPES,
  BUSINESS_CATEGORIES,
  FORMAT_LABELS,
  defaultFormatFor,
  type AssetType,
  type BusinessCategory,
  type BusinessProfile,
  type Format,
  type RecipeCandidate,
} from '@contentbuilder/shared';
import {
  analyzeBusiness,
  authorRecipeCandidates,
  composeProjectAI,
  createBusiness,
  createManualKit,
  createProject,
  getBrandKit,
  getBusiness,
  patchBrandKit,
  selectRecipeCandidate,
  type BrandKitState,
  type BusinessDetail,
} from '../lib/api';
import {
  ONBOARDING_STEPS,
  STEP_COPY,
  onboardingStep,
  stepIndex,
  type OnboardingStep,
} from '../../lib/onboarding';
import { ANALYZE_STAGES, COMPOSE_STAGES, RECIPE_STAGES } from '../components/useStagedProgress';
import { WorkingPanel } from '../components/WorkingPanel';
import { ErrorState } from '../components/ErrorState';
import { Icon } from '../components/Icon';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../lib/render/SlideFrame';
import type { RenderBrandKit } from '../../lib/render/types';

/**
 * SETTING UP A BRAND, END TO END.
 *
 * Before this, adding a brand was a form that closed. You typed a name and a
 * link, a card appeared on the Desk, and everything that actually had to happen
 * next — analyse the site, design a system, approve it, create a project,
 * compose it — was left for you to discover across four other screens.
 *
 * This is one road from the name to the first post. Three things make it a road
 * rather than another form:
 *
 *  1. IT KNOWS WHERE YOU ARE. The step is derived from the brand's own data
 *     (see `onboardingStep`), never from component state, so closing the tab,
 *     refreshing, or coming back tomorrow resumes exactly where you stopped.
 *     `?b=<id>` in the URL is the whole of the bookmark.
 *
 *  2. IT DOES NOT REIMPLEMENT ANYTHING. Every step drives the endpoint the
 *     manual screens already drive. A second way to analyse a site or approve a
 *     kit would drift from the first one within a month.
 *
 *  3. IT NEVER TRAPS YOU. Every step can be left for the ordinary screens, and
 *     leaving loses nothing, because of (1).
 */
export default function StartPage() {
  return (
    <Suspense fallback={<Skeleton shape="block" h={320} />}>
      <Start />
    </Suspense>
  );
}

function Start() {
  const router = useRouter();
  const params = useSearchParams();
  const businessId = params.get('b');

  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [kit, setKit] = useState<BrandKitState | null>(null);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'create' | 'read' | 'design' | 'choose' | 'compose'>(null);
  const [candidates, setCandidates] = useState<RecipeCandidate[] | null>(null);
  /**
   * The analyse endpoint reports when what it got back is weak — a near
   * monochrome palette, nothing to sample. The brand-kit screen uses it to
   * suggest re-analysing or entering values by hand; this flow was dropping it
   * on the floor and marching on to spend two Opus calls designing against a
   * kit it had itself judged poor.
   */
  const [lowQuality, setLowQuality] = useState(false);

  const load = useCallback(async (id: string) => {
    const [b, k] = await Promise.all([getBusiness(id), getBrandKit(id)]);
    setBusiness(b);
    setKit(k);
    setCandidates(k.draft?.recipeCandidates?.length ? k.draft.recipeCandidates : null);
    return { business: b, kit: k };
  }, []);

  useEffect(() => {
    if (!businessId) {
      setBusiness(null);
      setKit(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    load(businessId)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [businessId, load]);

  // THE derivation. Everything the page shows hangs off this one value.
  const step: OnboardingStep = useMemo(
    () => onboardingStep({ business, kit }),
    [business, kit],
  );

  // A brand that finished setup while you were on this page has somewhere
  // better to be than a wizard telling it there is nothing left to do.
  useEffect(() => {
    if (step === 'done' && business) router.replace(`/businesses/${business._id}`);
  }, [step, business, router]);

  if (error) return <ErrorState message={error} onRetry={() => businessId && void load(businessId)} />;

  return (
    <div className="ob">
      <header className="ob-head">
        <h1>{business ? business.name : 'Set up a brand'}</h1>
        <Rail step={step} />
      </header>

      {loading ? (
        <Skeleton shape="block" h={280} />
      ) : (
        <section className="ob-body">
          {step === 'name' && (
            <StepName
              busy={busy === 'create'}
              onSubmit={async (name, websiteUrl, profile) => {
                setBusy('create');
                try {
                  const b = await createBusiness({ name, websiteUrl, profile });
                  // Straight on to the next step — the old flow ended here, and
                  // that ending IS the bug this page exists to fix.
                  router.replace(`/start?b=${b._id}`);
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e), 'error');
                  setBusy(null);
                }
              }}
            />
          )}

          {step === 'read' && business && (
            <StepRead
              business={business}
              busy={busy === 'read'}
              onRead={async () => {
                setBusy('read');
                try {
                  const res = await analyzeBusiness(business._id);
                  setLowQuality(Boolean(res.lowQuality));
                  await load(business._id);
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e), 'error');
                } finally {
                  setBusy(null);
                }
              }}
              onManual={async () => {
                setBusy('read');
                try {
                  await createManualKit(business._id);
                  await load(business._id);
                  toast('Blank kit created — fill in the colours and type by hand');
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e), 'error');
                } finally {
                  setBusy(null);
                }
              }}
            />
          )}

          {step === 'design' && business && kit && (
            <StepDesign
              business={business}
              kit={kit}
              candidates={candidates}
              lowQuality={lowQuality}
              busy={busy}
              onDesign={async () => {
                const k = kit.draft ?? kit.approved;
                if (!k) return;
                setBusy('design');
                try {
                  const res = await authorRecipeCandidates(k._id, 2);
                  setCandidates(res.candidates.length ? res.candidates : null);
                  if (!res.candidates.length) toast('No directions came back — try again', 'error');
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e), 'error');
                } finally {
                  setBusy(null);
                }
              }}
              onChoose={async (candidateId) => {
                const k = kit.draft ?? kit.approved;
                if (!k) return;
                setBusy('choose');
                try {
                  // Two calls, one decision: the chosen direction becomes the
                  // kit's live recipe, and the kit is approved — which is what
                  // "pick this one" means during setup. The brand-kit screen
                  // keeps the fine-grained version for later.
                  await selectRecipeCandidate(k._id, candidateId);
                  await patchBrandKit(k._id, { status: 'approved' });
                  await load(business._id);
                  setCandidates(null);
                  toast('Brand approved — now let’s make something with it');
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e), 'error');
                } finally {
                  setBusy(null);
                }
              }}
            />
          )}

          {step === 'post' && business && kit?.approved && (
            <StepPost
              business={business}
              kit={kit}
              busy={busy === 'compose'}
              onCompose={async (idea, type, format) => {
                setBusy('compose');
                try {
                  const created = await createProject({
                    businessId: business._id,
                    title: idea.slice(0, 60),
                    type,
                    format,
                    idea,
                  });
                  await composeProjectAI(created._id, idea);
                  router.push(`/projects/${created._id}/review`);
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e), 'error');
                  setBusy(null);
                }
              }}
            />
          )}
        </section>
      )}

      {/* Never a trap. Leaving loses nothing — the step is derived, so coming
          back lands in exactly this spot. */}
      {business && step !== 'done' && (
        <footer className="ob-foot">
          <Link href={`/businesses/${business._id}`}>Leave setup — {business.name} is saved</Link>
        </footer>
      )}
    </div>
  );
}

/** Where you are, and what is still ahead. Four stops, always all visible. */
function Rail({ step }: { step: OnboardingStep }) {
  const at = stepIndex(step);
  return (
    <ol className="ob-rail" aria-label="Setup progress">
      {ONBOARDING_STEPS.map((s, i) => (
        <li
          key={s}
          className={i < at ? 'done' : i === at ? 'now' : ''}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="ob-rail-dot">{i < at ? <Icon name="check" size={11} /> : i + 1}</span>
          {STEP_COPY[s].short}
        </li>
      ))}
    </ol>
  );
}

function StepHead({ step }: { step: (typeof ONBOARDING_STEPS)[number] }) {
  const c = STEP_COPY[step];
  return (
    <>
      <h2 className="ob-title">{c.title}</h2>
      {c.blurb && <p className="ob-blurb">{c.blurb}</p>}
    </>
  );
}

/**
 * Name, kind, site.
 *
 * The KIND is not decoration and not deferred: `POST /analyze` refuses to run
 * without `profile.category`, so a brand created without one cannot be read at
 * all. That requirement used to be invisible — you added a brand, opened it,
 * hit "Create brand kit", pressed analyse, and got told to go and fill in a
 * profile card further down a different page. Asking here costs one select and
 * removes the flow's only hard stop. What it does, in a line, is optional but
 * grounds the caption writer and the recipe author, so it is worth the field.
 */
function StepName({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (name: string, websiteUrl: string | undefined, profile: BusinessProfile) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<BusinessCategory | ''>('');
  const [offer, setOffer] = useState('');
  const hint = BUSINESS_CATEGORIES.find((c) => c.value === category)?.hint;
  return (
    <form
      className="ob-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !category) return;
        onSubmit(name.trim(), url.trim() || undefined, {
          category,
          ...(offer.trim() ? { offer: offer.trim() } : {}),
        });
      }}
    >
      <StepHead step="name" />
      <div className="field">
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
      <div className="field">
        <label htmlFor="ob-cat">What kind of business is it?</label>
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
        {hint && <p className="ob-hint">{hint}</p>}
      </div>
      <div className="field">
        <label htmlFor="ob-offer">What does it do, in a line? (optional)</label>
        <input
          id="ob-offer"
          value={offer}
          onChange={(e) => setOffer(e.target.value)}
          placeholder="Paint correction and ceramic coating for enthusiasts"
        />
      </div>
      <div className="field">
        <label htmlFor="ob-url">Website</label>
        <input
          id="ob-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
        />
        <p className="ob-hint">
          Optional, but it is the difference between a brand read off its own site and one built by
          hand. No site? Leave it — you can enter the colours and type yourself on the next step.
        </p>
      </div>
      <button className="btn primary" type="submit" disabled={busy || !name.trim() || !category}>
        {busy ? 'Creating…' : 'Continue'}
      </button>
    </form>
  );
}

function StepRead({
  business,
  busy,
  onRead,
  onManual,
}: {
  business: BusinessDetail;
  busy: boolean;
  onRead: () => void;
  onManual: () => void;
}) {
  // With no site there is nothing to read, so don't offer reading — go straight
  // to the honest alternative rather than showing a disabled primary button.
  const hasUrl = Boolean(business.websiteUrl);

  if (busy) {
    return (
      <div className="ob-card">
        <WorkingPanel
          active
          bare
          stages={ANALYZE_STAGES}
          title={`Reading ${business.name}`}
          sub="Loading the site, sampling its colours, measuring its type, finding the logo and listening to how it talks. This takes ~15–30s."
        />
      </div>
    );
  }

  return (
    <div className="ob-card">
      <StepHead step="read" />
      {hasUrl ? (
        <>
          <p className="ob-source">
            <Icon name="sparkle" size={13} /> {business.websiteUrl}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={onRead}>
              Read the website
            </button>
            <button className="btn ghost" onClick={onManual}>
              Enter it by hand instead
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="ob-hint" style={{ marginTop: 0 }}>
            No website was given for {business.name}, so there is nothing to read from. Start from a
            blank kit and set the colours and type yourself — or add the site on the brand page and
            come back.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={onManual}>
              Start from a blank kit
            </button>
            <Link className="btn ghost" href={`/businesses/${business._id}`}>
              Add a website first
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function StepDesign({
  business,
  kit,
  candidates,
  lowQuality,
  busy,
  onDesign,
  onChoose,
}: {
  business: BusinessDetail;
  kit: BrandKitState;
  candidates: RecipeCandidate[] | null;
  /** The analyse step judged what it read to be weak. Say so before spending. */
  lowQuality: boolean;
  busy: null | string;
  onDesign: () => void;
  onChoose: (candidateId: string) => void;
}) {
  const k = kit.draft ?? kit.approved;
  const renderKit: RenderBrandKit | null = k
    ? {
        colors: k.colors,
        fonts: { render: k.fonts.render },
        logo: k.logo?.url ? { url: k.logo.url } : undefined,
        logoTreatment: k.logoTreatment,
      }
    : null;
  const previewSlide = {
    authored: {
      html:
        '<p class="eyebrow">Brand preview</p><h1 class="headline">' +
        business.name.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`) +
        '</h1><p class="tagline">On-brand in seconds.</p>',
    },
  };
  const palette = k ? [k.colors.background, k.colors.primary, k.colors.accent, k.colors.text] : [];

  if (busy === 'design') {
    return (
      <div className="ob-card">
        <WorkingPanel
          active
          bare
          stages={RECIPE_STAGES}
          title="Designing two directions"
          count={2}
          notes={['Faithful', 'Bolder']}
          palette={palette}
          sub="Two complete design systems authored from this kit — type, layout, imagery and motion — so you choose visually rather than from a description. This takes ~40–70s."
        />
      </div>
    );
  }

  if (candidates?.length && renderKit) {
    return (
      <div className="ob-card">
        <StepHead step="design" />
        <div className="ob-cands">
          {candidates.map((c) => {
            const [dirName, dirDetail] = c.note.split(/\s+—\s+/);
            return (
              <article key={c.id} className="ob-cand">
                <ScaledSlide format="1080x1350" displayWidth={230}>
                  <SlideRenderer
                    slide={previewSlide}
                    brandKit={{ ...renderKit, recipe: c.recipe }}
                    format="1080x1350"
                    forExport
                  />
                </ScaledSlide>
                <strong>{dirName || 'Direction'}</strong>
                {dirDetail && <span className="ob-cand-note">{dirDetail}</span>}
                <button
                  className="btn primary sm"
                  onClick={() => onChoose(c.id)}
                  disabled={busy !== null}
                >
                  {busy === 'choose' ? 'Approving…' : 'Use this one'}
                </button>
              </article>
            );
          })}
        </div>
        <p className="ob-hint">
          Whichever you pick becomes the live design system and approves the brand. Everything in it
          — colours, type, density, motion — stays editable on the brand page.
        </p>
      </div>
    );
  }

  return (
    <div className="ob-card">
      <StepHead step="design" />
      {renderKit && (
        <div className="ob-readout">
          <ScaledSlide format="1080x1350" displayWidth={160}>
            <SlideRenderer slide={previewSlide} brandKit={renderKit} format="1080x1350" forExport />
          </ScaledSlide>
          <dl>
            <div>
              <dt>Palette</dt>
              <dd className="ob-sw">
                {palette.map((c, i) => (
                  <span key={i} style={{ background: c }} title={c} />
                ))}
              </dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>
                {k?.fonts.render.heading} · {k?.fonts.render.body}
              </dd>
            </div>
            {k?.voice && (
              <div>
                <dt>Voice</dt>
                <dd>{k.voice.slice(0, 140)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {lowQuality && (
        <p className="ob-warn">
          <Icon name="warning" size={13} />
          What came back off the site is thin — the palette is close to monochrome. Designing from it
          will work, but adjusting the colours first usually gives a much better result.
        </p>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" onClick={onDesign} disabled={busy !== null}>
          <Icon name="sparkle" size={13} /> Design two directions
        </button>
        <Link className="btn ghost" href={`/businesses/${business._id}/brand-kit`}>
          Adjust the kit first
        </Link>
      </div>
    </div>
  );
}

/**
 * Openers, per kind of business.
 *
 * A generic set gave a coaching brand "three things included in every job that
 * customers are always surprised by" — which is a detailing prompt, and reads
 * as filler the moment you notice it. The category is already known by this
 * point (it had to be, to read the website at all), so the openers may as well
 * be about the right business.
 *
 * Deliberately not model-written: this step already spends a parse and a
 * compose, and a fourth call to produce three lines most people replace is not
 * worth the wait. They are starting points, not suggestions to accept.
 */
const STARTERS: Record<BusinessCategory, string[]> = {
  'personal-brand': [
    'The belief I held for years that turned out to be completely wrong.',
    'Three things I would tell someone starting where I started.',
    'What I actually do all day, versus what people assume.',
  ],
  'coach-creator': [
    'The mistake almost everyone makes in week one, and what to do instead.',
    'Three habits that separate the people who stick with it from the ones who quit.',
    'Why motivation is the wrong thing to wait for.',
  ],
  'saas-product': [
    'The problem this was built to kill, in one sentence.',
    'Three things it does that people do not expect on first use.',
    'What we deliberately left out, and why.',
  ],
  'local-service': [
    'The one mistake most people make before booking, and what to do instead.',
    'Three things included in every job that customers are always surprised by.',
    'What we do differently, in one honest sentence — and the proof.',
  ],
  ecommerce: [
    'How to choose between the two things everyone asks us to compare.',
    'Three details in this product that only show up after a month of use.',
    'What we would tell you not to buy, and what to get instead.',
  ],
  agency: [
    'The brief we turn down, and why saying no makes the work better.',
    'Three things a client should have ready before the first call.',
    'What actually moved the number on our last project.',
  ],
  nonprofit: [
    'Where the money goes, line by line.',
    'Three things people get wrong about the problem we work on.',
    'One story from this month that says it better than a statistic.',
  ],
  other: [
    'The one thing people always get wrong about what we do.',
    'Three things worth knowing before you get started.',
    'What we do differently, in one honest sentence — and the proof.',
  ],
};

function StepPost({
  business,
  kit,
  busy,
  onCompose,
}: {
  business: BusinessDetail;
  kit: BrandKitState;
  busy: boolean;
  onCompose: (idea: string, type: AssetType, format: Format) => void;
}) {
  const [idea, setIdea] = useState('');
  const [type, setType] = useState<AssetType>('carousel');
  const starters = STARTERS[business.profile?.category ?? 'other'] ?? STARTERS.other;
  const formats = ALLOWED_FORMATS[type];
  const [format, setFormat] = useState<Format>(defaultFormatFor(type));
  useEffect(() => {
    if (!formats.includes(format)) setFormat(defaultFormatFor(type));
  }, [type, formats, format]);

  if (busy) {
    return (
      <div className="ob-card">
        <WorkingPanel
          active
          bare
          stages={COMPOSE_STAGES}
          title="Writing your first post"
          palette={
            kit.approved
              ? [kit.approved.colors.background, kit.approved.colors.primary, kit.approved.colors.accent]
              : []
          }
          sub="Splitting the idea into slides, then arranging each one in the design system you just approved. This takes ~30–60s."
        />
      </div>
    );
  }

  return (
    <div className="ob-card">
      <StepHead step="post" />
      <div className="field">
        <label htmlFor="ob-idea">What should it say?</label>
        <textarea
          id="ob-idea"
          rows={4}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={`Something ${business.name} would actually post…`}
        />
      </div>
      <div className="ob-starters">
        <span>Or start from one of these:</span>
        {starters.map((s) => (
          <button key={s} type="button" className="ob-starter" onClick={() => setIdea(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="ob-formats">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ob-type">Kind</label>
          <select id="ob-type" value={type} onChange={(e) => setType(e.target.value as AssetType)}>
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ob-format">Size</label>
          <select id="ob-format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            {formats.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button className="btn primary" onClick={() => onCompose(idea.trim(), type, format)} disabled={!idea.trim()}>
        <Icon name="sparkle" size={13} /> Compose it
      </button>
    </div>
  );
}
