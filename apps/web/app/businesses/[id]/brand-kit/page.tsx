'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { BrandKit, BrandRecipe, TweakSuggestion, UpdateStatus } from '@contentbuilder/shared';
import { BUNDLED_FONT_FAMILIES, applyKitToRecipe, contrastRatio } from '@contentbuilder/shared';
import {
  getBrandKit,
  getBusiness,
  analyzeBusiness,
  createManualKit,
  patchBrandKit,
  dismissKitSuggestion,
  uploadMedia,
  authorBrandRecipe,
  authorRecipeCandidates,
  selectRecipeCandidate,
  refineRecipeLayer,
  ApiClientError,
  type BusinessDetail,
  type RecipeCandidate,
  type RecipeLayer,
} from '../../../lib/api';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import type { RenderBrandKit } from '../../../../lib/render/types';
import { confirm } from '../../../components/ConfirmDialog';
import { ErrorState } from '../../../components/ErrorState';
import { Icon } from '../../../components/Icon';
import PromptUpdates from '../../../components/PromptUpdates';
import { Skeleton } from '../../../components/Skeleton';
import { toast } from '../../../components/Toast';
import {
  ANALYZE_STAGES,
  REANALYZE_STAGES,
  RECIPE_STAGES,
  type ProgressStage,
} from '../../../components/useStagedProgress';
import { WorkingPanel } from '../../../components/WorkingPanel';

type ColorRoleKey = 'primary' | 'secondary' | 'accent' | 'background' | 'text';
const ROLES: Array<[ColorRoleKey, string]> = [
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['accent', 'Accent'],
  ['background', 'Background'],
  ['text', 'Text'],
];

/** Mirrors the server's CANDIDATE_DIRECTIONS order, for labelling the ghosts. */
const CANDIDATE_NOTES = ['Faithful', 'Bolder', 'Quieter'];

/**
 * The recipe's three layers, in plain words. The stored keys are
 * background/type/components; nobody outside the code thinks in those terms,
 * so the chooser names the CONCERN each one owns.
 */
const REFINE_LAYERS: Array<[RecipeLayer, string]> = [
  ['background', 'Background & texture'],
  ['type', 'Type & scale'],
  ['components', 'Components'],
];

/** One layer, not a whole re-author — a much shorter wait, narrated honestly. */
const REFINE_STAGES: ProgressStage[] = [
  { label: 'Reading the current design…', atMs: 0 },
  { label: 'Rewriting that layer…', atMs: 6000 },
  { label: 'Checking legibility and classes…', atMs: 18000 },
  { label: 'Almost there…', atMs: 30000 },
];

