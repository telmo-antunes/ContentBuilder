'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { AssetType, Format } from '@contentbuilder/shared';
import {
  ALLOWED_FORMATS,
  ASSET_TYPES,
  FORMAT_LABELS,
  BLOCK_LABELS,
  BLOCK_TYPES,
  SHORTHAND_LAYOUT_HINTS,
  MAX_DRAFT_PARAGRAPH_CHARS,
  LAYOUT_LABELS,
  CONTENT_INTENTS,
  defaultFormatFor,
  parseShorthand,
} from '@contentbuilder/shared';
import {
  listBusinesses,
  createProject,
  draftProject,
  getHealth,
  type BusinessSummary,
} from '../../lib/api';
import { useStagedProgress, DRAFT_STAGES } from '../../components/useStagedProgress';
import { rankedTemplates, SHORTHAND_PLACEHOLDER, type StarterTemplate } from '../../lib/templates';

type Mode = 'empty' | 'guided' | 'shorthand' | 'draft';

const DRAFT_EXAMPLE =
  "Cover: eyebrow 'LIMITED OFFER', title 'Ceramic Coating Weekend', subtitle '20% off all packages', date 'This Sat–Sun only'. " +
  "Next, a slide with a photo titled 'Why ceramic?' with this paragraph: 'A ceramic coating bonds to your paint, repelling water, dirt, and UV — keeping that just-detailed look for years.' " +
  "Then a slide titled 'What's included' as a list: Full exterior decontamination wash, Single-stage paint correction, 9H ceramic coating, 12-month protection guarantee. " +
  "Final call-to-action slide: 'Book your slot this weekend', handle @apexdetailing.";

function NewProjectForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [businessId, setBusinessId] = useState(params.get('businessId') ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssetType>('carousel');
  const [format, setFormat] = useState<Format>('1080x1080');
  const [mode, setMode] = useState<Mode>('empty');
  const [intentKey, setIntentKey] = useState('');
  const draftLabel = useStagedProgress(busy && mode === 'draft', DRAFT_STAGES);
  const [shorthand, setShorthand] = useState('');
  const [paragraph, setParagraph] = useState('');
  const [aiDraft, setAiDraft] = useState(false);
  const [aiFree, setAiFree] = useState(false);
  const [draftMode, setDraftMode] = useState<'designer' | 'free'>('designer');

  useEffect(() => {
    listBusinesses()
      .then((all) => {
        const approved = all.filter((b) => b.hasApprovedKit);
        setBusinesses(approved);
        setBusinessId((cur) => cur || approved[0]?._id || '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // AI draft is shown only when configured.
    getHealth()
      .then((h) => {
        setAiDraft(Boolean(h.ai?.draft));
        setAiFree(Boolean(h.ai?.free));
      })
      .catch(() => {
        setAiDraft(false);
        setAiFree(false);
      });
  }, []);

  const formats = ALLOWED_FORMATS[type];
  useEffect(() => {
    if (!formats.includes(format)) setFormat(defaultFormatFor(type));
  }, [type, formats, format]);

  const parsed = useMemo(() => parseShorthand(shorthand), [shorthand]);

  const selectedBiz = businesses?.find((b) => b._id === businessId);
  const profileReady = Boolean(selectedBiz?.hasProfile);
  const templates = useMemo(() => rankedTemplates(selectedBiz?.profile?.category), [selectedBiz]);

  // Drop draft mode if AI/profile gating no longer permits it (e.g. switched business).
  useEffect(() => {
    setMode((m) => (m === 'draft' && !(aiDraft && profileReady) ? 'empty' : m));
  }, [aiDraft, profileReady]);

  const applyTemplate = (t: StarterTemplate) => {
    setType(t.type);
    setFormat(t.format);
    setShorthand(t.shorthand);
    setMode('shorthand');
    setTitle((cur) => cur || t.name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const paragraphTooLong = paragraph.length > MAX_DRAFT_PARAGRAPH_CHARS;
  const canSubmit =
    Boolean(businessId && title.trim() && format) &&
    (mode === 'empty' ||
      (mode === 'guided' && Boolean(intentKey)) ||
      (mode === 'shorthand' && parsed.slides.length > 0) ||
      (mode === 'draft' && paragraph.trim().length > 0 && !paragraphTooLong));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({
        businessId,
        title: title.trim(),
        type,
        format,
        slides:
          mode === 'shorthand'
            ? parsed.slides.map((s) => ({
                order: s.order,
                layoutType: s.layoutType,
                blocks: s.blocks,
                imageNeed: s.imageNeed,
              }))
            : mode === 'guided'
              ? CONTENT_INTENTS.find((i) => i.key === intentKey)?.slides.map((plan, i) => ({
                  order: i,
                  layoutType: plan.layoutType,
                  blocks: plan.blocks.map((t) => ({
                    type: t,
                    text: '',
                    ...(t === 'list' ? { items: ['', '', ''] } : {}),
                  })),
                  imageNeed: plan.imageNeed ?? 'none',
                }))
              : undefined,
      });

      let notice = '';
      if (mode === 'draft') {
        // Project created empty; the AI fills its slides from the paragraph.
        const wantFree = aiFree && draftMode === 'free';
        try {
          await draftProject(project._id, paragraph.trim(), wantFree ? 'free' : 'designer');
        } catch (err) {
          // Free layout is the more fragile path; if it fails, fall back to the
          // Designer drafter so the user still gets a populated project, not an
          // empty one. The editor surfaces a notice so the fallback isn't silent.
          if (wantFree) {
            try {
              await draftProject(project._id, paragraph.trim(), 'designer');
              notice = 'free-fallback';
            } catch (err2) {
              setError(
                `${err2 instanceof Error ? err2.message : 'Draft failed'} Opening the empty project so you can build manually.`,
              );
            }
          } else {
            setError(
              `${err instanceof Error ? err.message : 'Draft failed'} Opening the empty project so you can build manually.`,
            );
          }
        }
      }
      router.push(`/projects/${project._id}${notice ? `?notice=${notice}` : ''}`);
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
    <div>
      <p className="muted">
        <Link href="/">← Businesses</Link>
      </p>
      <h1>New project</h1>
      <p className="muted">
        Pick a business with an approved brand kit, choose carousel or story and a compatible format,
        then start empty or paste shorthand. The project opens in the editor.
      </p>

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
                placeholder="Ceramic Coating Weekend"
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
          <div className="row" style={{ marginBottom: mode === 'shorthand' ? 14 : 0 }}>
            <span className="section-label" style={{ margin: 0 }}>
              Start method
            </span>
            <button
              type="button"
              className={`btn sm ${mode === 'empty' ? 'primary' : ''}`}
              onClick={() => setMode('empty')}
            >
              Start empty
            </button>
            <button
              type="button"
              className={`btn sm ${mode === 'guided' ? 'primary' : ''}`}
              onClick={() => setMode('guided')}
            >
              Guided
            </button>
            <button
              type="button"
              className={`btn sm ${mode === 'shorthand' ? 'primary' : ''}`}
              onClick={() => setMode('shorthand')}
            >
              Paste shorthand
            </button>
            {aiDraft && profileReady && (
              <button
                type="button"
                className={`btn sm ${mode === 'draft' ? 'primary' : ''}`}
                onClick={() => setMode('draft')}
              >
                Draft from a paragraph ✦
              </button>
            )}
            <span className="muted" style={{ fontSize: 12 }}>
              {mode === 'draft'
                ? 'One AI call — arranges your copy (and picks imagery), never writes new copy.'
                : mode === 'guided'
                  ? 'Pick what you\u2019re sharing — layouts chosen for you, no AI.'
                  : 'Shorthand is parsed locally — no AI, no tokens.'}
            </span>
          </div>
          {aiDraft && selectedBiz && !profileReady && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              ✦ AI draft is locked until you{' '}
              <Link href={`/businesses/${selectedBiz._id}`}>complete {selectedBiz.name}&apos;s profile</Link>.
            </p>
          )}

          {mode === 'guided' && (
            <div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {CONTENT_INTENTS.map((i) => (
                  <button
                    key={i.key}
                    type="button"
                    className={`btn sm ${intentKey === i.key ? 'primary' : ''}`}
                    onClick={() => setIntentKey(i.key)}
                    title={i.description}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
              {(() => {
                const intent = CONTENT_INTENTS.find((i) => i.key === intentKey);
                if (!intent) {
                  return (
                    <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                      What do you want to share? Each choice scaffolds a professionally arranged set
                      of slides — you just fill in the words.
                    </p>
                  );
                }
                return (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>{intent.description}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {intent.slides.map((plan, i) => (
                        <div key={i} className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                          <span className="muted" style={{ fontSize: 12, width: 18 }}>{i + 1}.</span>
                          <strong style={{ fontSize: 13 }}>{LAYOUT_LABELS[plan.layoutType]}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {plan.blocks.map((b) => BLOCK_LABELS[b]).join(' · ')}
                            {plan.imageNeed === 'upload' ? ' · needs a photo' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {mode === 'shorthand' && (
            <div className="grid-2">
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <button type="button" className="btn sm ghost" onClick={() => setShorthand(SHORTHAND_PLACEHOLDER)}>
                    Load example
                  </button>
                  {shorthand && (
                    <button type="button" className="btn sm ghost" onClick={() => setShorthand('')}>
                      Clear
                    </button>
                  )}
                </div>
                <textarea
                  value={shorthand}
                  onChange={(e) => setShorthand(e.target.value)}
                  placeholder={SHORTHAND_PLACEHOLDER}
                  spellCheck={false}
                  style={{ minHeight: 200, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }}
                />
                <ParsePreview shorthand={shorthand} parsed={parsed} />
              </div>
              <Cheatsheet />
            </div>
          )}

          {mode === 'draft' && (
            <div>
              {aiFree && (
                <div className="row" style={{ marginBottom: 8, alignItems: 'center', gap: 8 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Generation</span>
                  <button
                    type="button"
                    className={`btn sm ${draftMode === 'designer' ? 'primary' : ''}`}
                    onClick={() => setDraftMode('designer')}
                    title="AI arranges your copy into preset layouts and picks a theme/treatment per slide."
                  >
                    Designer
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${draftMode === 'free' ? 'primary' : ''}`}
                    onClick={() => setDraftMode('free')}
                    title="AI places each block on the canvas — fully draggable in the editor."
                  >
                    Free canvas ✦
                  </button>
                </div>
              )}
              <div className="row" style={{ marginBottom: 6 }}>
                <button type="button" className="btn sm ghost" onClick={() => setParagraph(DRAFT_EXAMPLE)}>
                  Load example
                </button>
                {paragraph && (
                  <button type="button" className="btn sm ghost" onClick={() => setParagraph('')}>
                    Clear
                  </button>
                )}
              </div>
              <textarea
                value={paragraph}
                onChange={(e) => setParagraph(e.target.value)}
                placeholder={DRAFT_EXAMPLE}
                style={{ minHeight: 160 }}
              />
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12, maxWidth: 560 }}>
                  Type the <strong>exact copy</strong> you want — the AI only arranges your words into
                  slides; it never writes, edits, or translates copy.
                </span>
                <span
                  className="muted"
                  style={{ fontSize: 12, color: paragraphTooLong ? 'var(--danger)' : undefined }}
                >
                  {paragraph.length}/{MAX_DRAFT_PARAGRAPH_CHARS}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="row">
          <button className="btn primary" type="submit" disabled={!canSubmit || busy}>
            {busy
              ? mode === 'draft'
                ? draftLabel ?? 'Drafting…'
                : 'Creating…'
              : mode === 'shorthand'
                ? `Create ${parsed.slides.length} slide${parsed.slides.length === 1 ? '' : 's'}`
                : mode === 'draft'
                  ? 'Draft slides ✦'
                  : 'Create empty project'}
          </button>
          {!aiDraft && (
            <span className="muted" style={{ fontSize: 13 }}>
              Set an Anthropic key + model to enable “Draft from a paragraph”.
            </span>
          )}
        </div>
      </form>

      <h2>Starter templates</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {selectedBiz?.profile
          ? `Sorted for ${selectedBiz.name} — clone one to fill the shorthand and set the format.`
          : 'Clone a ready-made example — it fills the shorthand and sets the format. Tweak, then create.'}
      </p>
      <div className="list">
        {templates.map((t) => (
          <div className="item" key={t.name}>
            <div className="grow">
              <div className="title">{t.name}</div>
              <div className="sub">{t.blurb}</div>
              <div className="badges">
                {t.recommended && (
                  <span className="badge ok">
                    <span className="dot" /> Recommended
                  </span>
                )}
                <span className="badge accent">{t.type}</span>
                <span className="badge">{FORMAT_LABELS[t.format]}</span>
                <span className="badge">{parseShorthand(t.shorthand).slides.length} slides</span>
              </div>
            </div>
            <button type="button" className="btn sm" onClick={() => applyTemplate(t)}>
              Use template
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ParsePreview({ shorthand, parsed }: { shorthand: string; parsed: ReturnType<typeof parseShorthand> }) {
  if (!shorthand.trim()) {
    return (
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Type or load shorthand above to preview the parsed slides.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div className="section-label" style={{ marginTop: 0 }}>
        Parsed: {parsed.slides.length} slide{parsed.slides.length === 1 ? '' : 's'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {parsed.slides.map((s, i) => (
          <div key={i} style={{ fontSize: 12 }}>
            <span className="badge accent" style={{ marginRight: 6 }}>
              {s.layoutType}
            </span>
            <span className="muted">
              {s.blocks.map((b) => b.type).join(', ') || '(no blocks)'}
              {s.imageNeed === 'upload' ? ' · image' : ''}
            </span>
          </div>
        ))}
      </div>
      {parsed.warnings.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {parsed.warnings.map((w, i) => (
            <div key={i} className="badge warn" style={{ marginRight: 6, marginTop: 4, fontSize: 11 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cheatsheet() {
  return (
    <div className="panel" style={{ fontSize: 13 }}>
      <div className="section-label" style={{ marginTop: 0 }}>
        Shorthand cheatsheet
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        One slide per line: <code>Slide N:</code> (or <code>Frame N:</code>), then comma-separated
        elements. Copy after a colon is kept verbatim.
      </p>
      <div style={{ marginBottom: 8 }}>
        <strong>Layout hints</strong>
        <div className="muted" style={{ marginTop: 4 }}>
          {SHORTHAND_LAYOUT_HINTS.map((h) => h.phrase).join(' · ')}
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Blocks</strong> — <code>type: text</code>
        <div className="muted" style={{ marginTop: 4 }}>
          {BLOCK_TYPES.filter((t) => t !== 'list').map((t) => BLOCK_LABELS[t].toLowerCase()).join(' · ')}
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>List</strong> — <code>list: a | b | c</code>
      </div>
      <div>
        <strong>Image</strong> — the bare word <code>image</code> adds an upload slot
      </div>
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
