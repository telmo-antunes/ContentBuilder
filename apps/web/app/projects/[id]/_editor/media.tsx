'use client';

import { useRef, useState } from 'react';
import type {
  Format,
  ImageAspect,
  ImageObject,
  ImageSizePreset,
  ImageTreatment,
  MediaAsset,
  Slide,
  SlideOverrides,
  SplitPlacement,
} from '@contentbuilder/shared';
import {
  SPLIT_PLACEMENTS,
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  dimensionsFor,
  isFreeLayout,
} from '@contentbuilder/shared';
import { uploadMedia, searchStockPhotos, storeStockPhoto, type StockCandidate } from '../../../lib/api';
import { confirm } from '../../../components/ConfirmDialog';
import { toast } from '../../../components/Toast';

const SPLIT_LABELS: Record<SplitPlacement, string> = {
  'image-left': 'Image left',
  'image-right': 'Image right',
  'image-top': 'Image top',
  'image-bottom': 'Image bottom',
};
const ASPECT_LABELS: Record<ImageAspect, string> = {
  square: 'Square',
  landscape: 'Landscape',
  wide: 'Wide',
  portrait: 'Portrait',
};
const SIZE_LABELS: Record<ImageSizePreset, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

/**
 * Photo curation: search Pexels and pick the RIGHT photo instead of accepting
 * the draft's first hit. Prefilled with the AI art director's imageQuery when
 * the slide has one; picking stores the photo in the library and attaches it.
 */
