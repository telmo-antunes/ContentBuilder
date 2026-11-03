'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RevisionReference } from '@/lib/schema';
import { MAX_REVISION_REFERENCES } from '@/lib/schema';
import { Icon } from './Icon';
import { useUploads } from './useUploads';

type Props = {
  value: string; onChange: (text: string) => void; onSend: (text: string) => void; onStop: () => void;
  busy: boolean; phase: string; disabled: boolean; placeholder: string;
  scope: { label: string; slide: boolean } | null; onToggleScope: () => void;
  images: RevisionReference[]; onAddImage: (image: RevisionReference) => void; onRemoveImage: (original: string) => void; onPinImage: (image: RevisionReference) => void; onUploadBusy: (busy: boolean) => void;
  fileDrop: File[] | null; onFileDropHandled: () => void;
};

const urlPattern = /https?:\/\/[^\s)]+/i;

// One place to ask for anything: a new post, a change to the selected slide, a question.
export function CommandBar({ value, onChange, onSend, onStop, busy, phase, disabled, placeholder, scope, onToggleScope, images, onAddImage, onRemoveImage, onPinImage, onUploadBusy, fileDrop, onFileDropHandled }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [composing, setComposing] = useState(false);
  const uploads = useUploads({ count: images.length, onAdd: onAddImage, onBusyChange: onUploadBusy });
  const url = value.match(urlPattern)?.[0];
  const ready = !disabled && !busy && !!value.trim();

  useLayoutEffect(() => {
    const el = input.current; if (!el) return;
    // An empty field stays one line; a long placeholder must not grow it.
    el.style.height = 'auto'; if (value) el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);
  useEffect(() => { if (fileDrop) { void uploads.upload(fileDrop); onFileDropHandled(); } }, [fileDrop]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement === document.body) { event.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, []);
  function send() { if (ready) onSend(value); }

  return <form className={`command${busy ? ' is-busy' : ''}`} onSubmit={event => { event.preventDefault(); send(); }}>
    {images.length || uploads.progress || uploads.error || url ? <div className="command-extras">
      {images.map(image => <span className="attachment" key={image.original}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.thumbnail} alt={image.name} width={40} height={40} />
        <button type="button" aria-label={`Remove ${image.name}`} onClick={() => onRemoveImage(image.original)} disabled={busy}><Icon name="close" size={12} /></button>
        <button type="button" className="pin" aria-label={`Pin ${image.name} as standing inspiration`} title="Pin as inspiration for every post" onClick={() => onPinImage(image)} disabled={busy}><Icon name="pin" size={11} /></button>
      </span>)}
      {uploads.progress ? <span className="chip soft"><span className="spinner" />{uploads.progress}</span> : null}
      {url ? <span className="chip soft"><Icon name="link" size={14} />I&apos;ll look at {safeHost(url)}</span> : null}
      {uploads.error ? <button type="button" className="chip warn" onClick={uploads.clearError}>{uploads.error} <Icon name="close" size={12} /></button> : null}
    </div> : null}
    <div className="command-row">
      <button type="button" className="icon-button attach" aria-label="Add reference images" disabled={busy || disabled || images.length >= MAX_REVISION_REFERENCES} onClick={() => picker.current?.click()}><Icon name="plus" /></button>
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void uploads.upload(files); }} />
      <div className="command-field">
        {busy ? <div className="ticker" role="status" aria-live="polite"><span key={phase}>{phase || 'Working…'}</span></div> : <textarea ref={input} rows={1} value={value} placeholder={placeholder} aria-label="Tell ContentBuilder what to make or change" disabled={disabled}
          enterKeyHint="send"
          onChange={event => onChange(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void uploads.upload(files); } }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !composing && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />}
      </div>
      {scope && !busy ? <button type="button" className={`scope${scope.slide ? ' slide' : ''}`} onClick={onToggleScope} aria-label={`Changes apply to: ${scope.label}. Switch scope`}>
        {scope.slide ? <Icon name="eye" size={14} /> : <Icon name="layers" size={14} />}{scope.label}</button> : null}
      {busy ? <button type="button" className="send stop" aria-label="Stop" onClick={onStop}><Icon name="stop" /></button>
        : <button type="submit" className="send" aria-label="Send" disabled={!ready}><Icon name="send" /></button>}
    </div>
  </form>;
}

function safeHost(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'that link'; } }
