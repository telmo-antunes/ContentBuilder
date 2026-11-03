'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Deck } from '@/lib/schema';
import { SlidePreview } from '../SlidePreview';
import { Icon } from './Icon';

export type StageWork = { kind: 'generate' | 'revise' | 'other'; phase: string; target: number | null };
type Props = {
  deck: Deck | null; width: number; height: number; selected: number; onSelect: (index: number) => void;
  work: StageWork | null; handle: string; peeking: boolean; locked: boolean; empty: ReactNode;
  onAim: (index: number) => void; onMove: (from: number, to: number) => void; onDuplicate: (index: number) => void; onDelete: (index: number) => void; onDownloadSlide: (index: number) => void;
};

// The post as Instagram will show it: swipe it, tap a frame to aim the next instruction at it.
export function Stage({ deck, width, height, selected, onSelect, onAim, work, handle, peeking, locked, empty, onMove, onDuplicate, onDelete, onDownloadSlide }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const menuRoot = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const w = deck?.width ?? width, h = deck?.height ?? height;
  const story = h / w > 1.6;
  const slides = deck?.slides ?? [];
  const count = slides.length;
  const index = Math.min(selected, Math.max(0, count - 1));
  const generating = work?.kind === 'generate';
  const keys = slideKeys(slides.map(slide => slide.html));

  useEffect(() => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    if (Math.round(el.scrollLeft / el.clientWidth) !== index) el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  }, [index, count]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menuRoot.current?.contains(event.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); };
  }, [menu]);
  function scrolled() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = track.current; if (!el?.clientWidth) return;
      const next = Math.round(el.scrollLeft / el.clientWidth);
      if (next !== index && next >= 0 && next < count) onSelect(next);
    });
  }
  const busyOn = (i: number) => !!work && (work.kind === 'generate' || (work.kind === 'revise' && (work.target === null || work.target === i)));
  const busyPill = work ? <div className="cell-busy" role="status"><span className="busy-pill"><span className="spinner" />{work.phase}</span></div> : null;

  return <section className={`stage${story ? ' is-story' : ''}`} style={{ '--ratio': `${w} / ${h}`, '--ar': w / h } as CSSProperties} aria-label="Post preview">
    <article className="post">
      <header className="post-head">
        <span className="avatar" aria-hidden="true"><span>{handle.slice(0, 1).toUpperCase()}</span></span>
        <span className="handle"><strong>{handle}</strong><small>{story ? 'Story' : count > 1 ? 'Carousel' : 'Post'} · {w} × {h}</small></span>
        {peeking ? <span className="peek-badge">Before</span> : null}
        {count ? <div className="slide-menu" ref={menuRoot}>
          <button type="button" className="icon-button" aria-label={`Actions for slide ${index + 1}`} aria-expanded={menu} disabled={locked || peeking}
            onClick={() => setMenu(value => !value)}><Icon name="more" /></button>
          {menu ? <div className="menu" role="menu">
            <p className="menu-title">Slide {index + 1}</p>
            <button role="menuitem" disabled={index === 0} onClick={() => { setMenu(false); onMove(index, index - 1); }}><Icon name="left" />Move earlier</button>
            <button role="menuitem" disabled={index === count - 1} onClick={() => { setMenu(false); onMove(index, index + 1); }}><Icon name="right" />Move later</button>
            <button role="menuitem" onClick={() => { setMenu(false); onDuplicate(index); }}><Icon name="copy" />Duplicate</button>
            <button role="menuitem" onClick={() => { setMenu(false); onDownloadSlide(index); }}><Icon name="download" />Download PNG</button>
            <button role="menuitem" className="danger" disabled={count === 1} onClick={() => { setMenu(false); onDelete(index); }}><Icon name="trash" />Delete</button>
          </div> : null}
        </div> : null}
      </header>

      <div className="media">
        {story && count ? <div className="story-bars" aria-hidden="true">{slides.map((_, i) => <span key={i} className={i < index ? 'seen' : i === index ? 'now' : ''} />)}</div> : null}
        {count ? <>
          <div className="track" ref={track} onScroll={scrolled} tabIndex={0} aria-label={`Slides, ${index + 1} of ${count}`}
            onKeyDown={event => { if (event.key === 'ArrowRight' && index < count - 1) onSelect(index + 1); if (event.key === 'ArrowLeft' && index > 0) onSelect(index - 1); }}>
            {slides.map((slide, i) => <div className="cell" key={keys[i]} style={{ '--i': i } as CSSProperties} aria-hidden={i !== index}>
              <SlidePreview html={slide.html} width={w} height={h} index={i} fill assets={deck!.assets} />
              {busyOn(i) ? busyPill : null}
            </div>)}
          </div>
          {!story && count > 1 ? <span className="counter">{index + 1}/{count}</span> : null}
          {index > 0 ? <button type="button" className="nav prev" aria-label="Previous slide" onClick={() => onSelect(index - 1)}><Icon name="left" /></button> : null}
          {index < count - 1 ? <button type="button" className="nav next" aria-label="Next slide" onClick={() => onSelect(index + 1)}><Icon name="right" /></button> : null}
        </> : generating ? <div className="cell skeleton">{busyPill}</div> : <div className="cell blank">{empty}</div>}
      </div>

      {!story ? <footer className="post-foot">
        <div className="post-actions" aria-hidden="true"><Icon name="heart" size={24} /><Icon name="comment" size={24} /><Icon name="share" size={24} />
          {count > 1 ? <span className="dots">{slides.map((_, i) => <i key={i} className={i === index ? 'on' : ''} />)}</span> : <span className="dots" />}
          <Icon name="bookmark" size={24} /></div>
        <p className="caption"><strong>{handle}</strong> {deck?.title || (generating ? 'Writing your post…' : 'Your caption will live here.')}</p>
      </footer> : null}
    </article>

    {count || generating ? <nav className="filmstrip" aria-label="Slides">
      {count ? slides.map((slide, i) => <button type="button" key={keys[i]} style={{ '--i': i } as CSSProperties}
        className={`thumb${i === index ? ' on' : ''}${dragging === i ? ' dragging' : ''}${over === i && dragging !== null && dragging !== i ? ' over' : ''}${busyOn(i) ? ' busy' : ''}`}
        aria-current={i === index ? 'true' : undefined} aria-label={`Slide ${i + 1}`} onClick={() => onAim(i)}
        draggable={!locked && !peeking && count > 1} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; setDragging(i); }}
        onDragOver={event => { if (dragging === null) return; event.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)}
        onDrop={event => { event.preventDefault(); if (dragging !== null && dragging !== i) onMove(dragging, i); setDragging(null); setOver(null); }}
        onDragEnd={() => { setDragging(null); setOver(null); }}>
        <SlidePreview html={slide.html} width={w} height={h} index={i} thumbnail assets={deck!.assets} /><span className="num">{i + 1}</span>
      </button>) : [0, 1, 2, 3].map(i => <span key={i} className="thumb ghost" style={{ '--i': i } as CSSProperties} />)}
    </nav> : null}
  </section>;
}

// Keys follow the content, so moving a slide moves its frame instead of reloading it.
function slideKeys(htmls: string[]) {
  const seen = new Map<string, number>();
  return htmls.map(html => {
    let hash = 2166136261;
    for (let i = 0; i < html.length; i++) hash = Math.imul(hash ^ html.charCodeAt(i), 16777619);
    const key = `${html.length}:${hash >>> 0}`; const n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
    return `${key}:${n}`;
  });
}