export default function BrandKitPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [hasApproved, setHasApproved] = useState(false);
  const [suggestion, setSuggestion] = useState<TweakSuggestion | null>(null);
  const [promptUpdates, setPromptUpdates] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [biz, state] = await Promise.all([getBusiness(id), getBrandKit(id)]);
      setBusiness(biz);
      setKit(state.draft ?? state.approved);
      setHasApproved(Boolean(state.approved));
      // The suggestion is about the APPROVED kit — while a pending draft is
      // open in the editor, applying it there would tune the wrong kit.
      setSuggestion(state.draft ? null : (state.suggestion ?? null));
      // Like the suggestion, this is about the APPROVED kit — the one posts are
      // actually composed against. A pending draft is about to replace it.
      setPromptUpdates(state.draft ? null : (state.promptUpdates ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const analyze = async () => {
    if (
      hasApproved &&
      !(await confirm({
        title: 'Replace brand kit?',
        message: 'This will replace the current approved brand kit. Continue?',
        confirmText: 'Replace',
      }))
    ) {
      return;
    }
    setBusy('analyze');
    try {
      const draft = await analyzeBusiness(id);
      setKit(draft);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const startManual = async () => {
    if (
      hasApproved &&
      !(await confirm({
        title: 'Replace brand kit?',
        message: 'This will replace the current approved brand kit. Continue?',
        confirmText: 'Replace',
      }))
    ) {
      return;
    }
    setBusy('manual');
    try {
      const draft = await createManualKit(id);
      setKit(draft);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mo-page mo-kit mo-studio">
      <p className="mo-crumb">
        <Link href="/">Home</Link>
        {' / '}
        <Link href={`/businesses/${id}`}>{business?.name ?? 'Brand'}</Link>
        {' / '}
        Brand kit
      </p>

      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {loading && (
        // The Passport's shape while it loads: header, chips, hero tile, receipts.
        <div role="status" aria-label="Loading the brand kit">
          <Skeleton shape="block" w={380} h={34} style={{ marginBottom: 20 }} />
          <div className="row" style={{ gap: 8, marginBottom: 18 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} shape="block" w={170} h={30} style={{ borderRadius: 999 }} />
            ))}
          </div>
          <Skeleton shape="block" h={380} style={{ borderRadius: 20, marginBottom: 14 }} />
          <Skeleton shape="block" h={180} style={{ borderRadius: 20 }} />
        </div>
      )}

      {!loading && !kit && busy === 'analyze' && (
        <div style={{ maxWidth: 640 }}>
          <WorkingPanel
            active
            stages={ANALYZE_STAGES}
            title="Meeting your brand"
            sub="Reading the site's colours, type, logo and voice, then assigning roles — your brand kit is assembling. This takes ~20–40s."
          />
        </div>
      )}

      {!loading && !kit && busy !== 'analyze' && (
        <div className="mo-tile" style={{ maxWidth: 640 }}>
          <div className="mo-th">
            <span className="t">{business ? `The ${business.name} kit` : 'The brand kit'}</span>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--mo-muted)' }}>
            Derive a brand kit from the website, or enter one manually (common for businesses that
            live only on Instagram). The extracted kit is always a draft until you approve it.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="mo-btn prim"
              onClick={analyze}
              disabled={!business?.websiteUrl || !business?.hasProfile || busy !== null}
              title={
                !business?.hasProfile
                  ? 'Complete the brand profile first'
                  : business?.websiteUrl
                    ? business.websiteUrl
                    : 'No website on file'
              }
            >
              Analyze website
            </button>
            <button className="mo-btn" onClick={startManual} disabled={busy !== null}>
              {busy === 'manual' ? 'Creating…' : 'Skip extraction / enter manually'}
            </button>
          </div>
          {business && !business.hasProfile && (
            <p style={{ fontSize: 13, color: 'var(--mo-muted)', margin: '12px 0 0' }}>
              AI extraction is locked until you{' '}
              <Link href={`/businesses/${id}`}>complete this brand&apos;s profile</Link>. You can still
              enter the kit manually now.
            </p>
          )}
          {!business?.websiteUrl && (
            <p style={{ fontSize: 13, color: 'var(--mo-muted)', margin: '12px 0 0' }}>
              This brand has no website URL — use manual entry, or add a URL on the brand page.
            </p>
          )}
        </div>
      )}

      {!loading && kit && (
        <KitEditor
          key={kit._id}
          businessId={id}
          businessName={business?.name ?? 'Your brand'}
          projects={business?.projects ?? []}
          kit={kit}
          hasApproved={hasApproved}
          suggestion={suggestion}
          promptUpdates={promptUpdates}
          onSuggestionResolved={() => setSuggestion(null)}
          onReanalyze={business?.websiteUrl ? analyze : undefined}
          onManual={startManual}
          busy={busy}
          setBusy={setBusy}
          onApproved={() => router.push(`/businesses/${id}`)}
        />
      )}
    </div>
  );
}


/** Turn provenance codes into sentences a non-developer can read. */
function provenanceChips(p: BrandKit['provenance'] | undefined): string[] {
  if (!p) return [];
  const chips: string[] = [];
  if (p.colors === 'computed') chips.push('Colors read from the site’s real styles');
  else if (p.colors === 'sampled') chips.push('Colors sampled from a screenshot');
  else if (p.colors === 'manual') chips.push('Colors entered manually');
  if (p.fonts === 'site:google-fonts') chips.push('Real site fonts, served via Google Fonts');
  else if (typeof p.fonts === 'string' && p.fonts.startsWith('personality:')) {
    chips.push(`Fonts matched to the headline’s style (${p.fonts.split(':')[1]?.replace(/-/g, ' ')})`);
  } else if (p.fonts === 'computed+mapped') chips.push('Fonts name-matched from the site');
  else if (p.fonts === 'manual') chips.push('Fonts chosen manually');
  if (p.logo === 'dom') chips.push('Logo found on the site');
  return chips;
}

/** Plain-voice copy for the learned suggestion — what happened, what one click does. */
function suggestionCopy(s: TweakSuggestion): string {
  if (s.kind === 'invert') {
    return `You’ve flipped ${s.count} posts to the inverse surface — make it the default so new posts start there?`;
  }
  const posts = `${s.count} post${s.count === 1 ? '' : 's'}`;
  return s.reason === 'smaller-headline'
    ? `You’ve shrunk headlines on ${posts} — set the type a step denser so they start out right?`
    : `You’ve bumped headlines up on ${posts} — give the type a step more room so they start out right?`;
}

/** Strip Next.js's internal font tokens ("__Playfair_Display_eea437" → "Playfair Display"). */
function cleanFontName(raw: string): string {
  return raw
    .split(',')[0]!
    .replace(/^__/, '')
    .replace(/_[0-9a-f]{6}$/i, '')
    .replace(/_/g, ' ')
    .replace(/["']/g, '')
    .trim();
}

/** Platform defaults, not brand choices — no point offering these as a "site font". */
const GENERIC_FONTS = new Set([
  'arial', 'helvetica', 'helvetica neue', 'times', 'times new roman', 'georgia',
  'verdana', 'tahoma', 'trebuchet ms', 'segoe ui', 'system-ui', '-apple-system',
  'blinkmacsystemfont', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif',
]);

/**
 * Bundled families plus, when the analyzed site uses a real (non-generic,
 * non-bundled) font, that font as a "site font — via Google Fonts" option. The
 * server verifies GF availability on save, so a typo'd/unavailable family is
 * rejected with a clear error rather than silently falling back to sans.
 */
function FontSelect({
  label,
  value,
  detected,
  onChange,
}: {
  label: string;
  value: string;
  detected?: string;
  onChange: (f: string) => void;
}) {
  const site = detected ? cleanFontName(detected) : '';
  const siteOption = site && !BUNDLED_FONT_FAMILIES.includes(site) && !GENERIC_FONTS.has(site.toLowerCase()) ? site : '';
  // A kit saved with a site font keeps it selectable even if detection changed.
  const extra = [...new Set([siteOption, value].filter((f) => f && !BUNDLED_FONT_FAMILIES.includes(f)))];
  return (
    <div className="field" style={{ margin: 0 }}>
      <label>
        {label}
        {site ? ` · site uses ${site}` : ''}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {extra.map((f) => (
          <option key={f} value={f}>
            {f} — site font (Google Fonts)
          </option>
        ))}
        {BUNDLED_FONT_FAMILIES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </div>
  );
}

function KitEditor({
  businessId,
  businessName,
  projects,
  kit,
  hasApproved,
  suggestion,
  promptUpdates,
  onSuggestionResolved,
  onReanalyze,
  onManual,
  busy,
  setBusy,
  onApproved,
}: {
  businessId: string;
  businessName: string;
  projects: BusinessDetail['projects'];
  kit: BrandKit;
  hasApproved: boolean;
  suggestion: TweakSuggestion | null;
  promptUpdates: UpdateStatus | null;
  onSuggestionResolved: () => void;
  onReanalyze?: () => void;
  onManual: () => void;
  busy: string | null;
  setBusy: (s: string | null) => void;
  onApproved: () => void;
}) {
  const [colors, setColors] = useState({ ...kit.colors });
  const [heading, setHeading] = useState(kit.fonts.render.heading);
  const [body, setBody] = useState(kit.fonts.render.body);
  const [styleDescriptor, setStyleDescriptor] = useState(kit.styleDescriptor ?? '');
  const [voice, setVoice] = useState(kit.voice ?? '');
  const [logo, setLogo] = useState<{ key: string; url: string; sourceUrl?: string } | undefined>(
    kit.logo?.url ? { key: kit.logo.key ?? '', url: kit.logo.url, sourceUrl: kit.logo.sourceUrl } : undefined,
  );
  const [logoTreatment, setLogoTreatment] = useState<'original' | 'mono'>(kit.logoTreatment ?? 'original');
  const [recipe, setRecipe] = useState<BrandRecipe | undefined>((kit as { recipe?: BrandRecipe }).recipe);
  // Direction candidates — either just authored, or left on the kit by a
  // previous run (the server keeps them until one is selected).
  const [candidates, setCandidates] = useState<RecipeCandidate[] | null>(() => {
    const list = kit.recipeCandidates;
    return list && list.length ? list : null;
  });
  const [candCount, setCandCount] = useState<2 | 3>(2);
  // Refine: which layer to rewrite, and the one-line ask.
  const [refineLayer, setRefineLayer] = useState<RecipeLayer>('background');
  const [refineNote, setRefineNote] = useState('');
  // What the server currently holds — the baseline unsaved edits are measured
  // against for the forecast's "now → after save" comparison.
  const [savedBase, setSavedBase] = useState(() => ({
    colors: { ...kit.colors },
    heading: kit.fonts.render.heading,
    body: kit.fonts.render.body,
  }));
  const fileRef = useRef<HTMLInputElement>(null);

  const setColor = (role: keyof BrandKit['colors'], value: string) =>
    setColors((c) => ({ ...c, [role]: value }));

  const renderKit: RenderBrandKit = {
    colors,
    fonts: { render: { heading, body } },
    logo: logo?.url ? { url: logo.url } : undefined,
    logoTreatment,
    // Attach the recipe so the sample slide renders against the real design system
    // (falls back to a neutral branded field until a recipe has been authored).
    recipe,
  };

  const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const colorsValid = ROLES.every(([role]) => HEX.test(colors[role]));

  const save = async (approve: boolean) => {
    if (
      approve &&
      hasApproved &&
      kit.status === 'draft' &&
      !(await confirm({
        title: 'Replace brand kit?',
        message: 'This will replace the current approved brand kit. Continue?',
        confirmText: 'Replace',
      }))
    ) {
      return;
    }
    setBusy('save');
    try {
      const updated = await patchBrandKit(kit._id, {
        colors,
        fonts: { render: { heading, body } },
        ...(logo ? { logo } : {}),
        logoTreatment,
        styleDescriptor,
        voice,
        status: approve ? 'approved' : 'draft',
      });
      if (approve) {
        toast('Brand kit approved — backgrounds & compositions are being designed');
        onApproved();
      } else {
        toast('Brand kit saved');
        // Re-baseline the forecast and adopt the server's re-pointed recipe,
        // so the "now → after save" comparison folds away once the save lands.
        setSavedBase({ colors: { ...colors }, heading, body });
        const rec = (updated as { recipe?: BrandRecipe }).recipe;
        if (rec) setRecipe(rec);
        setBusy(null);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      setBusy(null);
    }
  };

  const onUploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setBusy('logo');
    try {
      const asset = await uploadMedia(businessId, file);
      setLogo({ key: asset.key, url: asset.url });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const isDraft = kit.status === 'draft';

  const readable = (hex: string): string => {
    if (!HEX.test(hex)) return '#ffffff';
    try {
      return contrastRatio(hex, '#111111') >= contrastRatio(hex, '#ffffff') ? '#111111' : '#ffffff';
    } catch {
      return '#ffffff';
    }
  };

  /**
   * Tune the recipe directly. Instant and scoped — a colour or tempo change used
   * to require a full re-author, which also rewrote everything else.
   */
  const saveRecipeKnobs = async (knobs: Record<string, string | boolean>) => {
    setBusy('knobs');
    try {
      const updated = (await patchBrandKit(kit._id, { recipe: knobs } as never)) as {
        recipe?: BrandRecipe;
      };
      if (updated.recipe) setRecipe(updated.recipe);
      toast('Recipe updated — every post follows', 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * "Make it so" on the learned suggestion — the exact knobs PATCH the Tune
   * row uses (density step), or the surface flip. The server clears the spent
   * counters as part of the same PATCH.
   */
  const applySuggestion = async (s: TweakSuggestion) => {
    await saveRecipeKnobs(s.kind === 'density' ? { density: s.to } : { flipSurfaces: true });
    onSuggestionResolved();
  };

  /** "Not now" — a 14-day snooze on the server, so it survives reloads. */
  const snoozeSuggestion = async () => {
    try {
      await dismissKitSuggestion(kit._id);
      onSuggestionResolved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const authorRec = async () => {
    setBusy('recipe');
    try {
      const res = await authorBrandRecipe(kit._id);
      setRecipe((res as { recipe?: BrandRecipe }).recipe);
      toast('Brand recipe designed — new posts compose against it');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Author 2–3 candidate design systems in parallel, each on its own creative
   * direction, so the recipe is chosen visually instead of taken blind.
   */
  const authorCandidates = async () => {
    setBusy('candidates');
    try {
      const res = await authorRecipeCandidates(kit._id, candCount);
      setCandidates(res.candidates.length ? res.candidates : null);
      if (res.candidates.length < candCount) {
        toast(
          `${res.candidates.length} of ${candCount} directions came back — the others failed. Pick from these, or run again.`,
          'error',
        );
      } else {
        toast(`${res.candidates.length} directions designed — pick the one that feels right`);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        toast('A directions run is already in progress for this kit — give it a minute.', 'error');
      } else {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  const refineLayerLabel = REFINE_LAYERS.find(([key]) => key === refineLayer)?.[1] ?? refineLayer;

  /**
   * Rewrite ONE layer of the recipe from a sentence. The whole point is that
   * everything else survives, so the toast says which layer changed — and, when
   * the stored recipe has no layer split, admits the sheet was rewritten whole.
   */
  const refine = async () => {
    const instruction = refineNote.trim();
    if (!instruction) return;
    setBusy('refine');
    try {
      const updated = await refineRecipeLayer(kit._id, refineLayer, instruction);
      if (updated.recipe) setRecipe(updated.recipe);
      setRefineNote('');
      const label = refineLayerLabel.toLowerCase();
      toast(
        updated.refine?.mode === 'sheet'
          ? `Recipe refined — this design had no layer split, so the whole stylesheet was rewritten for the ${label}.`
          : `Refined the ${label} — the rest of the design is untouched.`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const chooseCandidate = async (candidateId: string) => {
    setBusy(`select:${candidateId}`);
    try {
      const updated = await selectRecipeCandidate(kit._id, candidateId);
      setRecipe(updated.recipe);
      setCandidates(null);
      toast('Direction chosen — every new post composes against it');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  // Recipe-authored sample: the same semantic markup a composed slide uses, so
  // the preview renders through the real recipe.
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const previewSlide = {
    authored: {
      html:
        '<p class="eyebrow">Brand preview</p><h1 class="headline">' +
        esc(businessName) +
        '</h1><p class="tagline">On-brand in seconds.</p>',
    },
  };
  // The kit's colours are already known while the recipe is being authored, so
  // the working panel ghosts THIS brand rather than five grey placeholders.
  const paletteSwatches = ROLES.map(([role]) => colors[role]).filter((c) => HEX.test(c));

  // ── Kit-edit diff: what saving will do to every post, shown BEFORE saving ──
  // applyKitToRecipe is the exact pure function the server runs on save, so the
  // "After save" forecast is a preview of the real consequence, not a guess.
  const kitEditsDirty =
    ROLES.some(([role]) => colors[role] !== savedBase.colors[role]) ||
    heading !== savedBase.heading ||
    body !== savedBase.body;
  const kitDiff = useMemo(() => {
    if (!recipe || !kitEditsDirty || !colorsValid) return null;
    try {
      const { recipe: after, changed } = applyKitToRecipe(recipe, {
        colors: {
          background: colors.background,
          text: colors.text,
          accent: colors.accent,
          secondary: colors.secondary,
        },
        fonts: { render: { heading, body } },
      });
      return changed.length ? { after, changed } : null;
    } catch {
      return null; // an in-progress hex mid-edit should never crash the page
    }
  }, [recipe, kitEditsDirty, colorsValid, colors, heading, body]);
  // "Now" renders the SAVED kit (not the live edits) against the live recipe.
  const savedRenderKit: RenderBrandKit = {
    colors: savedBase.colors,
    fonts: { render: { heading: savedBase.heading, body: savedBase.body } },
    logo: logo?.url ? { url: logo.url } : undefined,
    logoTreatment,
    recipe,
  };
  /** The kit the forecast paints your recent posts with. */
  const forecastKit: RenderBrandKit = kitDiff ? { ...renderKit, recipe: kitDiff.after } : renderKit;

  // Recent posts with an authored first slide — the forecast's subjects.
  const recentPosts = useMemo(
    () =>
      [...projects]
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
        .map((p) => ({
          project: p,
          first: [...(p.slides ?? [])].sort((a, b) => a.order - b.order)[0],
        }))
        .filter((x) => x.first?.authored?.html)
        .slice(0, 3),
    [projects],
  );

  // ── Readiness: the four things a finished kit has, driving the bar ──
  const voiceOk = voice.trim().length > 0;
  const logoOk = Boolean(logo?.url);
  const recipeOk = Boolean(recipe);
  const checksPassed = [colorsValid, voiceOk, logoOk, recipeOk].filter(Boolean).length;
  const checksLeft = 4 - checksPassed;
  const readyPct = Math.round((100 * checksPassed) / 4);

  /** Check chips jump to their receipt and open it — status as navigation. */
  const openReceipt = (rid: string) => {
    const el = document.getElementById(rid) as HTMLDetailsElement | null;
    if (el) {
      el.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <>
      <header className="mo-shead">
        <div>
          <div className="htitle">
            <span className="klogo">
              {logo?.url ? <img src={logo.url} alt="" /> : <span>{businessName.trim().charAt(0).toUpperCase()}</span>}
            </span>
            <h1>The {businessName} kit</h1>
          </div>
          <div className="meta">
            <span>{recipeOk ? <b>Recipe live</b> : 'No recipe yet'}</span>
            <span>
              Drives <b>{projects.length}</b> post{projects.length === 1 ? '' : 's'}
            </span>
            <span>{isDraft ? <b style={{ color: 'var(--mo-amber)' }}>Draft — review &amp; approve</b> : <b style={{ color: 'var(--mo-green)' }}>Approved</b>}</span>
          </div>
        </div>
        <div className="side">
          <div className="mo-ship" aria-label={`Kit readiness: ${readyPct}%`}>
            <div className="lbl">
              <span>Kit readiness</span>
              <b>{readyPct}%</b>
            </div>
            <div className="mo-pbar">
              <i style={{ width: `${readyPct}%` }} />
            </div>
            <div className="hint">
              {checksLeft > 0 ? (
                <>
                  <b>
                    {checksLeft} thing{checksLeft === 1 ? '' : 's'} left
                  </b>{' '}
                  — then {isDraft ? 'Approve' : 'Save'} lights up
                </>
              ) : (
                <b className="done">All set — {isDraft ? 'approve when ready' : 'every detail in place'}</b>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Check chips: what's confirmed, what still needs a human ── */}
      <div className="mo-checks" aria-label="Kit checks">
        {provenanceChips(kit.provenance).map((chip) => (
          <span className="mo-chk ok" key={chip}>
            <i />
            {chip}
          </span>
        ))}
        {recipeOk ? (
          <span className="mo-chk ok">
            <i />
            Recipe designed
          </span>
        ) : (
          <button
            className="mo-chk warn"
            onClick={() => document.getElementById('kit-recipe')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            <i />
            No recipe yet <span className="go">Design it →</span>
          </button>
        )}
        {!colorsValid && (
          <button className="mo-chk warn" onClick={() => openReceipt('rcpt-palette')}>
            <i />
            A color isn&rsquo;t a valid hex <span className="go">Fix →</span>
          </button>
        )}
        {!logoOk && (
          <button className="mo-chk warn" onClick={() => openReceipt('rcpt-logo')}>
            <i />
            No logo yet <span className="go">Upload →</span>
          </button>
        )}
        {voiceOk ? (
          <span className="mo-chk ok">
            <i />
            Voice written
          </span>
        ) : (
          <button className="mo-chk warn" onClick={() => openReceipt('rcpt-voice')}>
            <i />
            Voice is empty <span className="go">Write it →</span>
          </button>
        )}
      </div>

      {/* ── The recipe — the hero tile ── */}
      <section className="mo-tile" id="kit-recipe" style={{ marginBottom: 14 }}>
        <div className="mo-th">
          <span className="t">The recipe</span>
          <span className="b">drives every slide</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mo-toggle" role="group" aria-label="How many directions to design" style={{ borderRadius: 10 }}>
              {([2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={candCount === n ? 'on' : ''}
                  aria-pressed={candCount === n}
                  onClick={() => setCandCount(n)}
                  disabled={busy !== null}
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >
                  {n}
                </button>
              ))}
            </span>
            <button className="mo-btn sm prim" onClick={authorCandidates} disabled={busy !== null}>
              {busy === 'candidates' ? 'Designing…' : <>✦ Design {candCount} directions</>}
            </button>
            {recipeOk && (
              <button
                className="mo-btn sm"
                onClick={authorRec}
                disabled={busy !== null}
                title="One straight re-author — no choice of directions"
              >
                {busy === 'recipe' ? 'Redesigning…' : 'Redesign'}
              </button>
            )}
          </div>
        </div>

        {busy === 'recipe' || busy === 'candidates' ? (
          <WorkingPanel
            active
            bare
            stages={RECIPE_STAGES}
            title={busy === 'candidates' ? `Designing ${candCount} directions` : 'Designing the recipe'}
            // One ghost per direction, labelled and in the brand's own colours,
            // so the wait shows what is actually being made.
            count={busy === 'candidates' ? candCount : 1}
            notes={busy === 'candidates' ? CANDIDATE_NOTES.slice(0, candCount) : undefined}
            palette={paletteSwatches}
            sub={
              busy === 'candidates'
                ? `Authoring ${candCount} complete design systems in parallel — one faithful, one bolder${candCount === 3 ? ', one quieter' : ''} — so you choose visually. This takes ~40–70s.`
                : "Authoring your brand's design system — palette rationing, a type system, a signature move, imagery and voice. This takes ~40–70s."
            }
          />
        ) : candidates ? (
          <div className="bk-cands">
            <p className="bk-cands-lead">
              {candidates.length === 1
                ? 'One direction came back — a complete design system authored from this kit.'
                : `${candidates.length} directions, each a complete design system authored from this kit.`}{' '}
              The samples below are live renders — pick the one that feels like the brand
              {recipeOk ? ', or keep the current recipe' : ''}.
            </p>
            <div className="bk-cands-row">
              {candidates.map((c) => {
                const [dirName, dirDetail] = c.note.split(/\s+—\s+/);
                const selecting = busy === `select:${c.id}`;
                return (
                  <article key={c.id} className="bk-cand">
                    <div className="bk-cand-slide">
                      <ScaledSlide format="1080x1350" displayWidth={240}>
                        <SlideRenderer
                          slide={previewSlide}
                          brandKit={{ ...renderKit, recipe: c.recipe }}
                          format="1080x1350"
                          forExport
                        />
                      </ScaledSlide>
                    </div>
                    <div className="bk-cand-note">
                      <strong>{dirName || 'Direction'}</strong>
                      {dirDetail && <span>{dirDetail}</span>}
                    </div>
                    <ul className="bk-cand-facts">
                      <li>{c.recipe.signature.name}</li>
                      <li>
                        {c.recipe.tokens.displayFamily}
                        {c.recipe.tokens.accentFamily ? ` · ${c.recipe.tokens.accentFamily}` : ''}
                      </li>
                      {c.recipe.motion?.style && (
                        <li>
                          {c.recipe.motion.style}
                          {c.recipe.motion.pace ? ` · ${c.recipe.motion.pace}` : ''}
                        </li>
                      )}
                    </ul>
                    <button
                      className="mo-btn sm prim"
                      onClick={() => void chooseCandidate(c.id)}
                      disabled={busy !== null}
                    >
                      {selecting ? 'Applying…' : <>✓ Use this direction</>}
                    </button>
                  </article>
                );
              })}
            </div>
            {recipeOk && (
              <div className="bk-cands-dismiss">
                <button className="mo-btn sm" onClick={() => setCandidates(null)} disabled={busy !== null}>
                  Keep the current recipe
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mo-krec">
            <div>
              <div className="samplewrap">
                <span className="live">● live</span>
                <ScaledSlide format="1080x1350" displayWidth={280}>
                  <SlideRenderer slide={previewSlide} brandKit={renderKit} format="1080x1350" forExport />
                </ScaledSlide>
              </div>
            </div>
            <div>
              {recipe ? (
                <>
                  <p className="quote">&ldquo;{recipe.signature.description || recipe.signature.name}&rdquo;</p>
                  <div className="mo-kfact">
                    <span className="l">Palette</span>
                    <span className="v">
                      <span className="sw" style={{ background: recipe.tokens.ground }} />
                      <span className="sw" style={{ background: recipe.tokens.accent }} />
                      {recipe.tokens.ink && <span className="sw" style={{ background: recipe.tokens.ink }} />}
                      {recipe.tokens.accentAlt && <span className="sw" style={{ background: recipe.tokens.accentAlt }} />}
                    </span>
                    <button className="go" onClick={() => openReceipt('rcpt-palette')}>Edit</button>
                  </div>
                  <div className="mo-kfact">
                    <span className="l">Type</span>
                    <span className="v">
                      {recipe.tokens.displayFamily}
                      {recipe.tokens.accentFamily ? ` · ${recipe.tokens.accentFamily}` : ''}
                    </span>
                    <button className="go" onClick={() => openReceipt('rcpt-type')}>Edit</button>
                  </div>
                  <div className="mo-kfact">
                    <span className="l">Signature</span>
                    <span className="v">{recipe.signature.name}</span>
                    <span />
                  </div>
                  <div className="mo-kfact">
                    <span className="l">Imagery</span>
                    <span className="v">{recipe.imagery.treatment || '—'}</span>
                    <span />
                  </div>
                  <div className="mo-kfact">
                    <span className="l">Voice</span>
                    {voiceOk || recipe.voice.description ? (
                      <span className="v">{voice.trim() || recipe.voice.description}</span>
                    ) : (
                      <span className="v warn">Not written yet — the copywriter falls back to a generic register</span>
                    )}
                    <button className="go" onClick={() => openReceipt('rcpt-voice')}>
                      {voiceOk ? 'Edit' : 'Write it'}
                    </button>
                  </div>

                  {/* WHY it chose this — recorded at author time. */}
                  {recipe.rationale && Object.values(recipe.rationale).some(Boolean) && (
                    <details className="bk-why">
                      <summary>Why this design?</summary>
                      <dl>
                        {(['palette', 'type', 'signature', 'motion'] as const).map((k) =>
                          recipe.rationale?.[k] ? (
                            <div key={k}>
                              <dt>{k}</dt>
                              <dd>{recipe.rationale[k]}</dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                    </details>
                  )}

                  {/* Direct knobs — instant, scoped, no 60s re-author for a tweak. */}
                  <div className="bk-knobs">
                    <span className="bk-knobs-lbl">Tune</span>
                    <label>
                      Case
                      <select
                        value={recipe.typography.displayCase}
                        onChange={(e) => saveRecipeKnobs({ displayCase: e.target.value as 'upper' })}
                        disabled={busy !== null}
                      >
                        <option value="upper">Uppercase</option>
                        <option value="title">Title Case</option>
                        <option value="sentence">Sentence case</option>
                      </select>
                    </label>
                    <label>
                      Density
                      <select
                        value={recipe.typography.density}
                        onChange={(e) => saveRecipeKnobs({ density: e.target.value as 'roomy' })}
                        disabled={busy !== null}
                      >
                        <option value="roomy">Roomy</option>
                        <option value="balanced">Balanced</option>
                        <option value="dense">Dense</option>
                      </select>
                    </label>
                    <label>
                      Motion
                      <select
                        value={recipe.motion?.style ?? 'rise'}
                        onChange={(e) => saveRecipeKnobs({ motionStyle: e.target.value as 'rise' })}
                        disabled={busy !== null}
                      >
                        <option value="rise">Rise</option>
                        <option value="fade">Fade</option>
                        <option value="slide">Slide</option>
                        <option value="punch">Punch</option>
                        <option value="pop">Pop</option>
                      </select>
                    </label>
                    <label>
                      Pace
                      <select
                        value={recipe.motion?.pace ?? 'balanced'}
                        onChange={(e) => saveRecipeKnobs({ motionPace: e.target.value as 'calm' })}
                        disabled={busy !== null}
                      >
                        <option value="calm">Calm</option>
                        <option value="balanced">Balanced</option>
                        <option value="punchy">Punchy</option>
                      </select>
                    </label>
                  </div>

                  {/* Refine — a scalpel beside Tune's dials: one layer, one ask. */}
                  <div className="bk-refine">
                    {busy === 'refine' ? (
                      <WorkingPanel
                        active
                        bare
                        stages={REFINE_STAGES}
                        palette={paletteSwatches}
                        title={`Refining the ${refineLayerLabel.toLowerCase()}`}
                        sub="Rewriting this one layer against your note — the rest of the design stays exactly as it is. This takes ~15–40s."
                      />
                    ) : (
                      <>
                        <div className="bk-refine-row">
                          <span className="bk-knobs-lbl">Refine</span>
                          <label>
                            Layer
                            <select
                              value={refineLayer}
                              onChange={(e) => setRefineLayer(e.target.value as RecipeLayer)}
                              disabled={busy !== null}
                            >
                              {REFINE_LAYERS.map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="bk-refine-ask">
                            In your words
                            <input
                              value={refineNote}
                              maxLength={200}
                              placeholder="e.g. the background is too busy — calm it right down"
                              onChange={(e) => setRefineNote(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void refine();
                              }}
                              disabled={busy !== null}
                            />
                          </label>
                          <button
                            className="mo-btn sm"
                            onClick={() => void refine()}
                            disabled={busy !== null || !refineNote.trim()}
                          >
                            Refine
                          </button>
                        </div>
                        <p className="bk-refine-hint">
                          Changes one layer of the design and leaves the rest alone — far quicker, and
                          much safer, than redesigning a recipe you already like.
                        </p>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p style={{ maxWidth: '62ch', color: 'var(--mo-muted)', lineHeight: 1.6, fontSize: 14 }}>
                  The brand&rsquo;s design system. The AI reads this kit and authors a full recipe — palette
                  rationing, a type system, a signature move, imagery treatment, and voice — that{' '}
                  <em>every</em> future post composes against. This is where &ldquo;on-brand&rdquo; stops being a
                  hope and becomes automatic.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Learned preference: repeated slide tweaks, distilled into one quiet,
            dismissible nudge. Applying rides the same knobs PATCH as Tune. */}
        {recipeOk && suggestion && !candidates && busy !== 'recipe' && busy !== 'candidates' && (
          <aside className="bk-suggest" role="status">
            <Icon name="sparkle" size={14} />
            <p className="bk-suggest-msg">{suggestionCopy(suggestion)}</p>
            <div className="row" style={{ gap: 6 }}>
              <button className="mo-btn sm prim" onClick={() => void applySuggestion(suggestion)} disabled={busy !== null}>
                Make it so
              </button>
              <button className="mo-btn sm" onClick={() => void snoozeSuggestion()} disabled={busy !== null}>
                Not now
              </button>
            </div>
          </aside>
        )}

        {/* What a NEWER design prompt would fix about this recipe. */}
        {!candidates && busy !== 'recipe' && busy !== 'candidates' && (
          <PromptUpdates
            status={promptUpdates}
            action={{ label: 'Redesign', onClick: () => void authorRec(), disabled: busy !== null }}
          />
        )}
      </section>

      {/* ── The details, as receipts: confirmed lines that open into editors ── */}
      <div className="mo-krcpts">
        <details className={`mo-rcpt${colorsValid ? '' : ' warn'}`} id="rcpt-palette">
          <summary>
            <span className="ok">{colorsValid ? '✓' : '!'}</span>
            <span>
              <span className="tt">Palette &amp; roles</span>
              <div className="tm">{colorsValid ? '5 roles assigned' : 'A color isn’t a valid hex'}</div>
            </span>
            <span className="sws">
              {ROLES.map(([role]) => (
                <i key={role} style={{ background: HEX.test(colors[role]) ? colors[role] : 'var(--mo-line-strong)' }} />
              ))}
            </span>
            <span className="edit">Edit</span>
          </summary>
          <div className="bodyy">
            <div className="bk-palette" style={{ marginTop: 12 }}>
              {ROLES.map(([role, label]) => {
                const hex = colors[role];
                const valid = HEX.test(hex);
                return (
                  <div key={role} className="bk-color">
                    <label className="bk-color-chip" style={{ background: valid ? hex : '#333' }} title={`Pick ${label}`}>
                      <input
                        type="color"
                        className="native"
                        value={valid ? hex : '#000000'}
                        aria-label={`${label} color`}
                        onChange={(e) => setColor(role, e.target.value.toUpperCase())}
                      />
                    </label>
                    <div className="bk-color-meta">
                      <span className="bk-color-role">{label}</span>
                      <input
                        className="bk-color-hex"
                        value={hex}
                        aria-invalid={!valid}
                        aria-label={`${label} hex`}
                        onChange={(e) => setColor(role, e.target.value.toUpperCase())}
                        style={valid ? undefined : { borderColor: 'var(--mo-red)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {!colorsValid && (
              <p style={{ fontSize: 12, color: 'var(--mo-red)', marginTop: 8 }}>
                Enter valid hex colors (e.g. #0B1F3A) to save.
              </p>
            )}
            {kit.colors.palette?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <span style={{ fontSize: 12, color: 'var(--mo-faint)' }}>Sampled from the site — click to copy:</span>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {kit.colors.palette.map((hex) => (
                    <span
                      key={hex}
                      className="chip"
                      style={{ background: hex }}
                      title={hex}
                      onClick={() => navigator.clipboard?.writeText(hex)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>

        <details className="mo-rcpt" id="rcpt-type">
          <summary>
            <span className="ok">✓</span>
            <span>
              <span className="tt">Typography</span>
              <div className="tm">
                {heading} + {body}
                {kit.fonts.detected?.heading ? ` · site uses ${cleanFontName(kit.fonts.detected.heading)}` : ''}
              </div>
            </span>
            <span className="edit">Edit</span>
          </summary>
          <div className="bodyy">
            <div className="bk-type" style={{ marginTop: 12 }}>
              <div className="bk-spec">
                <div className="role">
                  Heading{kit.fonts.detected?.heading ? ` · site: ${cleanFontName(kit.fonts.detected.heading)}` : ''}
                </div>
                <div className="aa" style={{ fontFamily: `'${heading}', var(--display)` }}>Aa</div>
                <div className="pan" style={{ fontFamily: `'${heading}', var(--display)` }}>The quick brown fox.</div>
                <FontSelect label="Heading font" value={heading} detected={kit.fonts.detected?.heading} onChange={setHeading} />
              </div>
              <div className="bk-spec">
                <div className="role">Body{kit.fonts.detected?.body ? ` · site: ${cleanFontName(kit.fonts.detected.body)}` : ''}</div>
                <div className="aa" style={{ fontFamily: `'${body}', var(--body)`, fontSize: 46 }}>Aa</div>
                <div className="pan" style={{ fontFamily: `'${body}', var(--body)` }}>Body copy flows here, calm and legible.</div>
                <FontSelect label="Body font" value={body} detected={kit.fonts.detected?.body} onChange={setBody} />
              </div>
            </div>
          </div>
        </details>

        <details className={`mo-rcpt${logoOk ? '' : ' warn'}`} id="rcpt-logo">
          <summary>
            <span className="ok">{logoOk ? '✓' : '!'}</span>
            <span>
              <span className="tt">Logo</span>
              <div className="tm">
                {logoOk
                  ? `${logoTreatment === 'mono' ? 'Mono treatment' : 'Original'}${kit.provenance?.logo === 'dom' ? ' · found on the site' : ''}`
                  : 'No logo yet — slides render without one'}
              </div>
            </span>
            <span className="edit">{logoOk ? 'Edit' : 'Upload'}</span>
          </summary>
          <div className="bodyy">
            <div className="bk-logo-stage" style={{ background: colors.background, marginTop: 12 }}>
              {logo?.url ? (
                <img src={logo.url} alt="" />
              ) : (
                <span style={{ color: readable(colors.background), opacity: 0.6, fontSize: 13 }}>No logo yet</span>
              )}
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="mo-btn sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                {busy === 'logo' ? 'Uploading…' : logo ? 'Replace' : 'Upload'}
              </button>
              {logo && (
                <button className="mo-btn sm" onClick={() => setLogo(undefined)}>Remove</button>
              )}
              {logo?.url && (
                <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  {(['original', 'mono'] as const).map((t) => (
                    <button
                      key={t}
                      className={`mo-btn sm${logoTreatment === t ? ' prim' : ''}`}
                      onClick={() => setLogoTreatment(t)}
                      title={t === 'mono' ? 'Knock the logo out to a single contrasting color' : 'Use the logo as-is'}
                    >
                      {t === 'original' ? 'Original' : 'Mono'}
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => onUploadLogo(e.target.files?.[0])}
              />
            </div>
          </div>
        </details>

        <details className={`mo-rcpt${voiceOk ? '' : ' warn'}`} id="rcpt-voice">
          <summary>
            <span className="ok">{voiceOk ? '✓' : '!'}</span>
            <span>
              <span className="tt">Voice &amp; style</span>
              <div className="tm">
                {voiceOk ? `“${voice.trim().slice(0, 56)}${voice.trim().length > 56 ? '…' : ''}”` : 'Empty — the copywriter deserves better'}
              </div>
            </span>
            <span className="edit">{voiceOk ? 'Edit' : 'Write it'}</span>
          </summary>
          <div className="bodyy">
            <div className="section-label" style={{ marginTop: 12 }}>Style descriptor</div>
            <input
              value={styleDescriptor}
              placeholder="e.g. minimal, high-contrast, generous whitespace"
              onChange={(e) => setStyleDescriptor(e.target.value)}
              style={{ width: '100%' }}
            />
            <div className="section-label" style={{ marginTop: 12 }}>Brand voice</div>
            <textarea
              value={voice}
              rows={3}
              placeholder="How the brand talks — confident, plain-spoken; addresses operators directly; avoids hype"
              onChange={(e) => setVoice(e.target.value)}
              style={{ width: '100%' }}
            />
            <p style={{ fontSize: 12, color: 'var(--mo-faint)', marginTop: 6 }}>
              Grounds the recipe&rsquo;s voice and the captions in the brand&rsquo;s own register.
            </p>
          </div>
        </details>

        {kit.homepageScreenshot?.url && (
          <details className="mo-rcpt" id="rcpt-evidence" style={{ gridColumn: '1 / -1' }}>
            <summary>
              <span className="ok">✓</span>
              <span>
                <span className="tt">Source evidence</span>
                <div className="tm">The site the kit was read from</div>
              </span>
              <span className="edit">View</span>
            </summary>
            <div className="bodyy">
              <img className="shot" src={kit.homepageScreenshot.url} alt="homepage" style={{ marginTop: 12 }} />
            </div>
          </details>
        )}
      </div>

      {/* ── Approve — the forecast: consequences you can see, then the button ── */}
      <section className="mo-tile mo-kfc" aria-label="Approve">
        <div className="mo-th">
          <span className="t">{isDraft ? 'Approve — what changes' : 'Save — what changes'}</span>
          {kitDiff && <span className="b">now → after save</span>}
        </div>
        {kitDiff ? (
          <>
            <p className="note">
              Your unsaved edits ({kitDiff.changed.filter((c) => !c.startsWith('repaired ')).join(' · ') || 'recipe tokens'})
              re-render <b>every one of {businessName}&rsquo;s {projects.length} post{projects.length === 1 ? '' : 's'}</b>.
              {recentPosts.length > 0 ? ' The sample, and your most recent posts, as they would look:' : ''}
            </p>
            <div className="grid">
              <div className="cell">
                <div className="art">
                  <ScaledSlide format="1080x1350" displayWidth={150}>
                    <SlideRenderer slide={previewSlide} brandKit={savedRenderKit} format="1080x1350" forExport />
                  </ScaledSlide>
                </div>
                <div className="cap">Now</div>
              </div>
              <span className="pairarrow" aria-hidden>→</span>
              <div className="cell">
                <div className="art">
                  <ScaledSlide format="1080x1350" displayWidth={150}>
                    <SlideRenderer slide={previewSlide} brandKit={forecastKit} format="1080x1350" forExport />
                  </ScaledSlide>
                </div>
                <div className="cap">After save</div>
              </div>
              {recentPosts.map(({ project, first }) => (
                <div className="cell" key={project._id}>
                  <div className="art">
                    <ScaledSlide format={project.format} displayWidth={150}>
                      <SlideRenderer slide={first!} brandKit={forecastKit} format={project.format} forExport />
                    </ScaledSlide>
                  </div>
                  <div className="cap">{project.title}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="note">
              {isDraft
                ? `Approving makes this kit the one every new ${businessName} post composes against${hasApproved ? ' — it replaces the current approved kit' : ''}.`
                : 'No unsaved edits — the kit below is exactly what every post composes against.'}
              {recentPosts.length > 0 ? ' Your most recent posts, under this kit:' : ''}
            </p>
            {recentPosts.length > 0 && (
              <div className="grid">
                {recentPosts.map(({ project, first }) => (
                  <div className="cell" key={project._id}>
                    <div className="art">
                      <ScaledSlide format={project.format} displayWidth={150}>
                        <SlideRenderer slide={first!} brandKit={forecastKit} format={project.format} forExport />
                      </ScaledSlide>
                    </div>
                    <div className="cap">{project.title}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {busy === 'analyze' && (
          <WorkingPanel
            active
            bare
            stages={REANALYZE_STAGES}
            palette={paletteSwatches}
            title="Re-reading your brand"
            sub="Your approved kit stays exactly as it is — this arrives as a draft you can compare and approve. ~20–40s."
          />
        )}

        <div className="acts">
          <button className="mo-btn-compose" onClick={() => save(true)} disabled={busy !== null || !colorsValid}>
            {busy === 'save' ? 'Saving…' : isDraft ? '✓ Approve the kit' : 'Save changes'}
          </button>
          {isDraft && (
            <button className="mo-btn" onClick={() => save(false)} disabled={busy !== null || !colorsValid}>
              Save draft
            </button>
          )}
          {onReanalyze && (
            <button className="mo-btn sm" onClick={onReanalyze} disabled={busy !== null}>
              Re-analyze website
            </button>
          )}
          <button className="mo-btn sm" onClick={onManual} disabled={busy !== null}>
            Start fresh
          </button>
          <span className="prov">
            {hasApproved && isDraft ? 'Approving replaces the current kit. ' : ''}
            {provenanceChips(kit.provenance).join(' · ')}
          </span>
        </div>
      </section>
    </>
  );
}
