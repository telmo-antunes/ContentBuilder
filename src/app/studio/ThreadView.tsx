'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AgentMessage, Deck, Workspace } from '@/lib/schema';
import { versions } from '@/lib/history';
import { isStory } from '@/lib/formats';
import { SlidePreview } from '../SlidePreview';
import { Choices, Proposal } from './Thread';
import { Icon } from './Icon';

type Props = {
  workspace: Workspace; contextKey: string; disabled: boolean; thinking: string | null;
  live: { deck: Deck | null; size: { width: number; height: number }; phase: string; pending: boolean } | null;
  onSend: (text: string) => void; onApply: (id: string) => void; onDismiss: (id: string) => void; onResume: () => void;
  onReview: (slide: number) => void; onRestore: (id: string) => void; onDownload: () => void; onQuote: (slide: number) => void;
};

/** One version of the post as a card: swipe through it, review it full size, or bring it back. */
function VersionCard({ deck, number, current, live, phase, pending, onReview, onRestore, onDownload, onQuote }: {
  deck: Deck | null; number: number; current: boolean; live?: boolean; phase?: string; pending?: boolean;
  onReview?: (slide: number) => void; onRestore?: () => void; onDownload?: () => void; onQuote?: (slide: number) => void;
}) {
  const [at, setAt] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const slides = deck?.slides ?? [];
  const w = deck?.width ?? 1080, h = deck?.height ?? 1350;
  const total = slides.length + (pending ? 1 : 0);
  useEffect(() => { // Follow the newest slide while it streams in.
    if (live && track.current) track.current.scrollTo({ left: track.current.scrollWidth, behavior: 'smooth' });
  }, [live, slides.length]);
  return <article className={`vcard${current ? ' current' : ''}${live ? ' live' : ''}`} style={{ '--ratio': `${w} / ${h}` } as CSSProperties}>
    <header className="vcard-head">
      <span className={`vb${current || live ? ' new' : ''}`}>v{number}</span>
      <span className="vcard-meta">{live ? <span className="live-text">{phase || 'Designing…'}</span> : `${slides.length} ${isStory({ width: w, height: h }) ? 'frames · story' : `slide${slides.length === 1 ? '' : 's'}`}`}</span>
      {current && !live ? <span className="now">now</span> : null}
      {current && !live && onReview ? <button type="button" className="icon-button small" aria-label="Review full size" onClick={() => onReview(at)}><Icon name="eye" size={16} /></button> : null}
    </header>
    <div className="vtrack" ref={track} onScroll={event => { const el = event.currentTarget; const first = el.firstElementChild as HTMLElement | null; if (first) setAt(Math.round(el.scrollLeft / (first.offsetWidth + 8))); }}
      style={current && !live ? { viewTransitionName: 'post-media' } as CSSProperties : undefined}>
      {slides.map((slide, i) => <button type="button" key={`${i}-${slide.html.length}`} className="vslide" style={{ '--i': i } as CSSProperties} disabled={!current || live}
        aria-label={current ? `Slide ${i + 1}: review full size` : `Slide ${i + 1}`} onClick={() => current && onReview?.(i)}>
        <SlidePreview html={slide.html} width={w} height={h} index={i} thumbnail assets={deck!.assets} />
        {current && !live && onQuote ? <span role="button" tabIndex={0} className="quote" aria-label={`Change slide ${i + 1}`}
          onClick={event => { event.stopPropagation(); onQuote(i); }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); onQuote(i); } }}><Icon name="chat" size={13} /></span> : null}
      </button>)}
      {pending || (live && !slides.length) ? <span className="vslide skeleton" style={{ '--i': slides.length } as CSSProperties}><span className="spinner" /></span> : null}
    </div>
    {total > 1 ? <div className="dots">{Array.from({ length: total }, (_, i) => <i key={i} className={i === Math.min(at, total - 1) ? 'on' : ''} />)}</div> : null}
    {deck?.caption && !live ? <p className="vcard-caption">{deck.caption.text.split('\n')[0]}</p> : null}
    {!live ? <footer className="vcard-actions">
      {current ? <>
        <button type="button" className="chip" onClick={() => onReview?.(at)}><Icon name="phone" size={14} />Review</button>
        <button type="button" className="chip" onClick={onDownload}><Icon name="download" size={14} />Download</button>
      </> : <button type="button" className="chip" onClick={onRestore}><Icon name="undo" size={14} />Bring this back</button>}
    </footer> : null}
  </article>;
}

