'use client';
import { useState, type CSSProperties } from 'react';
import type { Deck, Workspace } from '@/lib/schema';
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

/** Everything that goes into Instagram besides the images, ready to copy. */
export function CaptionPanel({ deck }: { deck: Deck }) {
  const caption = deck.caption;
  if (!caption) return <p className="hint">This post has no caption yet. Ask for one in the bar: “Write the caption”.</p>;
  const alt = deck.slides.map((slide, i) => slide.alt ? `${i + 1}. ${slide.alt}` : '').filter(Boolean);
  return <div className="settings">
    <section className="tile"><div className="field-row"><h3>Caption</h3><Copy text={`${caption.text}\n\n${caption.hashtags}`.trim()} label="Copy with hashtags" /></div>
      <p className="caption-text">{caption.text}</p>
      {caption.hashtags ? <p className="tags">{caption.hashtags}</p> : null}</section>
    {caption.firstComment ? <section className="tile"><div className="field-row"><h3>First comment</h3><Copy text={caption.firstComment} label="Copy" /></div><p className="caption-text">{caption.firstComment}</p></section> : null}
    {alt.length ? <section className="tile"><div className="field-row"><h3>Alt text</h3><Copy text={alt.join('\n')} label="Copy" /></div>
      <ol className="alt-list">{deck.slides.map((slide, i) => slide.alt ? <li key={i}><b>Slide {i + 1}</b> {slide.alt}</li> : null)}</ol>
      <p className="hint">In Instagram: Advanced settings → Accessibility → Write alt text.</p></section> : null}
    <Copy text={captionText(deck)} label="Copy everything" />
  </div>;
}

/** Every saved version, newest first. Tapping one makes it current; nothing is lost. */
export function VersionList({ workspace, disabled, onRestore }: { workspace: Workspace; disabled: boolean; onRestore: (direction: 'undo' | 'redo', steps: number) => void }) {
  const list = versions(workspace);
  if (list.length < 2) return <p className="hint">Versions appear here as you change the post. Tap one to go back to it; you can always come forward again.</p>;
  return <ol className="versions">{list.map(({ version, direction, steps }, i) => <li key={i} style={{ '--i': i } as CSSProperties}>
    <button type="button" className={`version${direction ? '' : ' current'}`} disabled={disabled || !direction} onClick={() => direction && onRestore(direction, steps)}>
      <span className="version-thumb"><SlidePreview html={version.deck.slides[0].html} width={version.deck.width} height={version.deck.height} index={0} thumbnail assets={version.deck.assets} /></span>
      <span className="version-text"><strong>{direction ? `v${list.length - i}` : `v${list.length - i} · current`}</strong>
        <small>{version.instruction || 'First version'}</small>
        <small>{version.deck.slides.length} slides · {version.deck.width} × {version.deck.height}</small></span>
      {direction ? <Icon name={direction === 'undo' ? 'undo' : 'redo'} size={16} /> : <Icon name="check" size={16} />}
    </button></li>)}</ol>;
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
