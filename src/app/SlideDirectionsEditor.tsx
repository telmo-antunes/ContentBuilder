'use client';
import { useEffect, useRef, useState } from 'react';
import type { SlideDirectionDraft } from '@/lib/schema';

function SlideNumber({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return <input type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required aria-label={label} value={text}
    onChange={event => {
      setText(event.target.value);
      const number = Number(event.target.value);
      if (Number.isSafeInteger(number) && number > 0) onChange(number);
    }} onBlur={() => setText(String(value))} />;
}

export function SlideDirectionsEditor({ enabled, directions, onChange }: {
  enabled: boolean; directions: SlideDirectionDraft[];
  onChange: (enabled: boolean, directions: SlideDirectionDraft[]) => void;
}) {
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const focusNext = useRef<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusNext.current) { fields.current.get(focusNext.current)?.focus(); focusNext.current = undefined; }
  }, [directions]);
  function add() {
    const id = crypto.randomUUID(); focusNext.current = id;
    const next = directions.reduce((highest, item) => Math.max(highest, item.slide), 0) + 1;
    onChange(true, [...directions, { id, slide: Number.isSafeInteger(next) ? next : 1, text: '' }]);
  }
  function edit(id: string, patch: Partial<SlideDirectionDraft>) {
    onChange(enabled, directions.map(item => item.id === id ? { ...item, ...patch } : item));
  }
  return <div className="slide-directions">
    <label className="check-label"><input type="checkbox" checked={enabled} onChange={event => {
      if (event.target.checked && !directions.length) add(); else onChange(event.target.checked, directions);
    }} />Give instructions per slide</label>
    {enabled ? <>
      <p className="field-hint">Direct any slide by number. Leave other slides open for the model. Your main brief can set the total count.</p>
      {directions.map((item, i) => <div className="slide-direction" key={item.id}>
        <div className="slide-direction-heading"><label>Slide<SlideNumber value={item.slide} label={`Slide number for instruction ${i + 1}`} onChange={slide => edit(item.id, { slide })} /></label>
          <button type="button" className="text-button" aria-label={`Remove instructions for slide ${item.slide}`} onClick={() => { onChange(enabled, directions.filter(d => d.id !== item.id)); addButton.current?.focus(); }}>Remove</button></div>
        <label className="direction-label" htmlFor={`direction-${item.id}`}>Instructions for slide {item.slide}</label>
        <textarea id={`direction-${item.id}`} ref={element => { if (element) fields.current.set(item.id, element); else fields.current.delete(item.id); }} rows={4}
          value={item.text} onChange={event => edit(item.id, { text: event.target.value })} placeholder="Exact wording, layout, imagery, or room to explore…" />
      </div>)}
      <button type="button" ref={addButton} onClick={add}>Add slide instructions</button>
    </> : directions.some(item => item.text.trim()) ? <p className="field-hint">Your slide instructions are saved and switched off.</p> : null}
  </div>;
}
