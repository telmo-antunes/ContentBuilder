'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { BrandKit, BrandRecipe, MediaAsset } from '@contentbuilder/shared';
import { BUNDLED_FONT_FAMILIES, contrastRatio } from '@contentbuilder/shared';
import {
  getBrandKit,
  getBusiness,
  analyzeBusiness,
  createManualKit,
  patchBrandKit,
  uploadMedia,
  authorBrandRecipe,
  type BusinessDetail,
} from '../../../lib/api';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import type { RenderBrandKit } from '../../../../lib/render/types';
import { confirm } from '../../../components/ConfirmDialog';
import { toast } from '../../../components/Toast';
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
        <Link href={`/businesses/${id}`}>← Back to brand</Link>
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
                  ? 'Complete the brand profile first'
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
              <Link href={`/businesses/${id}`}>complete this brand&apos;s profile</Link>. You can still
              enter the kit manually now.
            </p>
          )}
          {!business?.websiteUrl && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              This brand has no website URL — use manual entry, or add a URL on the brand page.
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
  const [recipe, setRecipe] = useState<BrandRecipe | undefined>((kit as { recipe?: BrandRecipe }).recipe);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reveal sections as they scroll into view (motion the eye follows down the page).
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        }),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('.bk-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

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
      if (approve) {
        toast('Brand kit approved — backgrounds & compositions are being designed');
        onApproved();
      } else {
        toast('Brand kit saved');
        setBusy(null);
      }
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

  const readable = (hex: string): string => {
    if (!HEX.test(hex)) return '#ffffff';
    try {
      return contrastRatio(hex, '#111111') >= contrastRatio(hex, '#ffffff') ? '#111111' : '#ffffff';
    } catch {
      return '#ffffff';
    }
  };
  const onHeroMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', String((e.clientX - r.left) / r.width - 0.5));
    el.style.setProperty('--my', String((e.clientY - r.top) / r.height - 0.5));
  };
  const onHeroLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty('--mx', '0');
    e.currentTarget.style.setProperty('--my', '0');
  };
  const authorRec = async () => {
    setBusy('recipe');
    setError(null);
    try {
      const res = await authorBrandRecipe(kit._id);
      setRecipe((res as { recipe?: BrandRecipe }).recipe);
      toast('Brand recipe designed — new posts compose against it');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Recipe-authored sample: the same semantic markup a composed slide uses, so
  // the preview renders through the real recipe (not a legacy block layout).
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
  const textOnBrand = readable(colors.background);
  const tint = (a: string) => (HEX.test(colors.text) ? colors.text + a : `rgba(20,18,14,${parseInt(a, 16) / 255})`);

  return (
    <>
      {/* ── The brand, alive: a hero rendered in the brand's OWN colors ── */}
      <section
        className="bk-hero bk-rise"
        style={{ background: colors.background, color: textOnBrand }}
        onMouseMove={onHeroMove}
        onMouseLeave={onHeroLeave}
      >
        <span className="bk-blob a" style={{ background: colors.primary }} />
        <span className="bk-blob b" style={{ background: colors.accent }} />
        <span className="bk-blob c" style={{ background: colors.secondary }} />
        <span className="bk-sheen" />
        <span className="bk-hero-grain" />
        <span className="bk-hero-wm" style={{ color: textOnBrand }} aria-hidden>
          {businessName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="bk-accent-line" style={{ color: colors.accent }} />
        <span className="bk-vignette" />
        <div className="bk-hero-inner">
          <div className="bk-hero-id">
            {logo?.url && <img className="bk-hero-logo" src={logo.url} alt="" />}
            <div className="bk-hero-eyebrow" style={{ color: colors.accent }}>
              Brand kit · the design system
            </div>
            <h1 className="bk-hero-name2">
              {businessName.split(' ').map((word, i) => (
                <span key={`${word}-${i}`} className="bk-word" style={{ animationDelay: `${0.18 + i * 0.1}s` }}>
                  {word}
                  {i < businessName.split(' ').length - 1 ? ' ' : ''}
                </span>
              ))}
            </h1>
            <div className="bk-hero-meta">
              <span
                className="bk-hero-pill"
                style={{ background: tint('22'), color: textOnBrand, border: `1px solid ${tint('33')}` }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: isDraft ? '#e0a23a' : colors.accent }} />
                {isDraft ? 'Draft — review & approve' : 'Approved'}
              </span>
              {provenanceChips(kit.provenance)
                .slice(0, 2)
                .map((chip) => (
                  <span
                    key={chip}
                    className="bk-hero-pill"
                    style={{ background: tint('14'), color: textOnBrand, border: `1px solid ${tint('22')}`, opacity: 0.9 }}
                  >
                    {chip}
                  </span>
                ))}
            </div>
          </div>
          <div className="bk-hero-sample">
            <div className="tilt">
              <ScaledSlide format="1080x1350" displayWidth={210}>
                <SlideRenderer slide={previewSlide} brandKit={renderKit} format="1080x1350" forExport />
              </ScaledSlide>
            </div>
          </div>
        </div>
      </section>

      {/* ── The recipe — the centrepiece ── */}
      <section className="bk-sec bk-reveal" style={{ animationDelay: '0.05s' }}>
        <div className={`bk-recipe${busy === 'recipe' ? ' bk-shimmer' : ''}`}>
          <div className="bk-recipe-top">
            <span className="lbl">The recipe</span>
            {recipe ? (
              <span className="badge ok"><span className="dot" /> live</span>
            ) : (
              <span className="badge">not designed yet</span>
            )}
            <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={authorRec} disabled={busy !== null}>
              {busy === 'recipe' ? 'Designing…' : recipe ? 'Re-design ✦' : 'Design the recipe ✦'}
            </button>
          </div>
          {recipe ? (
            <>
              <p className="bk-recipe-quote">
                &ldquo;{recipe.signature.description || recipe.signature.name}&rdquo;
              </p>
              <div className="bk-recipe-grid">
                <div>
                  <div className="k">Palette</div>
                  <div className="v">
                    <span className="bk-bigsw" style={{ background: recipe.tokens.ground }} />
                    <span className="bk-bigsw" style={{ background: recipe.tokens.accent }} />
                    {recipe.tokens.ink && <span className="bk-bigsw" style={{ background: recipe.tokens.ink }} />}
                    {recipe.tokens.accentAlt && <span className="bk-bigsw" style={{ background: recipe.tokens.accentAlt }} />}
                  </div>
                </div>
                <div>
                  <div className="k">Type</div>
                  <div className="v">
                    {recipe.tokens.displayFamily}
                    {recipe.tokens.accentFamily ? ` · ${recipe.tokens.accentFamily}` : ''}
                  </div>
                </div>
                <div>
                  <div className="k">Signature</div>
                  <div className="v">{recipe.signature.name}</div>
                </div>
                <div>
                  <div className="k">Imagery</div>
                  <div className="v">{recipe.imagery.treatment || '—'}</div>
                </div>
                <div>
                  <div className="k">Voice</div>
                  <div className="v">{recipe.voice.description || '—'}</div>
                </div>
              </div>
            </>
          ) : (
            <p className="v" style={{ marginTop: 14, maxWidth: '62ch', color: 'var(--muted)', lineHeight: 1.6 }}>
              The brand&rsquo;s design system. The AI reads this kit and authors a full recipe — palette rationing, a
              type system, a signature move, imagery treatment, and voice — that <em>every</em> future post composes
              against. This is where &ldquo;on-brand&rdquo; stops being a hope and becomes automatic.
            </p>
          )}
        </div>
      </section>

      {/* ── The atelier: living controls ── */}
      <div className="bk-cols">
        <div>
          <section className="bk-sec bk-reveal" style={{ animationDelay: '0.1s' }}>
            <div className="bk-sec-h">
              <span className="n">01</span>
              <h2>Palette &amp; roles</h2>
              <span className="aside">click a chip to recolor</span>
            </div>
            <div className="bk-swatches">
              {ROLES.map(([role, label]) => {
                const hex = colors[role];
                const fg = readable(hex);
                return (
                  <label key={role} className="bk-swatch" style={{ background: HEX.test(hex) ? hex : '#333', color: fg }}>
                    <input
                      type="color"
                      className="native"
                      value={HEX.test(hex) ? hex : '#000000'}
                      aria-label={`${label} color`}
                      onChange={(e) => setColor(role, e.target.value.toUpperCase())}
                    />
                    <span className="edit-dot" style={{ border: `1px solid ${fg}`, color: fg }}>✎</span>
                    <span className="role">{label}</span>
                    <span className="hex">{hex}</span>
                  </label>
                );
              })}
            </div>
            <div className="bk-hexrow" style={{ flexWrap: 'wrap', gap: 14, marginTop: 16 }}>
              {ROLES.map(([role, label]) => (
                <div key={role} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
                  <input
                    value={colors[role]}
                    aria-invalid={!HEX.test(colors[role])}
                    aria-label={`${label} hex`}
                    onChange={(e) => setColor(role, e.target.value.toUpperCase())}
                    style={{ width: 108, fontFamily: 'ui-monospace, monospace', fontSize: 13, ...(HEX.test(colors[role]) ? {} : { borderColor: 'var(--danger)' }) }}
                  />
                </div>
              ))}
            </div>
            {!colorsValid && (
              <p className="muted" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
                Enter valid hex colors (e.g. #0B1F3A) to save.
              </p>
            )}
            {kit.colors.palette?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <span className="muted" style={{ fontSize: 12 }}>Sampled from the site — click to copy:</span>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {kit.colors.palette.map((hex) => (
                    <span key={hex} className="chip" style={{ background: hex }} title={hex} onClick={() => navigator.clipboard?.writeText(hex)} />
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="bk-sec bk-reveal" style={{ animationDelay: '0.14s' }}>
            <div className="bk-sec-h">
              <span className="n">02</span>
              <h2>Typography</h2>
              <span className="aside">specimens in the brand fonts</span>
            </div>
            <div className="bk-type">
              <div className="bk-spec">
                <div className="role">Heading{kit.fonts.detected?.heading ? ` · site: ${cleanFontName(kit.fonts.detected.heading)}` : ''}</div>
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
          </section>

          {kit.homepageScreenshot?.url && (
            <section className="bk-sec bk-reveal" style={{ animationDelay: '0.18s' }}>
              <div className="bk-sec-h">
                <span className="n">03</span>
                <h2>Source evidence</h2>
                <span className="aside">the site the kit was read from</span>
              </div>
              <img className="shot" src={kit.homepageScreenshot.url} alt="homepage" style={{ borderRadius: 14, width: '100%' }} />
            </section>
          )}
        </div>

        {/* right rail: sticky preview + logo + voice */}
        <div className="bk-sticky">
          <section className="bk-reveal" style={{ animationDelay: '0.12s' }}>
            <div className="section-label" style={{ marginTop: 0 }}>Live preview</div>
            <ScaledSlide format="1080x1350" displayWidth={288}>
              <SlideRenderer slide={previewSlide} brandKit={renderKit} format="1080x1350" forExport />
            </ScaledSlide>
          </section>

          <section className="bk-reveal" style={{ animationDelay: '0.16s', marginTop: 20 }}>
            <div className="section-label">Logo</div>
            <div className="bk-logo-stage" style={{ background: colors.background }}>
              {logo?.url ? <img src={logo.url} alt="" /> : <span style={{ color: textOnBrand, opacity: 0.6, fontSize: 13 }}>No logo yet</span>}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                {busy === 'logo' ? 'Uploading…' : logo ? 'Replace' : 'Upload'}
              </button>
              {logo && (
                <button className="btn ghost sm" onClick={() => setLogo(undefined)}>Remove</button>
              )}
              {logo?.url && (
                <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  {(['original', 'mono'] as const).map((t) => (
                    <button
                      key={t}
                      className={`btn sm ${logoTreatment === t ? 'primary' : 'ghost'}`}
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
          </section>

          <section className="bk-reveal" style={{ animationDelay: '0.2s', marginTop: 20 }}>
            <div className="section-label">Style descriptor</div>
            <input
              value={styleDescriptor}
              placeholder="e.g. minimal, high-contrast, generous whitespace"
              onChange={(e) => setStyleDescriptor(e.target.value)}
            />
            <div className="section-label">Brand voice</div>
            <textarea
              value={voice}
              rows={3}
              placeholder="How the brand talks — confident, plain-spoken; addresses operators directly; avoids hype"
              onChange={(e) => setVoice(e.target.value)}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Grounds the recipe&rsquo;s voice and the captions in the brand&rsquo;s own register.
            </p>
          </section>
        </div>
      </div>

      {/* actions — sticky at the foot */}
      <div className="bk-actions">
        <div className="row">
          <button className="btn primary" onClick={() => save(true)} disabled={busy !== null || !colorsValid}>
            {busy === 'save' ? 'Saving…' : isDraft ? 'Approve brand kit' : 'Save changes'}
          </button>
          {isDraft && (
            <button className="btn" onClick={() => save(false)} disabled={busy !== null || !colorsValid}>
              Save draft
            </button>
          )}
          {hasApproved && isDraft && (
            <span className="muted" style={{ fontSize: 12 }}>Approving replaces the current kit.</span>
          )}
        </div>
        <div className="row">
          {onReanalyze && (
            <button className="btn ghost sm" onClick={onReanalyze} disabled={busy !== null}>
              Re-analyze website
            </button>
          )}
          <button className="btn ghost sm" onClick={onManual} disabled={busy !== null}>
            Start fresh
          </button>
        </div>
      </div>
    </>
  );
}
