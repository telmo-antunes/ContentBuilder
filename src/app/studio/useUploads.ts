'use client';
import { useEffect, useRef, useState } from 'react';
import { MAX_REFERENCE_BYTES, MAX_REVISION_REFERENCES, revisionReferenceSchema, type RevisionReference } from '@/lib/schema';

const types = ['image/png', 'image/jpeg', 'image/webp'];
function fileType(file: File) {
  return file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : '');
}

// Uploads reference images one by one, so a bad file never blocks the good ones.
export function useUploads({ count, onAdd, onBusyChange }: { count: number; onAdd: (image: RevisionReference) => void; onBusyChange: (busy: boolean) => void }) {
  const active = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  async function upload(files: File[]) {
    const images = files.filter(file => types.includes(fileType(file)));
    if (!files.length || active.current) return;
    setError('');
    if (!images.length) { setError('Choose a PNG, JPEG or WebP image.'); return; }
    if (count + images.length > MAX_REVISION_REFERENCES) { setError(`Up to ${MAX_REVISION_REFERENCES} images per message. Remove one first.`); return; }
    const controller = new AbortController(); active.current = controller; onBusyChange(true);
    const errors: string[] = [];
    try {
      for (const [index, file] of images.entries()) {
        controller.signal.throwIfAborted(); setProgress(`Adding ${index + 1} of ${images.length}…`);
        if (file.size > MAX_REFERENCE_BYTES) { errors.push(`${file.name} is over 10 MB.`); continue; }
        try {
          const response = await fetch('/api/reference-images', { method: 'POST', headers: { 'Content-Type': fileType(file), 'X-File-Name': encodeURIComponent(file.name) }, body: file, signal: controller.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Upload failed. Try again.');
          controller.signal.throwIfAborted(); onAdd(revisionReferenceSchema.parse(result));
        } catch (failure) { if (controller.signal.aborted) throw failure; errors.push(`${file.name}: ${(failure as Error).message}`); }
      }
      setError(errors.join('\n'));
    } catch { if (!controller.signal.aborted) setError('The upload could not finish. Please try again.'); }
    finally { active.current = null; setProgress(''); onBusyChange(false); }
  }
  return { upload, progress, error, clearError: () => setError('') };
}
