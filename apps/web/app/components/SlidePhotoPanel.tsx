'use client';

import { useMemo, useRef, useState } from 'react';
import {
  SLOT_SHAPES,
  authoredSlots,
  dimensionsFor,
  type Format,
  type MediaAsset,
  type Slide,
  type SlidePhoto,
} from '@contentbuilder/shared';
import { uploadMedia } from '../lib/api';
import FocalPicker from './FocalPicker';
import { toast } from './Toast';

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
 * Where a new floating image lands — sized from the photo's OWN proportions.
 *
 * A fixed starting frame meant every upload was crop-distorted the instant it
 * appeared: a panorama and a portrait both arrived as the same 4:3 box, and you
 * had to fight the handles back to the shape the picture already was.
 */
function frameForAsset(asset: MediaAsset, format: Format) {
  const { width: CW, height: CH } = dimensionsFor(format);
  const ratio = asset.width && asset.height ? asset.width / asset.height : 4 / 3;
  let w: number;
  let h: number;
  if (ratio >= 1) {
    w = 0.62;                       // landscape: fix the long side, derive the short
    h = (w * CW) / ratio / CH;
  } else {
    h = 0.46;                       // portrait: the other way round
    w = (h * CH * ratio) / CW;
  }
  w = Math.min(0.92, w);
  h = Math.min(0.92, h);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/**
 * Roughly how many device pixels this photo will be painted across, so we can
 * say so when the file simply doesn't have them. Approximate on purpose — the
 * point is to catch a 400px logo stretched over a hero, not to be exact.
 */
function renderedWidth(p: SlidePhoto, slideHtmlHasShape: string | undefined, format: Format): number {
  const { width: CW, height: CH } = dimensionsFor(format);
  if (p.placement === 'background') return CW;
  if (p.placement === 'free') return Math.round((p.frame?.w ?? 0.5) * CW);
  const shape = SLOT_SHAPES[(slideHtmlHasShape ?? '') as keyof typeof SLOT_SHAPES] ?? SLOT_SHAPES[''];
  return Math.round(Math.min(CW * 0.86, CH * shape.budget * shape.ratio));
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
  format,
  busy,
  selectedFreeId,
  onSelectFree,
  onChange,
}: {
  slide: Slide;
  media: MediaAsset[];
  businessId: string;
  format: Format;
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
  /** Which photo's focal picker is open (only one at a time). */
  const [focusing, setFocusing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** What the pending file picker should do with the asset once it lands. */
  const targetRef = useRef<
    { kind: 'slot'; slot: string } | { kind: 'background' } | { kind: 'free'; id?: string }
  >({ kind: 'free' });

  const photos = useMemo(() => slide.photos ?? [], [slide.photos]);
  const html = slide.authored?.html ?? '';
  const slots = useMemo(() => authoredSlots(html), [html]);
  const assetOf = (id: string) => media.find((m) => m._id === id);

  /** The shape class the composer gave a slot, so we can size-check against it. */
  const shapeOf = (name: string): string | undefined => {
    const m = html.match(new RegExp(`class="([^"]*)"[^>]*data-cb-slot="${name}"`, 'i'))
      ?? html.match(new RegExp(`data-cb-slot="${name}"[^>]*class="([^"]*)"`, 'i'));
    return (m?.[1] ?? '').split(/\s+/).find((c) => c === 'wide' || c === 'tall' || c === 'square');
  };

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
      const upsert = (match: (p: SlidePhoto) => boolean, entry: Omit<SlidePhoto, 'id'>) => {
        const i = next.findIndex(match);
        // Replacing keeps the entry's identity and its focal point — you chose
        // that crop for this hole, and it usually still applies to the new shot.
        if (i >= 0) next[i] = { ...next[i]!, ...entry };
        else next.push({ id: uid(), ...entry });
      };
      if (target.kind === 'slot') {
        upsert(
          (p) => p.placement === 'slot' && p.slot === target.slot,
          { mediaAssetId: asset._id, placement: 'slot', slot: target.slot, fit: 'cover' },
        );
      } else if (target.kind === 'background') {
        upsert((p) => p.placement === 'background', {
          mediaAssetId: asset._id,
          placement: 'background',
          fit: 'cover',
        });
      } else if (target.id) {
        // Replacing an existing overlay: keep where you put it, re-shape it to
        // the new photo's proportions rather than stretching it into the old.
        const i = next.findIndex((p) => p.id === target.id);
        if (i >= 0) {
          const f = frameForAsset(asset, format);
          const cur = next[i]!.frame ?? f;
          next[i] = { ...next[i]!, mediaAssetId: asset._id, frame: { ...cur, w: f.w, h: f.h } };
        }
      } else {
        const entry: SlidePhoto = {
          id: uid(),
          mediaAssetId: asset._id,
          placement: 'free',
          frame: frameForAsset(asset, format),
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

  const patch = (id: string, p: Partial<SlidePhoto>) =>
    onChange(photos.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const remove = (id: string) => {
    if (selectedFreeId === id) onSelectFree(null);
    if (focusing === id) setFocusing(null);
    onChange(photos.filter((p) => p.id !== id));
  };

  /** Promote an existing photo to the slide background (the old one steps down). */
  const makeBackground = (p: SlidePhoto) =>
    onChange([
      ...photos.filter((x) => x.id !== p.id && x.placement !== 'background'),
      { ...p, placement: 'background', slot: undefined, frame: undefined },
    ]);

  const disabled = busy || uploading !== null;

  /** One photo's row: thumbnail (opens the crop), label, and its controls. */
  const row = (
    key: string,
    p: SlidePhoto | undefined,
    name: string,
    sub: string,
    controls: React.ReactNode,
    onUpload: () => void,
    uploadKey: string,
    shape?: string,
  ) => {
    const asset = p ? assetOf(p.mediaAssetId) : undefined;
    const need = p ? renderedWidth(p, shape, format) : 0;
    const soft = Boolean(asset?.width && need && asset.width < need * 0.8);
    const open = p && focusing === p.id;
    return (
      <div key={key}>
        <div className={`sp-row${selectedFreeId && p?.id === selectedFreeId ? ' sel' : ''}`}>
          {asset ? (
            <button
              className="sp-thumbbtn"
              title="Choose what stays in frame"
              disabled={disabled}
              onClick={() => setFocusing(open ? null : p!.id)}
            >
              <img className="sp-thumb" src={asset.url} alt="" />
            </button>
          ) : (
            <span className={`sp-thumb ${p ? 'sp-missing' : 'sp-empty'}`}>{p ? '?' : '＋'}</span>
          )}
          <div className="sp-meta">
            <span className="sp-name">{name}</span>
            <span className={`sp-sub${soft ? ' warn' : ''}`}>
              {soft ? `Low resolution — ${asset!.width}px across a ${need}px box` : sub}
            </span>
          </div>
          <div className="sp-ctl">
            <button className="btn sm" disabled={disabled} onClick={onUpload}>
              {uploading === uploadKey ? '…' : p ? 'Replace' : 'Upload'}
            </button>
            {controls}
          </div>
        </div>
        {open && asset && (
          <FocalPicker
            url={asset.url}
            value={p!.focal}
            onChange={(focal) => patch(p!.id, { focal })}
          />
        )}
      </div>
    );
  };

  /** Cover/contain — the only honest answer when a photo and its hole disagree. */
  const fitBtn = (p: SlidePhoto) => (
    <button
      className="btn sm ghost"
      disabled={disabled}
      title={p.fit === 'contain' ? 'Fill the box (crops)' : 'Fit the whole photo (letterboxes)'}
      onClick={() => patch(p.id, { fit: p.fit === 'contain' ? 'cover' : 'contain' })}
    >
      {p.fit === 'contain' ? '⤢' : '⤡'}
    </button>
  );

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
          {slots.map((slotName) => {
            const p = bySlot[slotName];
            const shape = shapeOf(slotName);
            return row(
              slotName,
              p,
              slotLabel(slotName),
              p ? `Filled · ${shape ?? '4:3'}` : 'Empty — the AI left space here',
              p ? (
                <>
                  {fitBtn(p)}
                  <button
                    className="btn sm ghost"
                    disabled={disabled}
                    title="Use this photo full-bleed behind the whole slide"
                    onClick={() => makeBackground(p)}
                  >
                    ⬒
                  </button>
                  <button className="btn sm ghost" disabled={disabled} onClick={() => remove(p.id)}>
                    ✕
                  </button>
                </>
              ) : null,
              () => pick({ kind: 'slot', slot: slotName }),
              slotName,
              shape,
            );
          })}
        </>
      )}

      <div className="k studio-klbl" style={{ marginTop: slots.length ? 14 : 0 }}>
        Background
      </div>
      {row(
        'bg',
        background ?? undefined,
        background ? 'Full-bleed photo' : 'None',
        background ? 'Behind the whole composition' : 'The brand’s own background is showing',
        background ? (
          <button className="btn sm ghost" disabled={disabled} onClick={() => remove(background.id)}>
            ✕
          </button>
        ) : null,
        () => pick({ kind: 'background' }),
        'background',
      )}

      <div className="k studio-klbl" style={{ marginTop: 14 }}>
        Floating
      </div>
      {free.map((p) =>
        row(
          p.id,
          p,
          selectedFreeId === p.id ? 'Selected — drag it above' : 'Floating image',
          (p.z ?? 1) < 0 ? 'Behind the text' : 'In front of the text',
          <>
            {fitBtn(p)}
            <button
              className="btn sm ghost"
              disabled={disabled}
              title={(p.z ?? 1) < 0 ? 'Bring in front of the text' : 'Send behind the text'}
              onClick={() => patch(p.id, { z: (p.z ?? 1) < 0 ? 1 : -1 })}
            >
              {(p.z ?? 1) < 0 ? '↑' : '↓'}
            </button>
            <button
              className="btn sm ghost"
              disabled={disabled}
              title={selectedFreeId === p.id ? 'Done positioning' : 'Position it on the preview'}
              onClick={() => onSelectFree(selectedFreeId === p.id ? null : p.id)}
            >
              ✥
            </button>
            <button className="btn sm ghost" disabled={disabled} onClick={() => remove(p.id)}>
              ✕
            </button>
          </>,
          () => pick({ kind: 'free', id: p.id }),
          p.id,
        ),
      )}
      <button
        className="btn sm"
        style={{ width: '100%', justifyContent: 'center', marginTop: free.length ? 8 : 0 }}
        disabled={disabled}
        onClick={() => pick({ kind: 'free' })}
      >
        {uploading === 'free' ? 'Uploading…' : '＋ Add floating image'}
      </button>
    </div>
  );
}