export function StockPhotoFinder({
  businessId,
  format,
  initialQuery,
  onPicked,
}: {
  businessId: string;
  format: Format;
  initialQuery: string;
  onPicked: (asset: MediaAsset) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [candidates, setCandidates] = useState<StockCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dims = dimensionsFor(format);
  const orientation = dims.height > dims.width ? 'portrait' : dims.width > dims.height ? 'landscape' : 'square';

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await searchStockPhotos(businessId, query.trim(), orientation);
      setCandidates(r.candidates);
      if (r.candidates.length === 0) setErr('No photos found — try different words.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (c: StockCandidate) => {
    setPicking(c.full);
    setErr(null);
    try {
      const asset = await storeStockPhoto(businessId, c);
      onPicked(asset);
      setCandidates(null); // picked — collapse the grid
      toast('Photo added to the slide and your library');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(null);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>Find a stock photo (Pexels)</p>
      <div className="row" style={{ gap: 6 }}>
        <input
          value={query}
          placeholder="e.g. ceramic coating closeup"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          style={{ flex: 1 }}
        />
        <button className="btn sm" onClick={() => void search()} disabled={busy || !query.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {err && <p className="muted" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{err}</p>}
      {candidates && candidates.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {candidates.map((c) => (
            <button
              key={c.full}
              onClick={() => void pick(c)}
              disabled={picking !== null}
              title={`${c.alt || 'Photo'} — by ${c.photographer} on Pexels`}
              style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'none', opacity: picking && picking !== c.full ? 0.5 : 1 }}
            >
              <img src={c.thumb} alt={c.alt} style={{ width: 86, height: 86, objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The media library, one click away instead of permanently stacked: a modal
 * with tabbed groups (website / stock / uploads / backgrounds) and roomy
 * thumbnails. Pick → onPick(assetId) → closes.
 */
export function MediaLibraryModal({
  media,
  selectedId,
  onPick,
  onClose,
}: {
  media: MediaAsset[];
  selectedId?: string;
  onPick: (assetId: string) => void;
  onClose: () => void;
}) {
  const groups = [
    { key: 'site', label: 'From your website', items: media.filter((m) => m.label === 'From your website') },
    { key: 'stock', label: 'Stock photos', items: media.filter((m) => m.label === 'Stock photo') },
    {
      key: 'uploads',
      label: 'Your uploads',
      items: media.filter((m) => m.type !== 'generated' && m.label !== 'From your website' && m.label !== 'Stock photo'),
    },
    { key: 'bg', label: 'Brand backgrounds', items: media.filter((m) => m.type === 'generated') },
  ].filter((g) => g.items.length > 0);
  const [tab, setTab] = useState(groups[0]?.key ?? 'uploads');
  const active = groups.find((g) => g.key === tab) ?? groups[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Media library" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>Media library</h2>
        {groups.length === 0 ? (
          <p className="muted">No media yet — upload an image or search stock photos first.</p>
        ) : (
          <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {groups.map((g) => (
                <button key={g.key} className={`btn sm ${tab === g.key ? 'primary' : 'ghost'}`} onClick={() => setTab(g.key)}>
                  {g.label} ({g.items.length})
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, maxHeight: '48vh', overflowY: 'auto' }}>
              {active?.items.map((m) => (
                <button
                  key={m._id}
                  onClick={() => {
                    onPick(m._id);
                    onClose();
                  }}
                  title={m.label ?? 'Use this image'}
                  style={{
                    padding: 0,
                    border: `2px solid ${selectedId === m._id ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 8,
                    background: 'none',
                    cursor: 'pointer',
                    lineHeight: 0,
                  }}
                >
                  <img src={m.url} alt="" style={{ width: '100%', aspectRatio: '4 / 5', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                </button>
              ))}
            </div>
          </>
        )}
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function ImageControls({
  slide,
  format,
  businessId,
  media,
  onChange,
  onUploaded,
}: {
  slide: Slide;
  format: Format;
  businessId: string;
  media: MediaAsset[];
  onChange: (fn: (s: Slide) => Slide) => void;
  onUploaded: (asset: MediaAsset) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState<'attach' | 'background' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = media.find((m) => m._id === slide.mediaAssetId) ?? null;

  const setOverride = (patch: Partial<SlideOverrides>) =>
    onChange((s) => ({ ...s, overrides: { ...s.overrides, ...patch } }));
  const defaultSplit: SplitPlacement = format === '1080x1920' ? 'image-top' : 'image-left';
  const ov = slide.overrides;

  // Attach an image to the slide. On a free slide that isn't using a full-bleed
  // background, give it a default draggable region so the image actually appears.
  const attachImage = (mediaAssetId: string) =>
    onChange((s) => {
      const overrides =
        isFreeLayout(s.layoutType) && !s.overrides?.imageBackground && !s.overrides?.imageFrame
          ? { ...s.overrides, imageFrame: { x: 0.1, y: 0.28, w: 0.8, h: 0.44 } }
          : s.overrides;
      return { ...s, mediaAssetId, imageNeed: 'upload', overrides };
    });

  // FreePosition: multiple positioned image objects, each with its own media.
  const objects = ov?.imageObjects ?? [];
  const objFileRef = useRef<HTMLInputElement>(null);
  const [objTarget, setObjTarget] = useState<number | 'new' | null>(null);
  const setObjects = (next: ImageObject[]) => setOverride({ imageObjects: next });
  const onPickObject = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const asset = await uploadMedia(businessId, file);
      onUploaded(asset);
      if (objTarget === 'new' || objTarget == null) {
        setObjects([
          ...objects,
          { id: crypto.randomUUID(), mediaAssetId: asset._id, frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.4 }, fit: 'cover' },
        ]);
      } else {
        setObjects(objects.map((o, i) => (i === objTarget ? { ...o, mediaAssetId: asset._id } : o)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setObjTarget(null);
    }
  };

  // Full-bleed background image, independent of the region image + objects.
  const bgAssetId = ov?.backgroundMediaAssetId;
  const bgAsset = bgAssetId ? media.find((m) => m._id === bgAssetId) : undefined;
  const bgFileRef = useRef<HTMLInputElement>(null);
  const setBackground = (id: string | undefined) =>
    onChange((s) => {
      const overrides = { ...s.overrides };
      if (id) overrides.backgroundMediaAssetId = id;
      else delete overrides.backgroundMediaAssetId;
      return { ...s, overrides };
    });
  const onPickBackground = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const asset = await uploadMedia(businessId, file);
      onUploaded(asset);
      setBackground(asset._id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const asset = await uploadMedia(businessId, file);
      onUploaded(asset);
      attachImage(asset._id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setFocal = (x: number, y: number) =>
    onChange((s) => ({ ...s, overrides: { ...s.overrides, focalPoint: { x, y } } }));

  const treatment: ImageTreatment = slide.overrides?.imageTreatment ?? 'none';
  const setTreatment = (t: ImageTreatment) =>
    onChange((s) => ({ ...s, overrides: { ...s.overrides, imageTreatment: t } }));

  return (
    <div>
      {err && <div className="error-box" style={{ fontSize: 13 }}>{err}</div>}

      {current ? (
        <>
          {/* Compact crop row: the picker no longer dwarfs the actual canvas. */}
          <div style={{ display: 'grid', gridTemplateColumns: '168px 1fr', gap: 10, alignItems: 'start' }}>
            <div>
              <FocalPicker
                url={current.url}
                focal={slide.overrides?.focalPoint}
                onSet={setFocal}
              />
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 3 }}>
                <span className="muted" style={{ fontSize: 10 }}>
                  focal {Math.round((slide.overrides?.focalPoint?.x ?? 0.5) * 100)}% ·{' '}
                  {Math.round((slide.overrides?.focalPoint?.y ?? 0.5) * 100)}%
                </span>
                <button className="icon-btn" title="Reset focal point to center" onClick={() => setFocal(0.5, 0.5)} style={{ width: 'auto', padding: '0 6px', height: 18, fontSize: 11 }}>
                  ⟲
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <span className="muted" style={{ fontSize: 11 }}>Drag the photo to set its focal point — kept in view when cropped.</span>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={slide.overrides?.imageZoom ?? 1}
                  onChange={(e) => setOverride({ imageZoom: Number(e.target.value) })}
                  style={{ flex: 1, width: 'auto', padding: 0 }}
                  aria-label="Image zoom"
                />
                <span className="muted" style={{ fontSize: 11, width: 32, textAlign: 'right' }}>
                  {(slide.overrides?.imageZoom ?? 1).toFixed(1)}×
                </span>
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {(['none', 'tint', 'duotone'] as ImageTreatment[]).map((t) => (
                  <button
                    key={t}
                    className={`btn sm ${treatment === t ? 'primary' : 'ghost'}`}
                    onClick={() => setTreatment(t)}
                  >
                    {t === 'none' ? 'Original' : t === 'tint' ? 'Brand tint' : 'Duotone'}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => setShowLibrary('attach')}>
                  Library…
                </button>
                <button className="btn sm ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  Upload
                </button>
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    if (await confirm({ message: 'Remove this image from the slide?', confirmText: 'Remove', destructive: true }))
                      onChange((s) => ({ ...s, mediaAssetId: undefined }));
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="empty" style={{ padding: 16 }}>
          {busy ? 'Uploading…' : 'No image attached.'}
          <div className="row" style={{ marginTop: 10, justifyContent: 'center', gap: 8 }}>
            <button className="btn sm primary" onClick={() => setShowLibrary('attach')}>
              Choose from library
            </button>
            <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              Upload image
            </button>
          </div>
        </div>
      )}

      {(slide.layoutType === 'SplitImageText' ||
        slide.layoutType === 'CenteredHero' ||
        isFreeLayout(slide.layoutType)) && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {isFreeLayout(slide.layoutType) && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>Background image (full-bleed)</span>
              <div className="row" style={{ gap: 8, marginTop: 4, alignItems: 'center' }}>
                {bgAsset ? (
                  <img src={bgAsset.url} alt="" style={{ width: 42, height: 53, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>None — sits behind the region image &amp; objects.</span>
                )}
                {bgAsset && (
                  <button className="btn sm ghost" onClick={() => setBackground(undefined)}>
                    Remove
                  </button>
                )}
                <button className="btn sm" onClick={() => setShowLibrary('background')} style={{ marginLeft: 'auto' }}>
                  Library…
                </button>
                <button className="btn sm ghost" onClick={() => bgFileRef.current?.click()} disabled={busy}>
                  Upload
                </button>
              </div>
              <input
                ref={bgFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => onPickBackground(e.target.files?.[0])}
              />

              <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 10 }}>
                Image objects
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {objects.map((o, i) => {
                  const url = o.mediaAssetId ? media.find((m) => m._id === o.mediaAssetId)?.url : undefined;
                  const crop = o.crop ?? { x: 0.5, y: 0.5, zoom: 1 };
                  const setCrop = (patch: Partial<{ x: number; y: number; zoom: number }>) =>
                    setObjects(objects.map((x, xi) => (xi === i ? { ...x, crop: { ...crop, ...patch } } : x)));
                  const cover = (o.fit ?? 'cover') === 'cover';
                  return (
                    <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 6, border: '1px solid var(--border)', borderRadius: 8 }}>
                      <div className="row" style={{ gap: 5, alignItems: 'center' }}>
                        {url ? (
                          <img src={url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                        ) : (
                          <div style={{ width: 34, height: 34, borderRadius: 6, border: '1px dashed var(--border)' }} />
                        )}
                        <span className="muted" style={{ fontSize: 12, flex: 1 }}>Image {i + 1}</span>
                        <button className={`btn sm ${cover ? 'primary' : 'ghost'}`} onClick={() => setObjects(objects.map((x, xi) => (xi === i ? { ...x, fit: 'cover' } : x)))} title="Crop to fill">
                          Fill
                        </button>
                        <button className={`btn sm ${o.fit === 'contain' ? 'primary' : 'ghost'}`} onClick={() => setObjects(objects.map((x, xi) => (xi === i ? { ...x, fit: 'contain' } : x)))} title="Show the whole image">
                          Fit
                        </button>
                        <button className="btn sm ghost" onClick={() => { setObjTarget(i); objFileRef.current?.click(); }} disabled={busy}>
                          Replace
                        </button>
                        <button className="icon-btn danger" title="Remove this image" onClick={() => setObjects(objects.filter((_, xi) => xi !== i))}>
                          ✕
                        </button>
                      </div>
                      {url && cover && (
                        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                          <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Zoom</span>
                          <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.05}
                            value={crop.zoom}
                            onChange={(e) => setCrop({ zoom: Number(e.target.value) })}
                            style={{ flex: 1, width: 'auto', padding: 0 }}
                            aria-label={`Image ${i + 1} zoom`}
                          />
                          <span className="muted" style={{ fontSize: 11, width: 30, textAlign: 'right' }}>{crop.zoom.toFixed(1)}×</span>
                        </div>
                      )}
                      {url && cover && crop.zoom > 1 && (
                        <div>
                          <FocalPicker url={url} focal={{ x: crop.x, y: crop.y }} onSet={(x, y) => setCrop({ x, y })} />
                          <span className="muted" style={{ fontSize: 11 }}>Drag to pan the crop.</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button className="btn sm" onClick={() => { setObjTarget('new'); objFileRef.current?.click(); }} disabled={busy}>
                  + Add image
                </button>
                <span className="muted" style={{ fontSize: 11 }}>Added images appear on the canvas — drag and resize them.</span>
              </div>
              <input
                ref={objFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => onPickObject(e.target.files?.[0])}
              />
            </>
          )}
          {slide.layoutType === 'SplitImageText' && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>Split</span>
              <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {SPLIT_PLACEMENTS.map((p) => (
                  <button
                    key={p}
                    className={`btn sm ${(ov?.split ?? defaultSplit) === p ? 'primary' : 'ghost'}`}
                    onClick={() => setOverride({ split: p })}
                  >
                    {SPLIT_LABELS[p]}
                  </button>
                ))}
              </div>
            </>
          )}
          {slide.layoutType === 'CenteredHero' && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>Image aspect</span>
              <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {IMAGE_ASPECTS.map((a) => (
                  <button
                    key={a}
                    className={`btn sm ${(ov?.imageAspect ?? 'square') === a ? 'primary' : 'ghost'}`}
                    onClick={() => setOverride({ imageAspect: a })}
                  >
                    {ASPECT_LABELS[a]}
                  </button>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>Image size</span>
              <div className="row" style={{ gap: 4, marginTop: 4 }}>
                {IMAGE_SIZES.map((sz) => (
                  <button
                    key={sz}
                    className={`btn sm ${(ov?.imageSize ?? 'md') === sz ? 'primary' : 'ghost'}`}
                    onClick={() => setOverride({ imageSize: sz })}
                  >
                    {SIZE_LABELS[sz]}
                  </button>
                ))}
              </div>
            </>
          )}
          <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>Image fit</span>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            {(['cover', 'contain'] as const).map((f) => (
              <button
                key={f}
                className={`btn sm ${(ov?.imageFit ?? 'cover') === f ? 'primary' : 'ghost'}`}
                onClick={() => setOverride({ imageFit: f })}
                title={f === 'contain' ? 'Show the whole image (good for app screenshots)' : 'Crop to fill the frame'}
              >
                {f === 'cover' ? 'Fill' : 'Fit (whole image)'}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        style={{ display: 'none' }}
        onChange={(e) => onPick(e.target.files?.[0])}
      />

      <StockPhotoFinder
        businessId={businessId}
        format={format}
        initialQuery={slide.imageQuery ?? ''}
        onPicked={(asset) => {
          onUploaded(asset);
          attachImage(asset._id);
        }}
      />

      {showLibrary && (
        <MediaLibraryModal
          media={media}
          selectedId={showLibrary === 'background' ? bgAssetId ?? undefined : slide.mediaAssetId}
          onPick={(id) => (showLibrary === 'background' ? setBackground(id) : attachImage(id))}
          onClose={() => setShowLibrary(null)}
        />
      )}
    </div>
  );
}

export function FocalPicker({
  url,
  focal,
  onSet,
}: {
  url: string;
  focal?: { x: number; y: number };
  onSet: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fx = focal?.x ?? 0.5;
  const fy = focal?.y ?? 0.5;

  const apply = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    onSet(Number(x.toFixed(3)), Number(y.toFixed(3)));
  };

  return (
    <div
      ref={ref}
      className="focal"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) apply(e.clientX, e.clientY); // dragging with primary button
      }}
    >
      <img src={url} alt="" draggable={false} />
      <span className="dot" style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }} />
    </div>
  );
}
