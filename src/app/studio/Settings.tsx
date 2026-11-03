'use client';
import { useRef, useState } from 'react';
import type { Brand, Kit, Workspace } from '@/lib/schema';
import { MAX_REVISION_REFERENCES } from '@/lib/schema';
import { useUploads } from './useUploads';
import type { ModelCatalog } from '@/lib/models';
import { keepReference, removeReference, selectedReferenceImages, websiteReferences } from '@/lib/references';
import { ModelPicker } from '../ModelPicker';
import { Formats } from './Formats';
import { Icon } from './Icon';
import { addProfile, brandList, MAX_BRANDS, removeProfile, switchProfile } from '@/lib/profiles';
import { dollars } from '@/lib/pricing';

type Props = {
  workspace: Workspace; edit: (change: (current: Workspace) => Workspace) => void; locked: boolean; configured: boolean;
  catalog: ModelCatalog | null; modelError: string; modelsLoading: boolean; reloadModels: () => void;
  analyzing: string | null; onAnalyze: (url: string) => void;
  direct: boolean; onDirect: (value: boolean) => void;
  fileBusy: boolean; onSavePortable: () => void; onOpenPortable: (file: File) => void; onNew: () => void; onDrafts: () => void; onResetAll: () => void;
  onCheck: () => void; checking: boolean;
};

