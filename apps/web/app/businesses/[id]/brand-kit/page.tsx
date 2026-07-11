'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { BrandKit, MediaAsset } from '@contentbuilder/shared';
import { BUNDLED_FONT_FAMILIES } from '@contentbuilder/shared';
import {
  getBrandKit,
  getBusiness,
  analyzeBusiness,
  createManualKit,
  patchBrandKit,
  uploadMedia,
  listMedia,
  regenerateBackgrounds,
  generateAiBackground,
  deleteMedia,
  type BusinessDetail,
} from '../../../lib/api';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import type { RenderBrandKit } from '../../../../lib/render/types';
import { confirm } from '../../../components/ConfirmDialog';
import { useStagedProgress, ANALYZE_STAGES } from '../../../components/useStagedProgress';

type ColorRoleKey = 'primary' | 'secondary' | 'accent' | 'background' | 'text';
const ROLES: Array<[ColorRoleKey, string]> = [
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['accent', 'Accent'],
  ['background', 'Background'],
  ['text', 'Text'],
];

export default function BrandKitPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [hasApproved, setHasApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const analyzeLabel = useStagedProgress(busy === 'analyze', ANALYZE_STAGES);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [biz, state] = await Promise.all([getBusiness(id), getBrandKit(id)]);
      setBusiness(biz);
      setKit(state.draft ?? state.approved);
      setHasApproved(Boolean(state.approved));
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
    setError(null);
    try {
      const draft = await analyzeBusiness(id);
      setKit(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    setError(null);
    try {
      const draft = await createManualKit(id);
      setKit(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="muted" style={{ marginBottom: 6 }}>
        <Link href={`/businesses/${id}`}>← Back to business</Link>
      </p>
      <h1>Brand kit{business ? ` — ${business.name}` : ''}</h1>

      {error && <div className="error-box">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && !kit && (
        <div className="card" style={{ maxWidth: 640 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Derive a brand kit from the website, or enter one manually (common for businesses that
            live only on Instagram). The extracted kit is always a draft until you approve it.
          </p>
          <div className="row">
            <button
              className="btn primary"
              onClick={analyze}
              disabled={!business?.websiteUrl || !business?.hasProfile || busy !== null}
              title={
                !business?.hasProfile
                  ? 'Complete the business profile first'
                  : business?.websiteUrl
                    ? business.websiteUrl
                    : 'No website on file'
              }
            >
              {busy === 'analyze' ? analyzeLabel ?? 'Analyzing…' : 'Analyze website'}
            </button>
            <button className="btn" onClick={startManual} disabled={busy !== null}>
              {busy === 'manual' ? 'Creating…' : 'Skip extraction / enter manually'}
            </button>
          </div>
          {business && !business.hasProfile && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              AI extraction is locked until you{' '}
              <Link href={`/businesses/${id}`}>complete this business&apos;s profile</Link>. You can still
              enter the kit manually now.
            </p>
          )}
          {!business?.websiteUrl && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              This business has no website URL — use manual entry, or add a URL on the business page.
            </p>
          )}
          {busy === 'analyze' && (
            <p className="muted" style={{ fontSize: 13 }}>
              Loading the site, sampling colors &amp; fonts, fetching the logo, and asking the vision
              model to assign color roles… this can take ~20–40s.
            </p>
          )}
        </div>
      )}

      {!loading && kit && (
        <KitEditor
          key={kit._id}
          businessId={id}
          businessName={business?.name ?? 'Your brand'}
          kit={kit}
          hasApproved={hasApproved}
          onReanalyze={business?.websiteUrl ? analyze : undefined}
          onManual={startManual}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
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
  if (p.colors === 'computed') chips.push('Colors read from the site\u2019s real styles');
  else if (p.colors === 'sampled') chips.push('Colors sampled from a screenshot');
  else if (p.colors === 'manual') chips.push('Colors entered manually');
  if (p.fonts === 'site:google-fonts') chips.push('Real site fonts, served via Google Fonts');
  else if (typeof p.fonts === 'string' && p.fonts.startsWith('personality:')) {
    chips.push(`Fonts matched to the headline\u2019s style (${p.fonts.split(':')[1]?.replace(/-/g, ' ')})`);
  } else if (p.fonts === 'computed+mapped') chips.push('Fonts name-matched from the site');
  else if (p.fonts === 'manual') chips.push('Fonts chosen manually');
  if (p.logo === 'dom') chips.push('Logo found on the site');
  else if (p.logo === 'none') chips.push('No logo found \u2014 upload one');
  return chips;
}

/** Strip Next.js's internal font tokens ("__Playfair_Display_eea437" \u2192 "Playfair Display"). */
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
  kit,
  hasApproved,
  onReanalyze,
  onManual,
  busy,
  setBusy,
  setError,
  onApproved,
}: {
  businessId: string;
  businessName: string;
  kit: BrandKit;
  hasApproved: boolean;
  onReanalyze?: () => void;
  onManual: () => void;
  busy: string | null;
  setBusy: (s: string | null) => void;
  setError: (s: string | null) => void;
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
  const fileRef = useRef<HTMLInputElement>(null);

  const setColor = (role: keyof BrandKit['colors'], value: string) =>
    setColors((c) => ({ ...c, [role]: value }));

  const renderKit: RenderBrandKit = {
    colors,
    fonts: { render: { heading, body } },
    logo: logo?.url ? { url: logo.url } : undefined,
    logoTreatment,
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
    setError(null);
    try {
      await patchBrandKit(kit._id, {
        colors,
        fonts: { render: { heading, body } },
        ...(logo ? { logo } : {}),
        logoTreatment,
        styleDescriptor,
        voice,
        status: approve ? 'approved' : 'draft',
      });
      if (approve) onApproved();
      else setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const isDraft = kit.status === 'draft';

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className={`badge ${isDraft ? 'warn' : 'ok'}`}>
          <span className="dot" /> {isDraft ? 'Draft — review & approve' : 'Approved'}
        </span>
        <span className="prov">
          {provenanceChips(kit.provenance).map((chip) => (
            <span key={chip} className="badge">
              {chip}
            </span>
          ))}
        </span>
      </div>

      <div className="kit-cols">
        {/* Left: screenshot + live preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {kit.homepageScreenshot?.url && (
            <div>
              <div className="section-label" style={{ marginTop: 0 }}>
                Homepage
              </div>
              <img className="shot" src={kit.homepageScreenshot.url} alt="homepage screenshot" />
            </div>
          )}
          <div>
            <div className="section-label">Live preview</div>
            <ScaledSlide format="1080x1080" displayWidth={288}>
              <SlideRenderer
                slide={{
                  layoutType: 'Cover',
                  blocks: [
                    { type: 'eyebrow', text: 'BRAND PREVIEW' },
                    { type: 'title', text: businessName },
                    { type: 'subtitle', text: 'On-brand in seconds' },
                  ],
                }}
                brandKit={renderKit}
                format="1080x1080"
                image={null}
              />
            </ScaledSlide>
          </div>
        </div>

        {/* Right: editable fields */}
        <div className="panel">
          <div className="section-label" style={{ marginTop: 0 }}>
            Colors &amp; roles
          </div>
          {ROLES.map(([role, label]) => (
            <div className="swatch-row" key={role}>
              <span className="role">{label}</span>
              <input
                type="color"
                value={colors[role]}
                onChange={(e) => setColor(role, e.target.value.toUpperCase())}
              />
              <input
                type="text"
                value={colors[role]}
                aria-invalid={!HEX.test(colors[role])}
                aria-label={`${label} hex color`}
                onChange={(e) => setColor(role, e.target.value.toUpperCase())}
                style={HEX.test(colors[role]) ? undefined : { borderColor: 'var(--danger)' }}
              />
            </div>
          ))}
          {!colorsValid && (
            <p className="muted" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
              Enter valid hex colors (e.g. #0B1F3A) to save.
            </p>
          )}
          {kit.colors.palette?.length > 0 && (
            <>
              <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
                Sampled palette (click to copy a hex into focus, or use the pickers above):
              </p>
              <div className="row" style={{ gap: 6 }}>
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
            </>
          )}

          <div className="section-label">Fonts</div>
          <div className="grid-2">
            <FontSelect
              label="Heading"
              value={heading}
              detected={kit.fonts.detected?.heading}
              onChange={setHeading}
            />
            <FontSelect
              label="Body"
              value={body}
              detected={kit.fonts.detected?.body}
              onChange={setBody}
            />
          </div>

          <div className="section-label">Logo</div>
          <div className="row">
            {logo?.url ? (
              <img
                src={logo.url}
                alt="logo"
                style={{ height: 44, maxWidth: 160, objectFit: 'contain', background: '#222', borderRadius: 8, padding: 4 }}
              />
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>
                No logo
              </span>
            )}
            <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              {busy === 'logo' ? 'Uploading…' : logo ? 'Replace' : 'Upload logo'}
            </button>
            {logo && (
              <button className="btn ghost sm" onClick={() => setLogo(undefined)}>
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              style={{ display: 'none' }}
              onChange={(e) => onUploadLogo(e.target.files?.[0])}
            />
          </div>
          {logo?.url && (
            <div className="row" style={{ gap: 4, marginTop: 8 }}>
              {(['original', 'mono'] as const).map((t) => (
                <button
                  key={t}
                  className={`btn sm ${logoTreatment === t ? 'primary' : 'ghost'}`}
                  onClick={() => setLogoTreatment(t)}
                  title={t === 'mono' ? 'Knock the logo out to a single color that contrasts each slide' : 'Use the logo as-is'}
                >
                  {t === 'original' ? 'Original' : 'Monochrome'}
                </button>
              ))}
            </div>
          )}

          <div className="section-label">Style descriptor</div>
          <input
            value={styleDescriptor}
            placeholder="e.g. minimal, high-contrast, generous whitespace"
            onChange={(e) => setStyleDescriptor(e.target.value)}
          />

          <div className="section-label">Brand voice</div>
          <textarea
            value={voice}
            rows={2}
            placeholder="How the brand talks — e.g. confident, plain-spoken; addresses operators directly; avoids hype"
            onChange={(e) => setVoice(e.target.value)}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Used to write captions in the brand&rsquo;s own register.
          </p>
        </div>
      </div>

      <BrandBackgrounds businessId={businessId} colors={colors} colorsValid={colorsValid} setError={setError} styleDescriptor={styleDescriptor} businessName={businessName} />

      {/* Actions */}
      <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
        <div className="row">
          <button className="btn primary" onClick={() => save(true)} disabled={busy !== null || !colorsValid}>
            {busy === 'save' ? 'Saving…' : isDraft ? 'Approve brand kit' : 'Save changes'}
          </button>
          {isDraft && (
            <button className="btn" onClick={() => save(false)} disabled={busy !== null || !colorsValid}>
              Save draft
            </button>
          )}
        </div>
        <div className="row">
          {onReanalyze && (
            <button className="btn ghost sm" onClick={onReanalyze} disabled={busy !== null}>
              Re-analyze website
            </button>
          )}
          <button className="btn ghost sm" onClick={onManual} disabled={busy !== null}>
            Start fresh (manual)
          </button>
        </div>
      </div>
      {hasApproved && isDraft && (
        <p className="muted" style={{ fontSize: 13 }}>
          This business already has an approved kit; approving this draft replaces it as the current kit.
        </p>
      )}
    </>
  );
}

/** Shows the 3 procedural brand backgrounds + a regenerate-from-palette button. */
function BrandBackgrounds({
  businessId,
  colors,
  colorsValid,
  setError,
  styleDescriptor,
  businessName,
}: {
  businessId: string;
  colors: BrandKit['colors'];
  colorsValid: boolean;
  setError: (s: string | null) => void;
  styleDescriptor: string;
  businessName: string;
}) {
  const [bgs, setBgs] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [count, setCount] = useState(3);

  const load = useCallback(async () => {
    try {
      const m = await listMedia(businessId);
      setBgs(m.filter((x) => x.type === 'generated'));
    } catch {
      /* non-fatal */
    }
  }, [businessId]);
  useEffect(() => {
    void load();
  }, [load]);

  const regen = async () => {
    setBusy(true);
    setError(null);
    try {
      // Regenerate replaces the procedural set; keep any AI backgrounds around.
      const ai = bgs.filter((b) => b.label === 'AI background');
      const fresh = await regenerateBackgrounds(businessId, colors, count);
      setBgs([...fresh, ...ai]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addAi = async () => {
    setAiBusy(true);
    setError(null);
    try {
      const asset = await generateAiBackground(businessId, colors, { styleDescriptor, businessName });
      setBgs((prev) => [asset, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const remove = async (assetId: string) => {
    setBgs((prev) => prev.filter((b) => b._id !== assetId)); // optimistic
    try {
      await deleteMedia(businessId, assetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void load(); // resync on failure
    }
  };

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="section-label" style={{ marginTop: 0 }}>
        Background graphics
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Subtle backgrounds themed to your business, unique to you, and generated from your palette — drop them behind any
        post or story for depth. They appear under &ldquo;Brand backgrounds&rdquo; in the editor&apos;s image picker.
      </p>
      {bgs.length > 0 ? (
        <div className="row" style={{ gap: 12 }}>
          {bgs.map((b) => (
            <div key={b._id} style={{ textAlign: 'center', position: 'relative' }}>
              <img
                src={b.url}
                alt={b.label ?? 'brand background'}
                style={{ width: 100, height: 125, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }}
              />
              <button
                className="icon-btn danger"
                onClick={() => remove(b._id)}
                title="Remove this background"
                aria-label={`Remove ${(b.label ?? 'background').replace('Brand background — ', '')} background`}
                style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, background: 'rgba(0,0,0,0.55)' }}
              >
                ✕
              </button>
              <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>
                {(b.label ?? '').replace('Brand background — ', '')}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>
          None yet — approve the kit, or generate them now.
        </p>
      )}
      <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          How many
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={busy}
            style={{ padding: '4px 6px', borderRadius: 6, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }}
          >
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <button className="btn sm" onClick={regen} disabled={busy || !colorsValid} title={!colorsValid ? 'Fix the colors first' : undefined}>
          {busy ? 'Generating…' : bgs.some((b) => b.label !== 'AI background') ? 'Regenerate from palette' : 'Generate backgrounds'}
        </button>
        <button
          className="btn sm ghost"
          onClick={addAi}
          disabled={aiBusy || !colorsValid}
          title={!colorsValid ? 'Fix the colors first' : 'Generate one AI background (SVG)'}
        >
          {aiBusy ? 'Generating…' : '✨ AI background'}
        </button>
      </div>
    </div>
  );
}
