'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_REFERENCE_BYTES, MAX_REVISION_REFERENCES, revisionReferenceSchema, type RevisionReference } from '@/lib/schema';

export function RevisionReferences({ images, disabled, onAdd, onRemove, onBusyChange, purpose = 'revision' }: {
  images: RevisionReference[]; disabled: boolean;
  purpose?: 'revision' | 'conversation';
  onAdd: (image: RevisionReference) => void; onRemove: (original: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  async function upload(files: File[]) {
    if (!files.length || active.current || disabled) return;
    setError('');
    if (images.length + files.length > MAX_REVISION_REFERENCES) { setError(`Attach up to ${MAX_REVISION_REFERENCES} images per ${purpose === 'revision' ? 'revision' : 'message'}. Remove an image or choose fewer files.`); return; }
    const controller = new AbortController(); active.current = controller; onBusyChange(true);
    const errors: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        controller.signal.throwIfAborted(); setProgress(`Adding image ${index + 1} of ${files.length}…`);
        if (file.size > MAX_REFERENCE_BYTES) { errors.push(`${file.name}: choose an image smaller than 10 MB.`); continue; }
        const type = file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : '');
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) { errors.push(`${file.name}: choose a PNG, JPEG or WebP image.`); continue; }
        try {
          const response = await fetch('/api/reference-images', { method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(file.name) }, body: file, signal: controller.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Upload failed. Try again.');
          controller.signal.throwIfAborted(); onAdd(revisionReferenceSchema.parse(result));
        } catch (error) { if (controller.signal.aborted) throw error; errors.push(`${file.name}: ${(error as Error).message}`); }
      }
      setError(errors.join('\n'));
    } catch { if (!controller.signal.aborted) setError('The upload could not finish. Please try again.'); }
    finally { active.current = null; setProgress(''); onBusyChange(false); }
  }
  return <div className="revision-references" role="group" aria-label={purpose === 'revision' ? 'Revision reference images' : 'Conversation reference images'}>
    <div className="reference-upload-heading"><button type="button" onClick={() => input.current?.click()} disabled={disabled || images.length >= MAX_REVISION_REFERENCES}>Add reference images</button>
      <span className="field-hint">{images.length ? `${images.length} attached · ` : ''}Optional</span></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple hidden aria-label={purpose === 'conversation' ? 'Upload conversation reference images' : 'Upload revision reference images'}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files); }} />
    <p className="field-hint">PNG, JPEG or WebP · up to {MAX_REVISION_REFERENCES} images, 10 MB each. Describe how to use them in your {purpose === 'revision' ? 'revision' : 'message'}.</p>
    {images.length ? <><ul className="revision-reference-list">{images.map(image => <li key={image.original}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <a href={image.original} target="_blank" rel="noreferrer" aria-label={`Open reference ${image.name}`}><img src={image.thumbnail} alt={image.name} width={72} height={72} /></a>
      <div><span className="reference-name">{image.name}</span><small>{image.width} × {image.height} px</small></div>
      <button type="button" className="text-button" disabled={disabled} aria-label={`Remove reference ${image.name}`} onClick={() => onRemove(image.original)}>Remove</button>
    </li>)}</ul><p className="field-hint">{purpose === 'revision' ? 'Attached to your next revision. Saved in this draft until you apply it.' : 'Attached to your next message and saved with the conversation.'}</p></> : null}
    <div role="status" className="field-hint reference-upload-status">{progress}</div>
    {error ? <p className="error reference-upload-error" role="alert">{error}</p> : null}
  </div>;
}