// Everything optional lives here, so the main screen only needs the command bar.
export function Settings(props: Props) {
  const { workspace, edit, locked, configured, catalog, modelError, modelsLoading, reloadModels, analyzing, onAnalyze, direct, onDirect } = props;
  const [url, setUrl] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const kit = workspace.kit;
  const setKit = (patch: Partial<Kit>) => edit(current => ({ ...current, kit: { ...current.kit, ...patch } }));
  const pins = useUploads({ count: workspace.pinned.length, onBusyChange: setPinBusy,
    onAdd: image => edit(current => ({ ...current, pinned: [...current.pinned.filter(item => item.original !== image.original), image].slice(-MAX_REVISION_REFERENCES) })) });
  const pinInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const references = websiteReferences(workspace);
  const brands = brandList(workspace);
  const deck = workspace.deck;
  const notes = deck?.slides.flatMap((slide, i) => (slide.diagnostics ?? []).map(note => ({ slide: i + 1, note }))) ?? [];
  const update = (brand: Brand, patch: Brand | null) => edit(current => ({ ...current, ...(patch ? keepReference(current, patch) : removeReference(current, brand.url)) }));
  const picker = (action: 'agent' | 'generate' | 'revise' | 'analyze') => <ModelPicker action={action} value={workspace.models[action]} catalog={catalog} error={modelError} loading={modelsLoading}
    retry={reloadModels} onChange={model => edit(current => ({ ...current, models: { ...current.models, [action]: model } }))} />;

  return <div className="settings">
    <section className="tile">
      <h3>Format</h3>
      <Formats width={workspace.width} height={workspace.height} disabled={locked} onChange={size => edit(current => ({ ...current, ...size }))} />
      {deck && (deck.width !== workspace.width || deck.height !== workspace.height) ? <p className="hint">Applies to your next new post. This one stays {deck.width} × {deck.height}.</p> : null}
    </section>

    <section className="tile">
      <h3><Icon name="sparkle" size={18} />Posting as</h3>
      <p className="hint">Each brand keeps its own kit, websites, lessons and pinned inspiration. Switching keeps the post you’re working on.</p>
      <div className="brand-chips" role="radiogroup" aria-label="Brand">{brands.map(item => <button type="button" key={item.id} role="radio" aria-checked={item.active} className={`chip brand-chip${item.active ? ' on' : ''}`}
        disabled={locked} onClick={() => edit(current => switchProfile(current, item.id))}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {item.logo ? <img src={item.logo} alt="" /> : <span className="brand-initial" aria-hidden="true">{item.name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>}{item.name}</button>)}
        {brands.length < MAX_BRANDS ? <button type="button" className="chip" disabled={locked} onClick={() => edit(addProfile)}><Icon name="plus" size={14} />New brand</button> : null}</div>
      {brands.length > 1 ? <button type="button" className="link danger" disabled={locked} onClick={() => { if (window.confirm(`Forget ${brands.find(item => item.active)?.name}, with its kit, websites and lessons?`)) edit(removeProfile); }}>Forget this brand</button> : null}
    </section>

    <section className="tile">
      <h3><Icon name="globe" size={18} />Brand &amp; inspiration</h3>
      <p className="hint">Paste a website and ContentBuilder borrows its look and images. You can also just paste a link in the bar.</p>
      <form className="inline-form" onSubmit={event => { event.preventDefault(); if (url.trim()) { onAnalyze(url.trim()); setUrl(''); } }}>
        <input type="url" inputMode="url" placeholder="https://yourbrand.com" value={url} onChange={event => setUrl(event.target.value)} disabled={locked || !configured} aria-label="Website to learn from" />
        <button className="button primary" disabled={locked || !configured || !url.trim()}>{analyzing ? <span className="spinner" /> : 'Learn'}</button>
      </form>
      {analyzing ? <p className="hint live" role="status">{analyzing}</p> : null}
      {references.map(brand => {
        const chosen = selectedReferenceImages(brand);
        const host = hostOf(brand.url);
        return <details className="reference" key={brand.url}>
          <summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.screenshot} alt="" width={56} height={40} />
            <span><strong>{host}</strong><small>{chosen.length} of {brand.images.length} images in use</small></span>
            <Icon name="right" size={16} className="chev" />
          </summary>
          <label className="field-label" htmlFor={`notes-${host}`}>What we noticed</label>
          <textarea id={`notes-${host}`} rows={5} value={brand.notes} disabled={locked} onChange={event => update(brand, { ...brand, notes: event.target.value })} />
          {brand.images.length ? <>
            <div className="field-row"><span className="field-label">Images it may use</span>
              <button type="button" className="link" disabled={locked} onClick={() => update(brand, { ...brand, selectedImages: chosen.length ? [] : brand.images })}>{chosen.length ? 'None' : 'All'}</button></div>
            <div className="image-grid">{brand.images.map((image, i) => {
              const on = chosen.includes(image);
              return <button type="button" key={image} className={`pick${on ? ' on' : ''}`} aria-pressed={on} disabled={locked} aria-label={`Image ${i + 1}`}
                onClick={() => update(brand, { ...brand, selectedImages: on ? chosen.filter(item => item !== image) : [...chosen, image] })}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.previews.find(preview => preview.url === image)?.thumbnail ?? image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span className="tick"><Icon name="check" size={14} /></span>
              </button>;
            })}</div>
          </> : <p className="hint">No usable images found. The look and notes still help.</p>}
          <button type="button" className="link danger" disabled={locked} onClick={() => update(brand, null)}>Forget {host}</button>
        </details>;
      })}
    </section>

    <section className="tile">
      <h3><Icon name="sparkle" size={18} />Brand kit</h3>
      <p className="hint">Every post for this brand starts from this, and it stays when you start a new post. Learning a website fills the empty fields.</p>
      <div className="kit-grid">
        <label className="field"><span className="field-label">Instagram handle</span>
          <input value={kit.handle} disabled={locked} placeholder="@yourbrand" onChange={event => setKit({ handle: event.target.value.replace(/^@/, '') })} /></label>
        <label className="field"><span className="field-label">Fonts</span>
          <input value={kit.fonts.join(', ')} disabled={locked} placeholder="Poppins, Inter" onChange={event => setKit({ fonts: event.target.value.split(',').map(item => item.trimStart()).filter((item, i, all) => item || i === all.length - 1).slice(0, 6) })} /></label>
      </div>
      <div className="field"><span className="field-label">Colours</span>
        <div className="swatches">{kit.colors.map((color, i) => <span className="swatch" key={i}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'} disabled={locked} aria-label={`Colour ${i + 1}`} onChange={event => setKit({ colors: kit.colors.map((item, j) => j === i ? event.target.value : item) })} />
          <button type="button" aria-label={`Remove colour ${color}`} disabled={locked} onClick={() => setKit({ colors: kit.colors.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button></span>)}
          {kit.colors.length < 12 ? <button type="button" className="swatch add" aria-label="Add a colour" disabled={locked} onClick={() => setKit({ colors: [...kit.colors, '#5b5bf6'] })}><Icon name="plus" size={16} /></button> : null}</div></div>
      <label className="field"><span className="field-label">Voice</span>
        <textarea rows={2} value={kit.voice} disabled={locked} placeholder="Calm, expert, a little playful. Speaks to studio owners as peers." onChange={event => setKit({ voice: event.target.value })} /></label>
      <label className="field"><span className="field-label">Always and never</span>
        <textarea rows={2} value={kit.rules} disabled={locked} placeholder="Always European Portuguese. Never use “barato”. Logo top-left." onChange={event => setKit({ rules: event.target.value })} /></label>
      {kit.logo ? <div className="field-row"><span className="kit-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={kit.logo} alt="Brand logo" /><span className="field-label">Logo</span></span>
        <button type="button" className="link danger" disabled={locked} onClick={() => setKit({ logo: undefined })}>Remove</button></div> : null}
      {kit.lessons.length ? <div className="field"><span className="field-label">Learned from your changes</span>
        <ul className="lessons">{kit.lessons.map(lesson => <li key={lesson}><span>{lesson}</span>
          <button type="button" aria-label={`Forget: ${lesson}`} disabled={locked} onClick={() => setKit({ lessons: kit.lessons.filter(item => item !== lesson) })}><Icon name="close" size={12} /></button></li>)}</ul></div> : null}
    </section>

    <section className="tile">
      <h3><Icon name="pin" size={18} />Pinned inspiration</h3>
      <p className="hint">Posts or images whose look you love. Every new post learns from their style, never their content.</p>
      {workspace.pinned.length ? <div className="image-grid">{workspace.pinned.map(image => <span className="pick on pinned" key={image.original}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.thumbnail} alt={image.name} />
        <button type="button" aria-label={`Unpin ${image.name}`} disabled={locked} onClick={() => edit(current => ({ ...current, pinned: current.pinned.filter(item => item.original !== image.original) }))}><Icon name="close" size={12} /></button></span>)}</div> : null}
      <div className="field-row"><span className="hint">{pins.progress || pins.error || `${workspace.pinned.length} of ${MAX_REVISION_REFERENCES}`}</span>
        <button type="button" className="button" disabled={locked || pinBusy || workspace.pinned.length >= MAX_REVISION_REFERENCES} onClick={() => pinInput.current?.click()}><Icon name="plus" size={16} />Add images</button></div>
      <input ref={pinInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void pins.upload(files); }} />
    </section>

    <section className="tile">
      <h3>Brief for this post</h3>
      <p className="hint">Filled in from your first message. Edit it to steer every change that follows: audience, tone, exact wording.</p>
      <textarea rows={4} value={workspace.brief} disabled={locked} placeholder="e.g. For detailing studio owners in Portugal. Write in European Portuguese. Calm, expert, no hype."
        onChange={event => { const brief = event.target.value; edit(current => ({ ...current, brief })); }} aria-label="Brief for this post" />
    </section>

    <section className="tile">
      <h3>How it works with you</h3>
      <label className="toggle"><input type="checkbox" checked={!direct} onChange={event => onDirect(!event.target.checked)} />
        <span className="switch" aria-hidden="true" /><span><strong>Ask before changing slides</strong><small>Off: changes happen straight away and you can undo them.</small></span></label>
      <label className="toggle"><input type="checkbox" checked={workspace.polish} disabled={locked} onChange={event => { const polish = event.target.checked; edit(current => ({ ...current, polish })); }} />
        <span className="switch" aria-hidden="true" /><span><strong>Polish pass</strong><small>After a new post or a whole-post change, the AI looks at the result at phone size and fixes clipped text, small type and weak contrast. One extra call.</small></span></label>
      {deck ? <div className="field-row">
        <span><strong>Render checks</strong><small className="block">{notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} on this post` : 'Missing images, fonts and clipped text.'}</small></span>
        <button type="button" className="button" disabled={locked} onClick={props.onCheck}>{props.checking ? <span className="spinner" /> : 'Check now'}</button>
      </div> : null}
      {notes.length ? <ul className="notes">{notes.map((item, i) => <li key={i}><b>Slide {item.slide}</b> {item.note}</li>)}</ul> : null}
    </section>

    <section className="tile">
      <details className="models">
        <summary><h3>AI models</h3><Icon name="right" size={16} className="chev" /></summary>
        <p className="hint">The defaults pick the newest model in each family. Change them only if you need to.</p>
        {picker('agent')}{picker('generate')}{picker('revise')}{picker('analyze')}
      </details>
    </section>

    <section className="tile">
      <h3>AI cost</h3>
      <p className="hint">An estimate from the tokens each call used, at Anthropic’s list prices.</p>
      <div className="field-row"><span><strong>{dollars(workspace.spend.post)}</strong><small className="block">this post</small></span>
        <span><strong>{dollars(workspace.spend.total)}</strong><small className="block">{workspace.spend.since ? `since ${new Date(workspace.spend.since).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : 'in total'}</small></span>
        <button type="button" className="link" disabled={!workspace.spend.total} onClick={() => edit(current => ({ ...current, spend: { post: current.spend.post, total: 0, since: '' } }))}>Reset total</button></div>
    </section>

    <section className="tile">
      <h3>This draft</h3>
      <div className="button-grid">
        <button type="button" className="button" disabled={locked} onClick={props.onNew}><Icon name="plus" size={16} />New post</button>
        <button type="button" className="button" disabled={locked} onClick={props.onDrafts}><Icon name="layers" size={16} />Drafts</button>
        <button type="button" className="button" disabled={locked || props.fileBusy} onClick={props.onSavePortable}><Icon name="download" size={16} />{props.fileBusy ? 'Preparing…' : 'Save a copy'}</button>
        <button type="button" className="button" disabled={locked || props.fileBusy} onClick={() => fileInput.current?.click()}><Icon name="layers" size={16} />Open a copy</button>
        <button type="button" className="button ghost danger" disabled={locked} onClick={props.onResetAll}><Icon name="trash" size={16} />Reset everything</button>
      </div>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) props.onOpenPortable(file); }} />
    </section>
  </div>;
}

export function hostOf(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
