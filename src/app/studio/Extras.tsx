'use client';
import { useState, type CSSProperties } from 'react';
import type { Caption, Deck, Workspace } from '@/lib/schema';
import type { DraftSummary } from '@/lib/drafts';
import { dollars } from '@/lib/pricing';
import { versions } from '@/lib/history';
import { captionText } from '@/lib/caption';
import { SlidePreview } from '../SlidePreview';
import { Icon } from './Icon';

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="button copy" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* the text stays selectable */ }
  }}><Icon name={done ? 'check' : 'copy'} size={16} />{done ? 'Copied' : label}</button>;
}

/** Everything that goes into Instagram besides the images: edit it in place, rewrite it, copy it. */
export function CaptionPanel({ deck, locked, rewriting, onChange, onRewrite }: {
  deck: Deck; locked: boolean; rewriting: boolean; onChange: (caption: Caption) => void; onRewrite: (wish: string) => void;
}) {
  const [wish, setWish] = useState('');
  const caption = deck.caption ?? { text: '', hashtags: '', firstComment: '' };
  const set = (patch: Partial<Caption>) => onChange({ ...caption, ...patch });
  const alt = deck.slides.map((slide, i) => slide.alt ? `${i + 1}. ${slide.alt}` : '').filter(Boolean);
  return <div className="settings">
    <section className="tile">
      <div className="field-row"><h3>Caption</h3>{caption.text.trim() ? <Copy text={`${caption.text}\n\n${caption.hashtags}`.trim()} label="Copy with hashtags" /> : null}</div>
      <textarea className="caption-edit" rows={6} value={caption.text} disabled={locked} placeholder="Write the caption, or let the AI write one below." aria-label="Caption" onChange={event => set({ text: event.target.value })} />
      <label className="field"><span className="field-label">Hashtags</span>
        <input value={caption.hashtags} disabled={locked} placeholder="#detailing #ceramiccoating" onChange={event => set({ hashtags: event.target.value })} /></label>
      <form className="inline-form" onSubmit={event => { event.preventDefault(); onRewrite(wish.trim()); setWish(''); }}>
        <input value={wish} disabled={locked} placeholder={deck.caption ? 'Rewrite it… (optional: shorter, more playful)' : 'Write it… (optional: what it should say)'} aria-label="What the new caption should do" onChange={event => setWish(event.target.value)} />
        <button className="button primary" disabled={locked}>{rewriting ? <span className="spinner" /> : <><Icon name="sparkle" size={16} />{deck.caption ? 'Rewrite' : 'Write'}</>}</button>
      </form>
    </section>
    <section className="tile"><div className="field-row"><h3>First comment</h3>{caption.firstComment ? <Copy text={caption.firstComment} label="Copy" /> : null}</div>
      <textarea rows={2} value={caption.firstComment} disabled={locked} placeholder="Optional, e.g. the link or more hashtags." aria-label="First comment" onChange={event => set({ firstComment: event.target.value })} /></section>
    {alt.length ? <section className="tile"><div className="field-row"><h3>Alt text</h3><Copy text={alt.join('\n')} label="Copy" /></div>
      <ol className="alt-list">{deck.slides.map((slide, i) => slide.alt ? <li key={i}><b>Slide {i + 1}</b> {slide.alt}</li> : null)}</ol>
      <p className="hint">In Instagram: Advanced settings → Accessibility → Write alt text.</p></section> : null}
    {deck.caption ? <Copy text={captionText(deck)} label="Copy everything" /> : null}
  </div>;
}

