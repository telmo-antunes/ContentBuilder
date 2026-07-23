'use client';

import { useState } from 'react';
import type { Block, BlockType, Caption, LayoutType, MediaAsset, Slide } from '@contentbuilder/shared';
import {
  BLOCK_TYPES,
  BLOCK_LABELS,
  SELECTABLE_LAYOUT_TYPES,
  LAYOUT_DESCRIPTIONS,
  LAYOUT_LABELS,
  isFreeLayout,
  isListBlock,
  layoutWantsImage,
  suggestLayoutForBlocks,
  applyBrandLayout,
} from '@contentbuilder/shared';
import {
  updateProject,
  generateProjectCaption,
  getSlideAlternatives,
  type ProjectDetail,
} from '../../../lib/api';
import { SlideRenderer } from '../../../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../../../lib/render/SlideFrame';
import { resolveSlideImage, resolveImageLayout } from '../../../../lib/render/projectRender';
import type { RenderBrandKit } from '../../../../lib/render/types';
import { parseTags } from './lib';
import { Section } from './primitives';
import { ImageControls } from './media';

/**
 * The post's social caption + hashtags, written in the brand voice. Self-contained:
 * it persists via updateProject({caption}) on blur and Regenerate hits the caption
 * endpoint — independent of the slide autosave/undo history.
 */