// The conversation is the workspace: requests, replies, and every version as a card in the flow.
export function ThreadView({ workspace, contextKey, disabled, thinking, live, onSend, onApply, onDismiss, onResume, onReview, onRestore, onDownload, onQuote }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const messages = workspace.agent.messages;
  const all = versions(workspace);
  const numbers = new Map(all.map((item, i) => [item.version.deck.id ?? `#${i}`, all.length - i]));
  const current = workspace.deck;
  const referenced = new Set(messages.map(message => message.deckId).filter(Boolean));
  const showCurrent = !!current && !live && !(current.id && referenced.has(current.id));
  const streamedCount = live?.deck?.slides.length ?? -1;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages.length, streamedCount, thinking]);

  const card = (message: AgentMessage) => {
    const found = all.find(item => item.version.deck.id === message.deckId);
    if (!found) return <li key={message.id} className="activity"><Icon name="clock" size={14} /><span>An earlier version that is no longer kept.</span></li>;
    const isCurrent = found.direction === null;
    return <li key={message.id} className="card-row"><VersionCard deck={found.version.deck} number={numbers.get(message.deckId!) ?? 1} current={isCurrent}
      onReview={onReview} onDownload={onDownload} onQuote={onQuote} onRestore={() => onRestore(message.deckId!)} /></li>;
  };

  return <section className="threadview" aria-label="Conversation">
    <ol className="thread" aria-live="polite" aria-relevant="additions">
      {messages.map(message => message.role === 'tool'
        ? message.deckId ? card(message) : <li key={message.id} className="activity"><Icon name={/fail|stopp|could not|error/i.test(message.text) ? 'alert' : 'check'} size={14} /><span>{message.text}</span></li>
        : <li key={message.id} className={`bubble ${message.role}`}>
          {message.role === 'user' && typeof message.context?.target === 'number' && (message.context.intent === 'chat' || message.context.intent === 'revise') ? <span className="aim"><Icon name="eye" size={12} />Slide {message.context.target + 1}</span> : null}
          <p>{message.text}</p>
          {message.attachments?.length ? <div className="bubble-images">{message.attachments.map(image => <a key={image.original} href={image.original} target="_blank" rel="noreferrer" aria-label={`Open ${image.name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.thumbnail} alt={image.name} width={56} height={56} />
          </a>)}</div> : null}
          <Choices message={message} disabled={disabled || !!thinking || !!live} onSend={onSend} />
          <Proposal message={message} contextKey={contextKey} disabled={disabled || !!thinking || !!live} onSend={onSend} onApply={onApply} onDismiss={onDismiss} />
        </li>)}
      {showCurrent && current ? <li className="card-row"><VersionCard deck={current} number={numbers.get(current.id ?? '#0') ?? all.length} current onReview={onReview} onDownload={onDownload} onQuote={onQuote} /></li> : null}
      {live ? <li className="card-row"><VersionCard deck={live.deck} number={all.length + 1} current={false} live phase={live.phase} pending={live.pending} /></li> : null}
      {thinking && !live ? <li className="bubble assistant typing" role="status"><span className="dots-typing"><i /><i /><i /></span><small>{thinking}</small></li> : null}
      {!thinking && !live && messages.at(-1)?.role === 'user' ? <li className="activity"><button type="button" className="button" disabled={disabled} onClick={onResume}>Resume reply</button></li> : null}
    </ol>
    <div ref={end} className="thread-end" aria-hidden="true" />
  </section>;
}