/** Posts set aside, newest first. Opening one sets the current post aside in its place. */
export function DraftList({ drafts, error, disabled, onOpen, onDelete }: {
  drafts: DraftSummary[] | null; error: string; disabled: boolean; onOpen: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState('');
  if (error) return <p className="hint" role="alert">{error}</p>;
  if (!drafts) return <p className="hint" aria-busy="true"><span className="spinner" /> Loading your drafts…</p>;
  if (!drafts.length) return <p className="hint">Posts you set aside with “New post” wait here. Open one to pick it up where you left it.</p>;
  return <ol className="versions drafts">{drafts.map((draft, i) => <li key={draft.id} style={{ '--i': i } as CSSProperties}>
    <button type="button" className="version" disabled={disabled} onClick={() => onOpen(draft.id)}>
      <span className="version-thumb">{draft.cover ? <SlidePreview html={draft.cover.html} width={draft.cover.width} height={draft.cover.height} index={0} thumbnail assets={draft.cover.assets} /> : <Icon name="text" size={20} />}</span>
      <span className="version-text"><strong>{draft.title}</strong>
        <small>{draft.slides ? `${draft.slides} slide${draft.slides === 1 ? '' : 's'}` : 'Not made yet'} · {new Date(draft.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
      <Icon name="right" size={16} />
    </button>
    {/* Deleting takes two taps: the first arms the button. */}
    {confirming === draft.id ? <button type="button" className="chip warn draft-delete" disabled={disabled} onClick={() => { setConfirming(''); onDelete(draft.id); }} onBlur={() => setConfirming('')}>Delete</button>
      : <button type="button" className="icon-button small draft-delete" aria-label={`Delete ${draft.title}`} disabled={disabled} onClick={() => setConfirming(draft.id)}><Icon name="trash" size={16} /></button>}
  </li>)}</ol>;
}

/** Every saved version, newest first. Tapping one makes it current; nothing is lost. */
export function VersionList({ workspace, disabled, onRestore }: { workspace: Workspace; disabled: boolean; onRestore: (direction: 'undo' | 'redo', steps: number) => void }) {
  const list = versions(workspace);
  const spent = workspace.spend.post ? <p className="hint spend">AI cost of this post so far: <strong>{dollars(workspace.spend.post)}</strong></p> : null;
  if (list.length < 2) return <>{spent}<p className="hint">Versions appear here as you change the post. Tap one to go back to it; you can always come forward again.</p></>;
  return <>{spent}<ol className="versions">{list.map(({ version, direction, steps }, i) => <li key={i} style={{ '--i': i } as CSSProperties}>
    <button type="button" className={`version${direction ? '' : ' current'}`} disabled={disabled || !direction} onClick={() => direction && onRestore(direction, steps)}>
      <span className="version-thumb"><SlidePreview html={version.deck.slides[0].html} width={version.deck.width} height={version.deck.height} index={0} thumbnail assets={version.deck.assets} /></span>
      <span className="version-text"><strong>{direction ? `v${list.length - i}` : `v${list.length - i} · current`}</strong>
        <small>{version.instruction || 'First version'}</small>
        <small>{version.deck.slides.length} slides · {version.deck.width} × {version.deck.height}</small></span>
      {direction ? <Icon name={direction === 'undo' ? 'undo' : 'redo'} size={16} /> : <Icon name="check" size={16} />}
    </button></li>)}</ol></>;
}

/** Alternatives for one slide, arriving one by one; pick one or keep the current slide. */
export function OptionsTray({ deck, index, options, assets, busy, onPick, onClose }: {
  deck: Deck; index: number; options: string[]; assets: Deck['assets']; busy: boolean; onPick: (html: string) => void; onClose: () => void;
}) {
  const merged = { ...deck.assets, ...assets };
  return <div className="options" role="dialog" aria-label={`Options for slide ${index + 1}`} style={{ '--ratio': `${deck.width} / ${deck.height}` } as CSSProperties}>
    <div className="options-head"><strong><Icon name="grid" size={16} />Options for slide {index + 1}</strong>
      <button type="button" className="link" onClick={onClose}>{busy ? 'Stop' : 'Keep current'}</button></div>
    <div className="options-row">
      <div className="option current" style={{ '--i': 0 } as CSSProperties}><SlidePreview html={deck.slides[index].html} width={deck.width} height={deck.height} index={index} thumbnail assets={deck.assets} /><span>Current</span></div>
      {options.map((html, i) => <button type="button" key={i} className="option" style={{ '--i': i + 1 } as CSSProperties} disabled={busy} onClick={() => onPick(html)} aria-label={`Use option ${i + 1}`}>
        <SlidePreview html={html} width={deck.width} height={deck.height} index={i} thumbnail assets={merged} /><span>Option {i + 1}</span></button>)}
      {busy ? Array.from({ length: Math.max(0, 3 - options.length) }, (_, i) => <span key={`wait-${i}`} className="option ghost" style={{ '--i': options.length + i + 1 } as CSSProperties}><span className="spinner" /></span>) : null}
    </div>
  </div>;
}