export function CaptionPanel({
  projectId,
  initial,
  hasSlides,
}: {
  projectId: string;
  initial?: Caption;
  hasSlides: boolean;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [tags, setTags] = useState((initial?.hashtags ?? []).join(' '));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const persist = async (nextText: string, nextTags: string) => {
    setErr(null);
    try {
      await updateProject(projectId, { caption: { text: nextText, hashtags: parseTags(nextTags) } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await generateProjectCaption(projectId);
      setText(p.caption?.text ?? '');
      setTags((p.caption?.hashtags ?? []).join(' '));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    const full = [text, parseTags(tags).join(' ')].filter(Boolean).join('\n\n');
    if (!full) return;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const chips = parseTags(tags);

  return (
    <div className="panel inspector-panel" style={{ marginTop: 0 }}>
      <Section title="Caption">
      <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
          <button
            className="btn sm ghost"
            onClick={regenerate}
            disabled={busy || !hasSlides}
            title="Write a caption in the brand voice from the current slides"
          >
            {busy ? 'Writing…' : '✦ Regenerate'}
          </button>
          <button className="btn sm" onClick={copyAll} disabled={!text && !tags.trim()}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
      </div>
      {err && (
        <div className="error-box" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      <textarea
        value={text}
        rows={6}
        placeholder={
          hasSlides
            ? 'Generate a caption in your brand voice, or write your own.'
            : 'Add slides first, then generate a caption.'
        }
        onChange={(e) => setText(e.target.value)}
        onBlur={() => persist(text, tags)}
        style={{ marginTop: 8, width: '100%' }}
      />
      <div className="section-label" style={{ marginTop: 8 }}>
        Hashtags
      </div>
      <input
        value={tags}
        placeholder="#brand #topic"
        onChange={(e) => setTags(e.target.value)}
        onBlur={() => persist(text, tags)}
      />
      {chips.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {chips.map((t) => (
            <span key={t} className="badge">
              {t}
            </span>
          ))}
        </div>
      )}
      </Section>
    </div>
  );
}

/**
 * The brand's OWN layouts (from the approved kit's package), format-matched to
 * the project. Each tile previews THIS slide's copy poured into that layout —
 * click to apply it (structure + decorations + its matched background), keeping
 * your copy and image. Undoable like any slide mutation. Nothing renders when
 * the brand has no library yet.
 */
export function BrandLayoutPicker({
  slide,
  detail,
  media,
  kit,
  onChange,
}: {
  slide: Slide;
  detail: ProjectDetail;
  media: MediaAsset[];
  kit: RenderBrandKit;
  onChange: (fn: (s: Slide) => Slide) => void;
}) {
  const lib = detail.brandKit?.layoutLibrary;
  const isStory = detail.format === '1080x1920';
  const layouts = (isStory ? lib?.story : lib?.post) ?? lib?.post ?? [];
  if (layouts.length === 0) return null;
  const bgUrl = (id?: string) => (id ? media.find((m) => m._id === id)?.url : undefined);

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>
        Brand layouts — this brand&rsquo;s own designs; click one to apply it to this slide
      </p>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {layouts.map((t, i) => {
          const preview = applyBrandLayout(slide, t as never);
          return (
            <button
              key={`${t.name}-${i}`}
              onClick={() => onChange((s) => applyBrandLayout(s, t as never))}
              title={`Apply “${t.name}”`}
              style={{ flex: '0 0 auto', padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'none' }}
            >
              <ScaledSlide format={detail.format} displayWidth={isStory ? 64 : 84}>
                <SlideRenderer
                  slide={{ layoutType: 'FreePosition', blocks: preview.blocks }}
                  brandKit={kit}
                  format={detail.format}
                  image={resolveSlideImage(preview, media)}
                  imageLayout={{
                    imageFrame: preview.overrides?.imageFrame,
                    background: preview.overrides?.imageBackground,
                    decorations: preview.overrides?.decorations,
                    backgroundUrl: bgUrl(preview.overrides?.backgroundMediaAssetId),
                  }}
                  theme={detail.settings?.theme}
                  forExport
                />
              </ScaledSlide>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SlideInspector({
  slide,
  detail,
  media,
  onChange,
  onDelete,
  onUploaded,
  selectedTarget,
  onSelectTarget,
  onConvertToCanvas,
  kit,
}: {
  slide: Slide;
  detail: ProjectDetail;
  media: MediaAsset[];
  onChange: (fn: (s: Slide) => Slide) => void;
  onDelete: () => void;
  onUploaded: (asset: MediaAsset) => void;
  selectedTarget: string | null;
  onSelectTarget: (id: string | null) => void;
  onConvertToCanvas: () => void;
  kit: RenderBrandKit;
}) {
  const wantsImage =
    layoutWantsImage(slide.layoutType) || isFreeLayout(slide.layoutType) || slide.imageNeed === 'upload';

  const setLayout = (layoutType: LayoutType) =>
    onChange((s) => ({
      ...s,
      layoutType,
      imageNeed: layoutWantsImage(layoutType) ? 'upload' : 'none',
    }));

  const setBlocks = (blocks: Block[]) => onChange((s) => ({ ...s, blocks }));

  return (
    <div className="panel inspector-panel">
      <Section title="Layout">
        {isFreeLayout(slide.layoutType) ? (
          <div className="hint-box">Free canvas — drag blocks in the preview</div>
        ) : (
          <>
            <select value={slide.layoutType} onChange={(e) => setLayout(e.target.value as LayoutType)}>
              {SELECTABLE_LAYOUT_TYPES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <button
              className="btn sm"
              style={{ marginTop: 8, width: '100%' }}
              onClick={onConvertToCanvas}
              title="Everything stays exactly where it is — then you can drag any element freely"
            >
              ⇢ Convert to free canvas
            </button>
            {(() => {
              // Rule-based nudge (zero AI): when the slide's CONTENT clearly
              // suits a different layout, say so — with a one-click apply.
              const suggestion = suggestLayoutForBlocks(
                slide.blocks,
                slide.layoutType,
                Boolean(slide.mediaAssetId) || slide.imageNeed === 'upload',
              );
              if (!suggestion) return null;
              return (
                <div className="hint-box" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12 }}>
                    Suggested: <strong>{LAYOUT_LABELS[suggestion.layoutType]}</strong> — {suggestion.reason}
                  </span>
                  <button type="button" className="btn sm" onClick={() => setLayout(suggestion.layoutType)}>
                    Apply
                  </button>
                </div>
              );
            })()}
          </>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {LAYOUT_DESCRIPTIONS[slide.layoutType]}{' '}
          <a href="/gallery" target="_blank" rel="noreferrer" style={{ whiteSpace: 'nowrap' }}>
            See all layouts ↗
          </a>
        </p>
        <BrandLayoutPicker slide={slide} detail={detail} media={media} kit={kit} onChange={onChange} />
      </Section>

      {wantsImage && (
        <Section title="Image">
          <ImageControls slide={slide} format={detail.format} businessId={detail.businessId} media={media} onChange={onChange} onUploaded={onUploaded} />
        </Section>
      )}

      <Section title="Content" count={slide.blocks.length}>
        <BlockList blocks={slide.blocks} onChange={setBlocks} selectedTarget={selectedTarget} onSelectTarget={onSelectTarget} />
      </Section>

      <Section title="Alternatives" defaultOpen={false}>
        <AlternativesSection slide={slide} detail={detail} media={media} kit={kit} onChange={onChange} />
      </Section>

      <div className="insp-danger">
        <button className="btn danger sm" onClick={onDelete}>
          Delete this {detail.type === 'story' ? 'frame' : 'slide'}
        </button>
      </div>
    </div>
  );
}

/**
 * Per-slide layout alternatives (G6): one AI call proposes 3 structures for the
 * SAME copy (the server merges structure onto the original blocks, so the text
 * can't drift). Applying is a normal undoable slide mutation.
 */
export function AlternativesSection({
  slide,
  detail,
  media,
  kit,
  onChange,
}: {
  slide: Slide;
  detail: ProjectDetail;
  media: MediaAsset[];
  kit: RenderBrandKit;
  onChange: (fn: (s: Slide) => Slide) => void;
}) {
  const [alts, setAlts] = useState<Slide[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAlts = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await getSlideAlternatives(detail._id, slide.id);
      setAlts(r.alternatives);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = (alt: Slide) =>
    onChange((s) => ({
      ...s,
      layoutType: alt.layoutType,
      blocks: alt.blocks,
      imageNeed: alt.imageNeed,
      overrides: alt.overrides,
    }));

  return (
    <div>
      {alts && alts.length > 0 && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          {alts.map((alt, i) => (
            <button
              key={i}
              onClick={() => apply(alt)}
              title="Apply this layout (undoable)"
              style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'none' }}
            >
              <ScaledSlide format={detail.format} displayWidth={92}>
                <SlideRenderer
                  slide={alt}
                  brandKit={kit}
                  format={detail.format}
                  image={resolveSlideImage(alt, media)}
                  imageLayout={resolveImageLayout(alt, media)}
                  theme={alt.overrides?.theme}
                  forExport
                />
              </ScaledSlide>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
      )}
      <button className="btn sm" onClick={fetchAlts} disabled={busy}>
        {busy ? 'Designing…' : alts ? '↻ New alternatives' : '✦ Suggest 3 layouts'}
      </button>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        Same copy, different structure — click one to apply it (undo brings the old layout back).
      </p>
    </div>
  );
}

export function BlockList({
  blocks,
  onChange,
  selectedTarget,
  onSelectTarget,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  selectedTarget?: string | null;
  onSelectTarget?: (id: string | null) => void;
}) {
  const [addType, setAddType] = useState<BlockType>('paragraph');

  const update = (i: number, fn: (b: Block) => Block) =>
    onChange(blocks.map((b, idx) => (idx === i ? fn(b) : b)));
  const remove = (i: number) => onChange(blocks.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    const block: Block = isListBlock(addType)
      ? { type: addType, text: '', items: [''] }
      : { type: addType, text: '' };
    onChange([...blocks, block]);
  };
  const changeType = (i: number, type: BlockType) =>
    update(i, (b) => {
      if (isListBlock(type)) return { type, text: '', items: b.items?.length ? b.items : [''] };
      return { type, text: b.text || (b.items?.join(', ') ?? '') };
    });

  return (
    <div>
      {blocks.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No blocks yet.</p>}
      {blocks.map((b, i) => (
        <div
          className={`block-card ${selectedTarget === `b${i}` ? 'selected' : ''}`}
          key={i}
          onPointerDown={() => onSelectTarget?.(`b${i}`)}
        >
          <div className="block-head">
            <select value={b.type} onChange={(e) => changeType(i, e.target.value as BlockType)}>
              {BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BLOCK_LABELS[t]}
                </option>
              ))}
            </select>
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              ↑
            </button>
            <button
              className="icon-btn"
              disabled={i === blocks.length - 1}
              onClick={() => move(i, 1)}
              title="Move down"
            >
              ↓
            </button>
            <button className="icon-btn danger" onClick={() => remove(i)} title="Remove block" aria-label="Remove block">
              ✕
            </button>
          </div>
          {isListBlock(b.type) ? (
            <ListItemsEditor
              items={b.items ?? []}
              onChange={(items) => update(i, (bl) => ({ ...bl, items }))}
            />
          ) : (
            <textarea
              value={b.text}
              placeholder={`${BLOCK_LABELS[b.type]} text…`}
              onChange={(e) => update(i, (bl) => ({ ...bl, text: e.target.value }))}
            />
          )}
        </div>
      ))}

      <div className="row" style={{ marginTop: 4 }}>
        <select value={addType} onChange={(e) => setAddType(e.target.value as BlockType)} style={{ flex: 1 }}>
          {BLOCK_TYPES.map((t) => (
            <option key={t} value={t}>
              {BLOCK_LABELS[t]}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={add}>
          + Add block
        </button>
      </div>
    </div>
  );
}

export function ListItemsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div>
      {items.map((it, i) => (
        <div className="row" key={i} style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
          <input
            value={it}
            placeholder={`Item ${i + 1}`}
            onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))}
          />
          <button
            className="icon-btn danger"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            title="Remove item"
            aria-label="Remove list item"
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => onChange([...items, ''])}>
        + Add item
      </button>
    </div>
  );
}
