'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MAX_REVISION_REFERENCES, type Workspace } from '@/lib/schema';
import { formats, isStory } from '@/lib/formats';
import { Formats } from './Formats';
import { Icon } from './Icon';
import { useUploads } from './useUploads';

export type ComposeRequest = { url: string; count: number | null };
type Props = {
  workspace: Workspace; edit: (change: (current: Workspace) => Workspace) => void; locked: boolean; configured: boolean;
  onCreate: (request: ComposeRequest) => void; onClose: (() => void) | null; onUploadBusy: (busy: boolean) => void;
};

const COUNTS = [1, 3, 4, 5, 6, 7, 8, 10];
const STEPS = ['Say it', 'Shape it', 'Make it'] as const;
const urlPattern = /https?:\/\/[^\s)]+/i;
const starters = [
  '5 mistakes that cost detailing studios their regulars',
  'We’re open this Saturday, 9:00–13:00',
  'Before and after of a full interior detail',
  'A happy client’s words, big and simple',
];
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const slideRole = (slide: number, count: number | null) => slide === 1 ? 'Cover' : count && slide === count && count > 2 ? 'Close' : '';

// Three beats: say what the post is about, shape the slides if you want to, make it.
export function Compose({ workspace, edit, locked, configured, onCreate, onClose, onUploadBusy }: Props) {
  const [step, setStep] = useState(0);
  const [back, setBack] = useState(false);
  const [url, setUrl] = useState(() => workspace.brief.match(urlPattern)?.[0] ?? '');
  const [count, setCount] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const brief = useRef<HTMLTextAreaElement>(null);
  const images = workspace.agent.references;
  const uploads = useUploads({ count: images.length, onBusyChange: onUploadBusy,
    onAdd: image => edit(w => ({ ...w, agent: { ...w.agent, references: [...w.agent.references.filter(r => r.original !== image.original), image] } })) });
  const directions = workspace.slideDirections;
  const filled = directions.filter(item => item.text.trim());
  const story = isStory(workspace);
  const format = formats.find(item => item.width === workspace.width && item.height === workspace.height);
  const ready = configured && !locked && !!workspace.brief.trim();
  useEffect(() => { if (step === 0) brief.current?.focus({ preventScroll: true }); }, [step]);

  function go(next: number) { setBack(next < step); setStep(next); }
  function setDirection(slide: number, text: string) {
    edit(w => {
      const existing = w.slideDirections.find(item => item.slide === slide);
      const slideDirections = existing ? w.slideDirections.map(item => item.slide === slide ? { ...item, text } : item)
        : [...w.slideDirections, { id: crypto.randomUUID(), slide, text }];
      return { ...w, slideDirections, slideDirectionsEnabled: slideDirections.some(item => item.text.trim()) };
    });
  }
  function chooseCount(next: number | null) {
    setCount(next);
    // Instructions for slides beyond the new count would ask for slides that no longer exist.
    if (next) edit(w => { const slideDirections = w.slideDirections.filter(item => item.slide <= next); return { ...w, slideDirections, slideDirectionsEnabled: slideDirections.some(item => item.text.trim()) }; });
  }
  function create() { if (ready) onCreate({ url: url.trim(), count }); }
  // With the AI choosing the count, show the slides that already have instructions plus one empty card.
  const cards = count ? Array.from({ length: count }, (_, i) => i + 1)
    : [...new Set([...filled.map(item => item.slide), Math.max(0, ...filled.map(item => item.slide)) + 1])].sort((a, b) => a - b);

  const receipts = [
    { step: 0, icon: 'text' as const, text: workspace.brief.trim() || 'Nothing yet', extra: [format ? `${format.label} ${format.ratio}` : `${workspace.width} × ${workspace.height}`, images.length ? `${images.length} image${images.length === 1 ? '' : 's'}` : '', url ? hostOf(url) : ''].filter(Boolean).join(' · ') },
    { step: 1, icon: 'layers' as const, text: count ? `${count} slide${count === 1 ? '' : 's'}` : 'The AI chooses how many slides', extra: filled.length ? `${filled.length} with your instructions` : 'No per-slide instructions' },
  ];

  return <section className="compose" aria-label="New post">
    <ol className="beats" aria-label="Steps">{STEPS.map((label, i) => <li key={label} className={i === step ? 'on' : i < step ? 'done' : ''}>
      <button type="button" disabled={i > step && !workspace.brief.trim()} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
        <span className="beat-dot">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>{label}</button></li>)}</ol>

    {step > 0 ? <div className="receipts">{receipts.filter(item => item.step < step).map(item => <button type="button" key={item.step} className="receipt" onClick={() => go(item.step)}>
      <Icon name={item.icon} size={16} /><span><strong>{item.text}</strong><small>{item.extra}</small></span><span className="receipt-edit">Edit</span></button>)}</div> : null}

    <div key={step} className={`beat ${back ? 'from-left' : 'from-right'}`}>
      {step === 0 ? <>
        <header className="beat-head"><p className="eyebrow"><Icon name="sparkle" size={14} />New post</p><h1>What are we posting today?</h1>
          <p className="lede">Say it in your own words: the topic, who it’s for, anything it must say.</p></header>
        <div className="field-card">
          <textarea ref={brief} rows={4} value={workspace.brief} disabled={locked} aria-label="What the post is about" placeholder="A carousel for detailing studio owners: three signs a client is ready for a ceramic coating. Calm and expert, in European Portuguese."
            onChange={event => { const text = event.target.value; edit(w => ({ ...w, brief: text })); if (!url) setUrl(text.match(urlPattern)?.[0] ?? ''); }}
            onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void uploads.upload(files); } }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (workspace.brief.trim()) go(1); } }} />
          <div className="field-tools">
            <button type="button" className="chip" disabled={locked || images.length >= MAX_REVISION_REFERENCES} onClick={() => picker.current?.click()}><Icon name="image" size={16} />Add images</button>
            <label className="chip link-field"><Icon name="link" size={16} /><input type="url" inputMode="url" value={url} disabled={locked} placeholder="Link to read (optional)" onChange={event => setUrl(event.target.value)} aria-label="A link to read for content or look" /></label>
          </div>
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void uploads.upload(files); }} />
          {images.length || uploads.progress || uploads.error ? <div className="command-extras">{images.map(image => <span className="attachment" key={image.original}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.thumbnail} alt={image.name} width={44} height={44} />
            <button type="button" aria-label={`Remove ${image.name}`} onClick={() => edit(w => ({ ...w, agent: { ...w.agent, references: w.agent.references.filter(r => r.original !== image.original) } }))}><Icon name="close" size={12} /></button></span>)}
            {uploads.progress ? <span className="chip soft"><span className="spinner" />{uploads.progress}</span> : null}
            {uploads.error ? <button type="button" className="chip warn" onClick={uploads.clearError}>{uploads.error}</button> : null}</div> : null}
        </div>
        {!workspace.brief.trim() ? <div className="starters">{starters.map((text, i) => <button type="button" key={text} className="chip starter" style={{ '--i': i } as CSSProperties} disabled={locked}
          onClick={() => { edit(w => ({ ...w, brief: text })); brief.current?.focus(); }}>{text}</button>)}</div> : null}
        <div className="field-label">Format</div>
        <Formats width={workspace.width} height={workspace.height} disabled={locked} onChange={size => edit(w => ({ ...w, ...size }))} />
        <div className="beat-actions">
          <button type="button" className="button ghost" disabled={!ready} onClick={create}>Create now</button>
          <button type="button" className="button primary" disabled={!workspace.brief.trim()} onClick={() => go(1)}>Shape the slides<Icon name="right" size={18} /></button>
        </div>
      </> : null}

      {step === 1 ? <>
        <header className="beat-head"><h1>Shape the slides</h1><p className="lede">Optional. Say what a slide should hold and the AI follows it; leave a slide empty and it designs that one freely.</p></header>
        <div className="field-label">How many {story ? 'frames' : 'slides'}?</div>
        <div className="counts" role="radiogroup" aria-label="Number of slides">
          <button type="button" role="radio" aria-checked={count === null} className={`chip count${count === null ? ' on' : ''}`} onClick={() => chooseCount(null)}><Icon name="sparkle" size={14} />AI decides</button>
          {COUNTS.map(n => <button type="button" key={n} role="radio" aria-checked={count === n} className={`chip count${count === n ? ' on' : ''}`} onClick={() => chooseCount(n)}>{n}</button>)}
        </div>
        <ol className="slide-cards">{cards.map((slide, i) => {
          const text = directions.find(item => item.slide === slide)?.text ?? '';
          const role = slideRole(slide, count);
          return <li key={slide} className={`slide-card${text.trim() ? ' set' : ''}`} style={{ '--i': i, '--ratio': `${workspace.width} / ${workspace.height}` } as CSSProperties}>
            <span className="slide-mini" aria-hidden="true"><b>{slide}</b></span>
            <label className="slide-field"><span className="field-label">Slide {slide}{role ? <em> · {role}</em> : null}</span>
              <textarea rows={2} value={text} disabled={locked} placeholder={slide === 1 ? 'e.g. The hook: “3 signs your client wants ceramic”, big type, our logo small.' : 'Leave empty to let the AI decide.'}
                onChange={event => setDirection(slide, event.target.value)} /></label>
            {text ? <button type="button" className="slide-clear" aria-label={`Clear slide ${slide}`} onClick={() => setDirection(slide, '')}><Icon name="close" size={14} /></button> : null}
          </li>;
        })}</ol>
        <div className="beat-actions">
          <button type="button" className="button ghost" onClick={() => go(0)}><Icon name="left" size={18} />Back</button>
          <button type="button" className="button primary" onClick={() => go(2)}>Review<Icon name="right" size={18} /></button>
        </div>
      </> : null}

      {step === 2 ? <>
        <header className="beat-head"><h1>Ready to make it</h1><p className="lede">You’ll watch the slides arrive in the conversation, then review the post full size.</p></header>
        <div className="forecast" aria-hidden="true" style={{ '--ratio': `${workspace.width} / ${workspace.height}` } as CSSProperties}>
          {(count ? Array.from({ length: count }, (_, i) => i + 1) : [1, 2, 3, 4]).slice(0, 6).map((slide, i) => {
            const text = directions.find(item => item.slide === slide)?.text.trim();
            return <span key={slide} className={`ghost-slide${text ? ' set' : ''}`} style={{ '--i': i } as CSSProperties}><b>{slide}</b><small>{text || (count ? 'AI designs' : 'AI decides')}</small></span>;
          })}
          {!count ? <span className="ghost-slide more" style={{ '--i': 4 } as CSSProperties}><b>…</b><small>as many as it needs</small></span> : null}
        </div>
        <label className="toggle"><input type="checkbox" checked={workspace.polish} disabled={locked} onChange={event => { const polish = event.target.checked; edit(w => ({ ...w, polish })); }} />
          <span className="switch" aria-hidden="true" /><span><strong>Polish pass</strong><small>Checks the result at phone size and fixes clipped text, small type and weak contrast.</small></span></label>
        <div className="beat-actions">
          <button type="button" className="button ghost" onClick={() => go(1)}><Icon name="left" size={18} />Back</button>
          <button type="button" className="button primary create" disabled={!ready} onClick={create}><Icon name="sparkle" size={18} />Create the post</button>
        </div>
        {!configured ? <p className="hint">Add ANTHROPIC_API_KEY to .env and restart to create posts.</p> : null}
      </> : null}
    </div>
    {onClose ? <button type="button" className="link compose-close" onClick={onClose}>Back to the conversation</button> : null}
  </section>;
}
