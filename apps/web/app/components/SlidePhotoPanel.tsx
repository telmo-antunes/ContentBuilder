'use client';

import { useMemo, useRef, useState } from 'react';
import { authoredSlots, type MediaAsset, type Slide, type SlidePhoto } from '@contentbuilder/shared';
import { uploadMedia } from '../lib/api';
import { toast } from './Toast';

/** Where a brand-new floating image lands before you drag it. */
const NEW_FREE_FRAME = { x: 0.26, y: 0.32, w: 0.48, h: 0.36 };

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p${Date.now()}${Math.round(Math.random() * 1e6)}`;

/** Human label for a slot name the composer chose ("before-after" → "Before after"). */
function slotLabel(name: string): string {
  const s = name.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The photo controls for one slide.
 *
 * Three ways a picture lands, matching how the slide is actually built:
 *   · SLOTS — the placeholders the composer left. Filling one replaces the
 *     placeholder in place, bounded by the section it was designed into.
 *   · BACKGROUND — any one photo, full-bleed behind the whole composition.
 *   · FLOATING — dropped anywhere, dragged and resized by hand on the preview.
 *
 * Uploading and placing are separate steps on purpose: bytes go to the brand's
 * media library (which content-sniffs and sanitises them), and this panel only
 * ever moves asset ids around.
 */
export default function SlidePhotoPanel({
  slide,
  media,
  businessId,
  busy,
  selectedFreeId,
  onSelectFree,
  onChange,
}: {
  slide: Slide;
  media: MediaAsset[];
  businessId: string;
  busy: boolean;
  selectedFreeId: string | null;
  onSelectFree: (id: string | null) => void;
  /**
   * The new photo list, plus the asset that was just created when this change
   * came from an upload. The caller has to fold that asset into its media list
   * — nothing can RENDER a photo whose asset it can't resolve, and re-fetching
   * the whole project just to learn one URL would blank the preview mid-edit.
   */
  onChange: (photos: SlidePhoto[], uploaded?: MediaAsset) => void;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** What the pending file picker should do with the asset once it lands. */
  const targetRef = useRef<{ kind: 'slot'; slot: string } | { kind: 'background' } | { kind: 'free' }>({
    kind: 'free',
  });

  const photos = useMemo(() => slide.photos ?? [], [slide.photos]);
  const slots = useMemo(() => authoredSlots(slide.authored?.html ?? ''), [slide.authored?.html]);
  const urlOf = (id: string) => media.find((m) => m._id === id)?.url;

  const bySlot = useMemo(() => {
    const m: Record<string, SlidePhoto> = {};
    for (const p of photos) if (p.placement === 'slot' && p.slot) m[p.slot] = p;
    return m;
  }, [photos]);
  const background = photos.find((p) => p.placement === 'background') ?? null;
  const free = photos.filter((p) => p.placement === 'free');

  const pick = (target: typeof targetRef.current) => {
    targetRef.current = target;
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const target = targetRef.current;
    setUploading(target.kind === 'slot' ? target.slot : target.kind);
    try {
      const asset = await uploadMedia(businessId, file);
      const next = [...photos];
      if (target.kind === 'slot') {
        // Replacing a slot's photo swaps the asset and keeps everything else.
        const i = next.findIndex((p) => p.placement === 'slot' && p.slot === target.slot);
        const entry: SlidePhoto = {
          id: i >= 0 ? next[i]!.id : uid(),
          mediaAssetId: asset._id,
          placement: 'slot',
          slot: target.slot,
          fit: 'cover',
        };
        if (i >= 0) next[i] = entry;
        else next.push(entry);
      } else if (target.kind === 'background') {
        const i = next.findIndex((p) => p.placement === 'background');
        const entry: SlidePhoto = {
          id: i >= 0 ? next[i]!.id : uid(),
          mediaAssetId: asset._id,
          placement: 'background',
          fit: 'cover',
        };
        if (i >= 0) next[i] = entry;
        else next.push(entry);
      } else {
        const entry: SlidePhoto = {
          id: uid(),
          mediaAssetId: asset._id,
          placement: 'free',
          frame: NEW_FREE_FRAME,
          fit: 'cover',
          z: 1,
        };
        next.push(entry);
        onSelectFree(entry.id);
      }
      onChange(next, asset);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = ''; // let the same file be picked twice
    }
  };

  const remove = (id: string) => {
    if (selectedFreeId === id) onSelectFree(null);
    onChange(photos.filter((p) => p.id !== id));
  };

  /** Promote an existing photo to the slide background (the old one steps down). */
  const makeBackground = (p: SlidePhoto) => {
    onChange([
      ...photos.filter((x) => x.id !== p.id && x.placement !== 'background'),
      { ...p, placement: 'background', slot: undefined, frame: undefined },
    ]);
  };

  const patchFree = (id: string, patch: Partial<SlidePhoto>) =>
    onChange(photos.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const disabled = busy || uploading !== null;

  const thumb = (id: string) => {
    const url = urlOf(id);
    return url ? (
      <img className="sp-thumb" src={url} alt="" />
    ) : (
      <span className="sp-thumb sp-missing" title="This photo is no longer in the library">
        ?
      </span>
    );
  };

  return (
    <div className="sp">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        style={{ display: 'none' }}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {slots.length > 0 && (
        <>
          <div className="k studio-klbl">Image slots</div>
          {slots.map((name) => {
            const p = bySlot[name];
            return (
              <div className="sp-row" key={name}>
                {p ? thumb(p.mediaAssetId) : <span className="sp-thumb sp-empty">＋</span>}
                <div className="sp-meta">
                  <span className="sp-name">{slotLabel(name)}</span>
                  <span className="sp-sub">{p ? 'Filled' : 'Empty — the AI left space here'}</span>
                </div>
                <div className="sp-ctl">
                  <button
                    className="btn sm"
                    disabled={disabled}
                    onClick={() => pick({ kind: 'slot', slot: name })}
                  >
                    {uploading === name ? 'Uploading…' : p ? 'Replace' : 'Upload'}
                  </button>
                  {p && (
                    <>
                      <button
                        className="btn sm ghost"
                        disabled={disabled}
                        title="Use this photo full-bleed behind the whole slide"
                        onClick={() => makeBackground(p)}
                      >
                        ⤢
                      </button>
                      <button className="btn sm ghost" disabled={disabled} onClick={() => remove(p.id)}>
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="k studio-klbl" style={{ marginTop: slots.length ? 14 : 0 }}>
        Background
      </div>
      <div className="sp-row">
        {background ? thumb(background.mediaAssetId) : <span className="sp-thumb sp-empty">＋</span>}
        <div className="sp-meta">
          <span className="sp-name">{background ? 'Full-bleed photo' : 'None'}</span>
          <span className="sp-sub">
            {background ? 'Behind the whole composition' : 'The brand’s own background is showing'}
          </span>
        </div>
        <div className="sp-ctl">
          <button className="btn sm" disabled={disabled} onClick={() => pick({ kind: 'background' })}>
            {uploading === 'background' ? 'Uploading…' : background ? 'Replace' : 'Upload'}
          </button>
          {background && (
            <button className="btn sm ghost" disabled={disabled} onClick={() => remove(background.id)}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="k studio-klbl" style={{ marginTop: 14 }}>
        Floating
      </div>
      {free.map((p) => (
        <div
          className={`sp-row${selectedFreeId === p.id ? ' sel' : ''}`}
          key={p.id}
          onClick={() => onSelectFree(selectedFreeId === p.id ? null : p.id)}
        >
          {thumb(p.mediaAssetId)}
          <div className="sp-meta">
            <span className="sp-name">{selectedFreeId === p.id ? 'Dragging on the preview' : 'Floating image'}</span>
            <span className="sp-sub">{(p.z ?? 1) < 0 ? 'Behind the text' : 'In front of the text'}</span>
          </div>
          <div className="sp-ctl">
            <button
              className="btn sm ghost"
              disabled={disabled}
              title={(p.z ?? 1) < 0 ? 'Bring in front of the text' : 'Send behind the text'}
              onClick={(e) => {
                e.stopPropagation();
                patchFree(p.id, { z: (p.z ?? 1) < 0 ? 1 : -1 });
              }}
            >
              {(p.z ?? 1) < 0 ? '↑' : '↓'}
            </button>
            <button
              className="btn sm ghost"
              disabled={disabled}
              title={p.fit === 'contain' ? 'Fill the frame' : 'Fit the whole picture'}
              onClick={(e) => {
                e.stopPropagation();
                patchFree(p.id, { fit: p.fit === 'contain' ? 'cover' : 'contain' });
              }}
            >
              {p.fit === 'contain' ? '⤢' : '⤡'}
            </button>
            <button
              className="btn sm ghost"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                remove(p.id);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <button
        className="btn sm"
        style={{ width: '100%', justifyContent: 'center', marginTop: free.length ? 8 : 0 }}
        disabled={disabled}
        onClick={() => pick({ kind: 'free' })}
      >
        {uploading === 'free' ? 'Uploading…' : '＋ Add floating image'}
      </button>
      {free.length > 0 && (
        <p className="muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
          Click one to select it, then drag it on the preview above. Pull the corner to resize.
        </p>
      )}
    </div>
  );
}
