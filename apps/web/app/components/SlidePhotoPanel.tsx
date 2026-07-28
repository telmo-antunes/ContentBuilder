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
  /** Which photo's card is open (one at a time — the panel is narrow). */
  const [expanded, setExpanded] = useState<string | null>(null);
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
    if (expanded === id) setExpanded(null);
    onChange(photos.filter((p) => p.id !== id));
  };

  /** Promote an existing photo to the slide background (the old one steps down). */
  const makeBackground = (p: SlidePhoto) =>
    onChange([
      ...photos.filter((x) => x.id !== p.id && x.placement !== 'background'),
      { ...p, placement: 'background', slot: undefined, frame: undefined },
    ]);

  const disabled = busy || uploading !== null;

  /** Plain-language names for every movement a photo can have in a video. */
  const MOVES: Array<{ v: string; t: string }> = [
    { v: 'auto', t: 'Automatic' },
    { v: 'none', t: 'Hold still' },
    { v: 'in', t: 'Slowly zoom in' },
    { v: 'out', t: 'Slowly zoom out' },
    { v: 'left', t: 'Drift left' },
    { v: 'right', t: 'Drift right' },
    { v: 'up', t: 'Drift up' },
    { v: 'down', t: 'Drift down' },
  ];

  /** A labelled row of choices. Words, not glyphs — the old controls were a
   *  line of symbols nobody could read without hovering each one. */
  const Choice = ({
    label,
    hint,
    value,
    options,
    onPick,
  }: {
    label: string;
    hint?: string;
    value: string;
    options: Array<{ v: string; t: string }>;
    onPick: (v: string) => void;
  }) => (
    <div className="spc-field">
      <span className="spc-label">{label}</span>
      <div className="spc-seg">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`spc-opt${value === o.v ? ' on' : ''}`}
            disabled={disabled}
            onClick={() => onPick(o.v)}
          >
            {o.t}
          </button>
        ))}
      </div>
      {hint && <span className="spc-hint">{hint}</span>}
    </div>
  );

  /**
   * One photo, as a card that opens.
   *
   * Collapsed it says what the picture is and what it is doing; opened it
   * shows every control with a written label. Nothing is a bare symbol.
   */
  const card = (opts: {
    key: string;
    photo?: SlidePhoto;
    title: string;
    status: string;
    uploadKey: string;
    onUpload: () => void;
    slotShape?: string;
    kind: 'slot' | 'background' | 'free';
  }) => {
    const { photo: p, kind } = opts;
    const asset = p ? assetOf(p.mediaAssetId) : undefined;
    const need = p ? renderedWidth(p, opts.slotShape, format) : 0;
    const soft = Boolean(asset?.width && need && asset.width < need * 0.8);
    const open = p ? expanded === p.id : false;
    return (
      <article className={`spc${open ? ' open' : ''}${selectedFreeId && p?.id === selectedFreeId ? ' sel' : ''}`} key={opts.key}>
        <div className="spc-head">
          {asset ? (
            <img className="spc-thumb" src={asset.url} alt="" />
          ) : (
            <span className="spc-thumb spc-blank">{p ? '?' : '+'}</span>
          )}
          <div className="spc-id">
            <span className="spc-title">{opts.title}</span>
            <span className={`spc-status${soft ? ' warn' : ''}`}>
              {soft ? `Too low-res — ${asset!.width}px wide for a ${need}px space` : opts.status}
            </span>
          </div>
          {p ? (
            <button
              className="btn sm"
              disabled={disabled}
              onClick={() => setExpanded(open ? null : p.id)}
            >
              {open ? 'Done' : 'Edit'}
            </button>
          ) : (
            <button className="btn sm primary" disabled={disabled} onClick={opts.onUpload}>
              {uploading === opts.uploadKey ? 'Uploading…' : 'Add photo'}
            </button>
          )}
        </div>

        {open && p && asset && (
          <div className="spc-body">
            <div className="spc-field">
              <span className="spc-label">What stays in frame</span>
              <FocalPicker url={asset.url} value={p.focal} onChange={(focal) => patch(p.id, { focal })} />
            </div>

            <Choice
              label="How it fills the space"
              value={p.fit === 'contain' ? 'contain' : 'cover'}
              options={[
                { v: 'cover', t: 'Fill it (crops)' },
                { v: 'contain', t: 'Show all of it' },
              ]}
              onPick={(v) => patch(p.id, { fit: v as 'cover' | 'contain' })}
            />

            {kind === 'slot' && (
              <>
                <Choice
                  label="Size"
                  value={p.size ?? 'md'}
                  options={[
                    { v: 'sm', t: 'Small' },
                    { v: 'md', t: 'Medium' },
                    { v: 'lg', t: 'Large' },
                  ]}
                  onPick={(v) => patch(p.id, { size: v as 'sm' | 'md' | 'lg' })}
                />
                <Choice
                  label="Shape"
                  hint="A taller shape takes more of the slide, leaving less room for words."
                  value={p.shape ?? (opts.slotShape || 'standard')}
                  options={[
                    { v: 'standard', t: '4:3' },
                    { v: 'wide', t: 'Wide' },
                    { v: 'square', t: 'Square' },
                    { v: 'tall', t: 'Tall' },
                  ]}
                  onPick={(v) => patch(p.id, { shape: v as SlidePhoto['shape'] })}
                />
              </>
            )}

            {kind === 'free' && (
              <>
                <Choice
                  label="Layer"
                  value={(p.z ?? 1) < 0 ? 'behind' : 'front'}
                  options={[
                    { v: 'front', t: 'In front of the text' },
                    { v: 'behind', t: 'Behind the text' },
                  ]}
                  onPick={(v) => patch(p.id, { z: v === 'behind' ? -1 : 1 })}
                />
                <div className="spc-field">
                  <span className="spc-label">Position and size</span>
                  <button
                    className={`btn sm${selectedFreeId === p.id ? ' primary' : ''}`}
                    disabled={disabled}
                    onClick={() => onSelectFree(selectedFreeId === p.id ? null : p.id)}
                  >
                    {selectedFreeId === p.id ? 'Finish positioning' : 'Move and resize it'}
                  </button>
                  <span className="spc-hint">
                    {selectedFreeId === p.id
                      ? 'Drag the picture on the preview above; drag its bottom-right corner to resize.'
                      : 'Turn this on to drag the picture around the slide.'}
                  </span>
                </div>
              </>
            )}

            <div className="spc-field">
              <span className="spc-label">Movement in video</span>
              <select
                className="spc-select"
                disabled={disabled}
                value={p.motion ?? 'auto'}
                onChange={(e) => patch(p.id, { motion: e.target.value as SlidePhoto['motion'] })}
              >
                {MOVES.map((m) => (
                  <option key={m.v} value={m.v}>
                    {m.t}
                  </option>
                ))}
              </select>
              <span className="spc-hint">
                Automatic drifts toward whatever you framed above. Only affects video exports.
              </span>
            </div>

            <div className="spc-actions">
              <button className="btn sm" disabled={disabled} onClick={opts.onUpload}>
                {uploading === opts.uploadKey ? 'Uploading…' : 'Swap photo'}
              </button>
              {kind !== 'background' && (
                <button className="btn sm" disabled={disabled} onClick={() => makeBackground(p)}>
                  Make it the background
                </button>
              )}
              <button className="btn sm danger" disabled={disabled} onClick={() => remove(p.id)}>
                Remove
              </button>
            </div>
          </div>
        )}
      </article>
    );
  };

  const moveName = (p?: SlidePhoto) =>
    MOVES.find((m) => m.v === (p?.motion ?? 'auto'))!.t.toLowerCase();

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
          <div className="spc-group">Spaces the AI left for photos</div>
          {slots.map((slotName) => {
            const p = bySlot[slotName];
            const shape = shapeOf(slotName);
            return card({
              key: slotName,
              photo: p,
              title: slotLabel(slotName),
              status: p ? `In place · ${moveName(p)}` : 'Empty — add your photo here',
              uploadKey: slotName,
              onUpload: () => pick({ kind: 'slot', slot: slotName }),
              slotShape: shape,
              kind: 'slot',
            });
          })}
        </>
      )}

      <div className="spc-group">Background</div>
      {card({
        key: 'bg',
        photo: background ?? undefined,
        title: background ? 'Behind everything' : 'No background photo',
        status: background
          ? `Fills the whole slide · ${moveName(background)}`
          : 'The brand’s own background is showing',
        uploadKey: 'background',
        onUpload: () => pick({ kind: 'background' }),
        kind: 'background',
      })}

      <div className="spc-group">Photos you place yourself</div>
      {free.map((p) =>
        card({
          key: p.id,
          photo: p,
          title: 'Placed photo',
          status: `${(p.z ?? 1) < 0 ? 'Behind the text' : 'In front of the text'} · ${moveName(p)}`,
          uploadKey: p.id,
          onUpload: () => pick({ kind: 'free', id: p.id }),
          kind: 'free',
        }),
      )}
      <button
        className="btn sm"
        style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
        disabled={disabled}
        onClick={() => pick({ kind: 'free' })}
      >
        {uploading === 'free' ? 'Uploading…' : 'Add a photo anywhere on the slide'}
      </button>
    </div>
  );
}
