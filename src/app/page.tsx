'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyWorkspace, type AgentAction, type AgentContext, type Brand, type Deck, type RunRecord, type Workspace } from '@/lib/schema';
import { downloadJson, streamRequest, jsonRequest } from '@/lib/client';
import { useWorkspace } from '@/lib/useWorkspace';
import type { UsageInfo } from '@/lib/operation';
import { changeSlide, commitDeck, travel } from '@/lib/history';
import { activeDirections, duplicateDirection, directionSummary, generationContext } from '@/lib/directions';
import type { ModelCatalog } from '@/lib/models';
import { appendStage, recordRun, updateRunFeedback } from '@/lib/flow';
import { ModelPicker } from './ModelPicker';
import { CreationFlow } from './CreationFlow';
import { BriefComposer } from './BriefComposer';
import { SlideDirectionsEditor } from './SlideDirectionsEditor';
import { SlidePreview } from './SlidePreview';
import { RevisionReferences } from './RevisionReferences';
import { ContentAgent } from './ContentAgent';
import { useContentAgent } from '@/lib/useContentAgent';
import { actionLabel, agentReferences, appendAgentMessage, validateAgentAction } from '@/lib/agent-state';
import { websiteReferences, selectedReferenceImages, keepReference, removeReference } from '@/lib/references';

type Action = RunRecord['operation'];
export default function Studio() {
  const { workspace, getWorkspace, edit, ready, configured, status, error: saveError, flush, load, recovery, recover, dismissRecovery, backupError } = useWorkspace();
  const { brief, brand, deck, width, height, previous, lastRun } = workspace;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<{ action: Action; started: number; phase: string; record: RunRecord } | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [modelError, setModelError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<{ action: Action; message: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const instruction = workspace.revisionText; const scope = workspace.revisionScope;
  const setInstruction = (text: string) => update({ revisionText: text, revisionTarget: selected });
  const setScope = (value: 'slide' | 'deck') => update({ revisionScope: value, revisionTarget: selected });
  const [useUpdatedBrief, setUseUpdatedBrief] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const [fileError, setFileError] = useState('');
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoredSelection = useRef(false);
  const [customSize, setCustomSize] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [compare, setCompare] = useState(false);
  const [sidebar, setSidebar] = useState<'conversation' | 'controls'>('conversation');
  const active = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const agent = useContentAgent({ getWorkspace, edit, selected, configured, flush, disabled: !ready || !!busy || fileBusy || uploadBusy || status === 'conflict', execute: executeAgentAction });
  const locked = !!busy || agent.busy || fileBusy || uploadBusy || status === 'conflict';
  const preset = width === 1080 && height === 1350 ? 'portrait' : width === 1080 && height === 1080 ? 'square' : 'custom';
  const shownDeck = compare && previous ? previous.deck : deck;
  const shownIndex = shownDeck ? Math.min(selected, shownDeck.slides.length - 1) : 0;
  const directions = activeDirections(workspace);
  const duplicateSlide = duplicateDirection(directions);
  const hasGenerationInstructions = !!brief.trim() || directions.length > 0;
  const generationInstructionsChanged = deck && (brief !== deck.originBrief || JSON.stringify(directions) !== JSON.stringify(deck.originSlideDirections ?? []));
  const selectedImages = websiteReferences(workspace).flatMap(selectedReferenceImages);

  const loadModels = useCallback(async (refresh = false) => {
    setModelsLoading(true); setModelError('');
    try { setCatalog(await jsonRequest<ModelCatalog>(`models${refresh ? '?refresh=1' : ''}`)); }
    catch (error) { setModelError((error as Error).message); }
    finally { setModelsLoading(false); }
  }, []);
  useEffect(() => { if (ready && configured) void loadModels(); }, [ready, configured, loadModels]);
  useEffect(() => { if (ready && !restoredSelection.current) { setSelected(workspace.revisionTarget); restoredSelection.current = true; } }, [ready, workspace.revisionTarget]);
  useEffect(() => { setUrl(brand?.url ?? ''); }, [brand?.url]);
  useEffect(() => {
    if (!busy) return;
    const tick = () => setElapsed(Math.floor((Date.now() - busy.started) / 1000)); tick();
    const timer = setInterval(tick, 1000);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', warn); };
  }, [busy]);
  useEffect(() => () => active.current?.abort(), []);
  function update(patch: Partial<Workspace>) { edit(current => ({ ...current, ...patch })); }

  function modelPicker(action: 'analyze' | 'generate' | 'revise') {
    return <ModelPicker action={action} value={workspace.models[action]} catalog={catalog} error={modelError} loading={modelsLoading}
      onChange={value => update({ models: { ...workspace.models, [action]: value } })} retry={() => void loadModels(true)} />;
  }
  async function run(action: Action, direction: string, work: (signal: AbortSignal, progress: (phase: string) => void, usage: (value: UsageInfo) => void) => Promise<Partial<Workspace> | void>, options?: { source: Workspace; target: number | null; signal: AbortSignal }) {
    if (active.current || status === 'conflict') return false;
    const controller = new AbortController(); active.current = controller;
    const source = options?.source ?? getWorkspace();
    const abort = () => controller.abort(); options?.signal.addEventListener('abort', abort, { once: true });
    if (options?.signal.aborted) controller.abort();
    const started = Date.now(); let usage: UsageInfo = {};
    let phase = 'Saving the current draft…';
    let steps: NonNullable<RunRecord['steps']> = [{ message: phase, elapsedMs: 0 }];
    const aiAction = action === 'analyze' || action === 'generate' || action === 'revise';
    const context = generationContext({ ...source, ...(action === 'revise' ? { instruction: direction, useUpdatedBrief } : {}) });
    const sourceDeck = options ? source.deck : shownDeck;
    const size = action === 'generate' ? source : sourceDeck ?? source;
    const record: RunRecord = { id: crypto.randomUUID(), operation: action, startedAt: new Date(started).toISOString(), durationMs: 0, instruction: direction, outcome: 'success',
      ...(aiAction ? { requestedModel: source.models[action] || catalog?.defaultModel || 'Configured default' } : {}),
      inputs: { brief: action === 'analyze' ? '' : aiAction ? context.brief : sourceDeck?.originBrief ?? '',
        directions: action === 'analyze' ? [] : aiAction ? context.directions : sourceDeck?.originSlideDirections ?? [],
        website: action === 'analyze' ? direction : aiAction ? source.brand?.url ?? null : null,
        websiteNotes: action === 'generate' || action === 'revise' ? source.brand?.notes ?? '' : '',
        references: aiAction && action !== 'analyze' ? websiteReferences(source).map(brand => ({ url: brand.url, notes: brand.notes, images: selectedReferenceImages(brand) })) : [],
        revisionReferences: action === 'revise' ? source.revisionReferences : action === 'generate' ? source.agent.references : [],
        images: action === 'analyze' ? [] : aiAction ? websiteReferences(source).flatMap(selectedReferenceImages) : Object.keys(sourceDeck?.assets ?? {}),
        width: action === 'analyze' ? 1440 : size.width, height: action === 'analyze' ? 1000 : size.height,
        target: action === 'analyze' ? 'Website reference' : action === 'revise' ? options ? options.target === null ? 'Whole deck' : `Slide ${options.target + 1}` : scope === 'slide' ? `Slide ${Math.min(selected, (deck?.slides.length ?? 1) - 1) + 1}` : 'Whole deck' : action === 'generate' ? 'New deck' : `${compare && !options ? 'Previous' : 'Current'} version` },
    };
    const publish = () => setBusy({ action, started, phase, record: { ...record, ...usage, steps, durationMs: Date.now() - started } });
    publish(); setError(null);
    try {
      if (!await flush()) throw new Error('Save the current draft before continuing. See the save message above.');
      controller.signal.throwIfAborted();
      const patch = await work(controller.signal, message => { phase = message; steps = appendStage(steps, message, Date.now() - started); publish(); }, value => {
        usage = { ...usage, ...value, renderMs: (usage.renderMs ?? 0) + (value.renderMs ?? 0), renderCacheHits: (usage.renderCacheHits ?? 0) + (value.renderCacheHits ?? 0) }; publish();
      });
      controller.signal.throwIfAborted();
      const durationMs = Date.now() - started;
      const result = action === 'analyze' ? `Website inspiration ready · ${websiteReferences({ ...workspace, ...patch }).length} reference(s).`
        : action === 'generate' || action === 'revise' ? `${patch?.deck?.slides.length ?? 0} slides ready.`
        : action === 'export' ? 'PNG download prepared.' : 'Render checks complete.';
      const completed: RunRecord = { ...record, ...usage, durationMs, result, steps: appendStage(steps, result, durationMs),
        ...((action === 'generate' || action === 'revise' || action === 'inspect' || action === 'export') ? { output: patch?.deck ?? patch?.previous?.deck ?? sourceDeck ?? undefined } : {}) };
      edit(current => recordRun(current, completed, patch ?? undefined));
      if (!options) edit(current => ({ ...current, agent: { ...current.agent, messages: appendAgentMessage(current.agent.messages, { id: crypto.randomUUID(), role: 'tool', text: `${direction}: ${result}` }) } }));
      if (action === 'generate' || action === 'revise') {
        setCompare(false); setUseUpdatedBrief(false); if (action !== 'revise') setSelected(0);
        requestAnimationFrame(() => { resultHeading.current?.focus({ preventScroll: true }); resultHeading.current?.scrollIntoView({ behavior: 'instant', block: 'start' }); });
      }
      return true;
    } catch (failure) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? 'Stopped. Your current draft is unchanged.' : (failure as Error).message;
      if (!options) setError({ action, message });
      edit(current => recordRun(current, { ...record, ...usage, steps, durationMs: Date.now() - started, outcome: cancelled ? 'cancelled' : 'failed', message }));
      return false;
    } finally { options?.signal.removeEventListener('abort', abort); active.current = null; setBusy(null); }
  }
  function requestAgent(text: string, context: AgentContext = { intent: 'chat', target: selected, url: '' }) {
    setSidebar('conversation');
    void agent.send(text, context, context.intent === 'revise' ? workspace.revisionReferences : undefined);
    requestAnimationFrame(() => {
      const panel = document.getElementById('conversation-panel');
      panel?.focus({ preventScroll: true });
      const exchange = panel?.querySelector('.agent-progress') ?? panel?.querySelector('.agent-log') ?? panel;
      exchange?.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
  }
  async function executeAgentAction(action: AgentAction, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const snapshot = getWorkspace(); const problem = validateAgentAction(action, snapshot); if (problem) throw new Error(problem);
    const images = agentReferences(snapshot).filter(image => action.referenceUrls.includes(image.original));
    if (action.type === 'set_brief') { edit(w => ({ ...w, brief: action.instruction })); return 'The proposed main brief was applied. Per-slide instructions are unchanged.'; }
    if (action.type === 'undo' || action.type === 'redo') { edit(w => travel(w, action.type as 'undo' | 'redo')); setCompare(false); setSelected(0); return `${actionLabel(action)} completed.`; }
    if (['move_earlier', 'move_later', 'duplicate', 'delete'].includes(action.type)) {
      const kind = action.type === 'move_earlier' ? 'earlier' : action.type === 'move_later' ? 'later' : action.type as 'duplicate' | 'delete';
      const next = changeSlide(snapshot.deck!, action.target!, kind); edit(w => ({ ...commitDeck(w, next.deck, actionLabel(action)), revisionTarget: next.index })); setSelected(next.index); setCompare(false); return `${actionLabel(action)} completed. The canvas dimensions were preserved.`;
    }
    const source = { ...snapshot, ...(action.type === 'revise' ? { revisionReferences: images } : {}), ...(action.type === 'generate' ? { agent: { ...snapshot.agent, references: images } } : {}) };
    const ok = await run(action.type as Action, action.type === 'analyze' ? action.url : action.instruction || actionLabel(action), async (toolSignal, progress, usage) => {
      if (action.type === 'analyze') {
        progress('Opening the website…'); return keepReference(snapshot, await streamRequest<Brand>('analyze', { url: action.url, model: snapshot.models.analyze }, toolSignal, progress, usage));
      }
      if (action.type === 'generate' || action.type === 'revise') {
        const revise = action.type === 'revise';
        const next = await streamRequest<Deck>('generate', { ...source, brief: snapshot.brief || action.instruction, previous: null, redo: null, recentRuns: [], lastRun: null,
          agent: { ...snapshot.agent, messages: [], references: [] }, writing: { ...snapshot.writing, messages: [], draft: '' },
          ...(revise ? { instruction: action.instruction, useUpdatedBrief, ...(action.target !== null ? { slideIndex: action.target } : {}) } : { generationTask: action.instruction, generationReferences: images }) }, toolSignal, progress, usage);
        const committed = commitDeck(snapshot, next, action.instruction);
        if (revise && action.target !== null) setSelected(action.target);
        return { deck: committed.deck, previous: committed.previous, redo: committed.redo, lastInstruction: committed.lastInstruction,
          ...(!snapshot.brief && !revise ? { brief: action.instruction } : {}), ...(revise ? { ...(snapshot.agent.messages.filter(m => m.role === 'user').at(-1)?.context?.intent === 'revise' && snapshot.agent.messages.filter(m => m.role === 'user').at(-1)?.text === snapshot.revisionText.trim() ? { revisionText: '' } : {}), revisionReferences: snapshot.revisionReferences.filter(image => !action.referenceUrls.includes(image.original)) } : {}) };
      }
      if (action.type === 'inspect') return { deck: await streamRequest<Deck>('inspect', snapshot.deck, toolSignal, progress, usage) };
      progress('Preparing your PNG download…');
      const response = await fetch(`/api/export${action.target === null ? '' : `?slide=${action.target}`}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot.deck), signal: toolSignal });
      if (!response.ok) throw new Error((await response.json()).error || 'Export failed.');
      const href = URL.createObjectURL(await response.blob()); toolSignal.throwIfAborted(); const link = document.createElement('a'); link.href = href; link.download = action.target === null ? 'slides.zip' : `slide-${action.target + 1}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(href), 60_000);
    }, { source, target: action.target, signal });
    if (!ok) throw new Error(getWorkspace().lastRun?.message || 'The action could not finish. The current deck is unchanged.');
    const current = getWorkspace();
    return action.type === 'analyze' ? `Website analysis completed for ${action.url}. The source notes and images are now available.`
      : action.type === 'export' ? 'The PNG download was prepared.'
      : `${actionLabel(action)} completed. ${current.deck?.slides.length} slides at ${current.deck?.width} × ${current.deck?.height}. Render notes: ${current.deck?.slides.flatMap((s, i) => (s.diagnostics ?? []).map(d => `Slide ${i + 1}: ${d}`)).join('; ') || 'none'}.`;
  }
  function feedback(action: Action) {
    return <div className="action-feedback" aria-live="polite">
      {busy?.action === action ? <div className="progress"><div><strong>{busy.phase}</strong><span>{elapsed}s elapsed</span></div><button type="button" onClick={() => active.current?.abort()}>Stop</button></div> : null}
      {error?.action === action ? <div className="error" role="alert"><p>{error.message}</p><button type="button" className="text-button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    </div>;
  }
  function reset(all = false) {
    if ((brief || deck || workspace.agent.messages.length || workspace.agent.draft.trim() || workspace.agent.references.length || workspace.writing.messages.length || workspace.writing.draft.trim() || workspace.slideDirections.some(item => item.text.trim()) || (all && brand)) && !window.confirm(all ? 'Clear this draft and its website reference?' : 'Start a new deck? Your website inspiration will stay.')) return;
    edit({ ...emptyWorkspace, ...(all ? {} : { brand, references: workspace.references ?? [], width, height, models: workspace.models, writing: { ...emptyWorkspace.writing, autocomplete: workspace.writing.autocomplete } }) });
    setComposerKey(value => value + 1);
    if (all) setUrl('');
    setSelected(0); setCompare(false); setUseUpdatedBrief(false); setEnlarged(null); setError(null); setCustomSize(false); setActualSize(false);
  }
  function reload() {
    if (window.confirm('Load the latest saved draft? Download your local draft first if you need to keep unsaved changes.')) {
      setCompare(false); setComposerKey(value => value + 1); restoredSelection.current = false; void load();
    }
  }
  function download(single = false) {
    if (!shownDeck) return;
    const target = shownDeck; const index = shownIndex; const version = compare ? 'previous' : 'current';
    void run('export', `Export ${version} ${single ? `slide ${index + 1}` : `${target.slides.length} slides`} as PNG`, async (signal, progress, usage) => {
      progress('Rendering PNGs…');
      const response = await fetch(`/api/export${single ? `?slide=${index}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target), signal });
      if (!response.ok) throw new Error((await response.json()).error || 'Export failed. Please try again.');
      usage({ renderMs: Number(response.headers.get('X-Render-Ms')), renderCacheHits: Number(response.headers.get('X-Render-Cache-Hits')) });
      progress('Preparing the download…');
      const href = URL.createObjectURL(await response.blob()); signal.throwIfAborted();
      const link = document.createElement('a'); link.href = href; link.download = single ? `${version}-slide-${index + 1}.png` : `${version}-slides.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    });
  }
  async function savePortable(value = workspace) {
    if (fileBusy || uploadBusy) return; setFileBusy(true); setFileError('');
    try { downloadJson(await jsonRequest('draft', { action: 'save', workspace: value }), 'contentbuilder-portable.json'); }
    catch (error) { setFileError((error as Error).message); }
    finally { setFileBusy(false); }
  }
  async function openPortable(file: File) {
    if (file.size > 64 * 1024 * 1024) { setFileError('Choose a portable draft smaller than 64 MB.'); return; }
    setFileBusy(true); setFileError('');
    try {
      const bundle = JSON.parse(await file.text());
      const imported = await jsonRequest<Workspace>('draft', { action: 'open', bundle });
      if ((brief || deck || brand || workspace.agent.messages.length || workspace.agent.draft.trim() || workspace.agent.references.length || workspace.writing.messages.length || workspace.writing.draft.trim() || workspace.slideDirections.some(item => item.text.trim())) && !window.confirm('Replace this workspace with the opened draft? Save a portable copy first if you want to keep the current draft.')) return;
      edit(imported); setComposerKey(value => value + 1); setSelected(imported.revisionTarget); setCompare(false); setEnlarged(null); setUseUpdatedBrief(false);
    } catch (error) { setFileError(error instanceof SyntaxError ? 'This file is not a valid portable draft.' : (error as Error).message); }
    finally { setFileBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  function slideAction(action: 'earlier' | 'later' | 'duplicate' | 'delete') {
    if (!deck || compare || locked) return;
    requestAgent(`${action === 'delete' ? 'Delete' : action === 'duplicate' ? 'Duplicate' : `Move ${action}`} slide ${shownIndex + 1}. Show me the proposal first.`);
  }
  function inspect() {
    if (!shownDeck) return;
    const target = shownDeck; const wasPrevious = compare;
    void run('inspect', `Check ${wasPrevious ? 'previous' : 'current'} version`, async (signal, progress, usage) => {
      const checked = await streamRequest<Deck>('inspect', target, signal, progress, usage);
      return wasPrevious && previous ? { previous: { ...previous, deck: checked } } : { deck: checked };
    });
  }


  return <>
    <header className="topbar"><a className="wordmark" href="/">ContentBuilder<span className="wordmark-dot" /></a>
      <div className="header-actions"><span className={`save-status ${status}`} role="status">{!ready ? 'Opening…' : status === 'saved' ? 'Saved on this computer' : status === 'saving' ? 'Saving…' : status === 'conflict' ? 'Newer draft in another tab' : 'Not saved'}</span>
        <button onClick={() => reset()} disabled={!ready || locked}>New draft</button>
        <details className="draft-menu"><summary>Draft</summary><div>
          <button disabled={!ready || locked} onClick={() => void savePortable()}>{fileBusy ? 'Preparing file…' : 'Save portable draft'}</button>
          <button disabled={!ready || locked} onClick={() => fileInput.current?.click()}>Open draft…</button>
          <button className="text-button" onClick={() => reset(true)} disabled={!ready || locked}>Reset all</button>
        </div></details><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void openPortable(file); }} /></div>
    </header>
    {recovery ? <div className="save-error"><p>A pending draft from {new Date(recovery.savedAt).toLocaleString()} is available. Restoring replaces this workspace.</p><div><button disabled={locked} onClick={() => { setSelected(recovery.workspace.revisionTarget); setCompare(false); setComposerKey(value => value + 1); recover(); }}>Restore pending draft</button><button disabled={fileBusy} onClick={() => void savePortable(recovery.workspace)}>Save recovery copy</button><button onClick={dismissRecovery}>Dismiss</button></div></div> : null}
    {backupError || fileError ? <div className="save-error" role="alert"><p>{fileError || backupError}</p>{fileError ? <button onClick={() => setFileError('')}>Dismiss</button> : null}</div> : null}
    {ready && saveError ? <div className="save-error" role="alert"><p>{saveError}</p><div>
      <button disabled={fileBusy} onClick={() => void savePortable()}>Save portable draft</button><button onClick={() => downloadJson(workspace)}>Save text-only recovery</button>
      {status === 'conflict' ? <button onClick={reload} disabled={!!busy || agent.busy}>Load saved draft</button> : <button onClick={() => void flush()}>Retry save</button>}
    </div></div> : null}
    {!ready ? <main className="load-state">{saveError ? <><p role="alert">{saveError}</p><button onClick={load}>Retry loading</button></> : <p role="status">Opening your workspace…</p>}</main> : <main className="studio">
      <aside className="brief-panel" aria-label="ContentBuilder agent and brief">
        <div className="workspace-tabs" role="tablist" aria-label="Workspace tools"><button role="tab" aria-selected={sidebar === 'conversation'} aria-controls="conversation-panel" id="conversation-tab" tabIndex={sidebar === 'conversation' ? 0 : -1} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'End'].includes(event.key)) { event.preventDefault(); setSidebar('controls'); document.getElementById('controls-tab')?.focus(); } }} onClick={() => setSidebar('conversation')}>Conversation</button><button role="tab" aria-selected={sidebar === 'controls'} aria-controls="brief-controls" id="controls-tab" tabIndex={sidebar === 'controls' ? 0 : -1} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home'].includes(event.key)) { event.preventDefault(); setSidebar('conversation'); document.getElementById('conversation-tab')?.focus(); } }} onClick={() => setSidebar('controls')}>Brief & settings</button></div>
        <div className="brief-scroll">
        <div id="conversation-panel" role="tabpanel" tabIndex={-1} aria-labelledby="conversation-tab" hidden={sidebar !== 'conversation'}><ContentAgent workspace={workspace} edit={edit} agent={agent} selected={selected} disabled={!!busy || fileBusy || uploadBusy || status === 'conflict'} configured={configured}
          catalog={catalog} modelError={modelError} modelsLoading={modelsLoading} reloadModels={() => void loadModels(true)} onUploadBusy={setUploadBusy} /></div>
        <div id="brief-controls" role="tabpanel" aria-labelledby="controls-tab" hidden={sidebar !== 'controls'}>
        <div className="intro"><h1>What are we making?</h1><p>Your brief leads. Your website inspires.</p></div>
        {!configured ? <p className="notice">Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code>, then restart to enable generation.</p> : null}
        <form onSubmit={event => { event.preventDefault(); requestAgent(`Analyze ${url} as optional inspiration for this post.`, { intent: 'analyze', target: null, url }); }}><fieldset disabled={locked}>
          <label htmlFor="website">Website inspiration <span className="optional">Optional</span></label>
          <div className="input-action"><input id="website" type="url" placeholder="https://yourbrand.com" value={url} onChange={e => setUrl(e.target.value)} required />
            <button type="submit" disabled={!configured || !url.trim()}>Analyze</button></div>
          {modelPicker('analyze')}
          {brand ? <p className="field-hint">Analyze another website to add its identity and images. Your existing references stay available.</p> : null}
        </fieldset></form>{feedback('analyze')}
        {websiteReferences(workspace).map((brand, referenceIndex) => {
          const selectedImages = selectedReferenceImages(brand);
          const update = (patch: { brand: Brand | null }) => edit(current => ({ ...current, ...(patch.brand ? keepReference(current, patch.brand) : removeReference(current, brand.url)) }));
          return <details className="brand-reference" key={brand.url}><summary>{new URL(brand.url).hostname} · {selectedImages.length} image{selectedImages.length === 1 ? '' : 's'} selected</summary>
          <fieldset disabled={locked}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="site-screenshot" src={brand.screenshot} alt={`Website reference from ${new URL(brand.url).hostname}`} />
            <label htmlFor={`brand-notes-${referenceIndex}`}>{referenceIndex ? `Inspiration notes — ${new URL(brand.url).hostname}` : 'Inspiration notes'}</label><textarea id={`brand-notes-${referenceIndex}`} rows={5} value={brand.notes} onChange={e => update({ brand: { ...brand, notes: e.target.value } })} />
            {brand.images.length ? <><div className="image-heading"><span>Images the model may use</span><button className="text-button" type="button" onClick={() => update({ brand: { ...brand, selectedImages: selectedImages.length ? [] : brand.images } })}>{selectedImages.length ? 'Deselect all' : 'Select all'}</button></div>
              <div className="image-picker">{brand.images.map((image, i) => <div key={image} className={selectedImages.includes(image) ? 'chosen' : ''}><label>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.previews.find(p => p.url === image)?.thumbnail ?? image} alt={`Website image ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                <span><input type="checkbox" checked={selectedImages.includes(image)} onChange={event => update({ brand: { ...brand, selectedImages: event.target.checked ? [...selectedImages, image] : selectedImages.filter(url => url !== image) } })} />Image {i + 1}</span></label><button className="image-view" type="button" onClick={() => setEnlarged(enlarged === image ? null : image)}>View image {i + 1}</button>
              </div>)}</div>
              {enlarged && brand.previews.find(p => p.url === enlarged) ? <figure className="image-detail">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.previews.find(p => p.url === enlarged)!.original ?? brand.previews.find(p => p.url === enlarged)!.thumbnail} alt={brand.previews.find(p => p.url === enlarged)!.description || 'Expanded website image'} />
                <figcaption>{brand.previews.find(p => p.url === enlarged)!.description}<br />{brand.previews.find(p => p.url === enlarged)!.width ?? '?'} × {brand.previews.find(p => p.url === enlarged)!.height ?? '?'} px · {brand.previews.find(p => p.url === enlarged)!.original ? 'Original retained' : 'Remote original'}</figcaption><button type="button" onClick={() => setEnlarged(null)}>Close image</button>
              </figure> : null}</> : <p className="field-hint">No usable images were found. The website appearance and notes are still available as inspiration.</p>}
            <button type="button" className="text-button" onClick={() => update({ brand: null })}>Remove website reference</button>
          </fieldset>
        </details>; })}
        <form id="generate-form" className="generation-form" onSubmit={event => { event.preventDefault(); requestAgent('Create slides from my saved main brief and per-slide instructions. Ask if an important detail needs clarification; otherwise show me your proposal.', { intent: 'generate', target: null, url: '' }); }}><fieldset disabled={locked}>
          <BriefComposer key={composerKey} workspace={workspace} edit={edit} disabled={locked} configured={configured} required={!directions.length} showChat={false}
            catalog={catalog} modelError={modelError} modelsLoading={modelsLoading} reloadModels={() => void loadModels(true)} />
          <SlideDirectionsEditor enabled={workspace.slideDirectionsEnabled} directions={workspace.slideDirections} onChange={(slideDirectionsEnabled, slideDirections) => update({ slideDirectionsEnabled, slideDirections })} />
          {duplicateSlide !== undefined ? <p className="error" role="alert">Slide {duplicateSlide} has two instruction fields. Combine them or choose a different slide number.</p> : null}
          {modelPicker('generate')}
          <div className="canvas-controls"><label htmlFor="format">Canvas</label><select id="format" value={customSize ? 'custom' : preset} onChange={e => {
            setCustomSize(e.target.value === 'custom');
            if (e.target.value === 'portrait') update({ width: 1080, height: 1350 });
            if (e.target.value === 'square') update({ width: 1080, height: 1080 });
          }}><option value="portrait">Portrait · 4:5</option><option value="square">Square · 1:1</option><option value="custom">Custom size</option></select>
          {customSize || preset === 'custom' ? <div className="dimensions"><label>Width<input type="number" min={200} max={2400} required value={width || ''} onChange={e => update({ width: Number(e.target.value) })} /></label><span aria-hidden="true">×</span><label>Height<input type="number" min={200} max={2400} required value={height || ''} onChange={e => update({ height: Number(e.target.value) })} /></label><span>px</span></div> : null}
          {deck && (width !== deck.width || height !== deck.height) ? <p className="field-hint">This size applies to the next generation. The current deck stays {deck.width} × {deck.height}.</p> : null}</div>
        </fieldset></form>
      </div></div>{sidebar === 'controls' ? <div className="generate-footer">{feedback('generate')}<button className="primary generate" type="submit" form="generate-form" disabled={locked || !configured || !hasGenerationInstructions || duplicateSlide !== undefined}>{deck ? 'Discuss a new version' : 'Create with the agent'}</button><p className="field-hint">Review the proposal in the conversation before creating slides.</p></div> : null}</aside>

      <section className="preview-panel" aria-label="Slide workspace">
        <CreationFlow active={busy?.record ?? null} elapsedMs={elapsed * 1000} runs={workspace.recentRuns} lastRun={lastRun} disabled={locked}
          onFeedback={(key, feedback) => edit(current => updateRunFeedback(current, key, feedback))} onSave={() => void savePortable()} />
        {deck && shownDeck ? <>
          <div className="deck-toolbar"><div><h2 ref={resultHeading} tabIndex={-1}>{shownDeck.title || 'Untitled deck'}</h2><p>{shownDeck.slides.length} slides · {shownDeck.width} × {shownDeck.height} px</p></div>
            <div className="toolbar-actions">{previous ? <><button disabled={locked} onClick={() => requestAgent('Undo the last slide change. Show me the proposal first.')}>Undo last change</button><button aria-pressed={compare} onClick={() => setCompare(value => !value)}>{compare ? 'Show current' : 'Compare previous'}</button></> : null}{workspace.redo ? <button disabled={locked} onClick={() => requestAgent('Redo the last slide change. Show me the proposal first.')}>Redo last change</button> : null}<button className="primary" onClick={() => download()} disabled={locked}>{compare ? 'Download previous PNGs' : 'Download PNGs'}</button></div></div>
          {feedback('export')}
          <div className="preview-controls"><span>{compare ? 'Previous version' : 'Current version'}</span><div role="group" aria-label="Preview zoom"><button aria-pressed={!actualSize} onClick={() => setActualSize(false)}>Fit</button><button aria-pressed={actualSize} onClick={() => setActualSize(true)}>100%</button></div></div>
          <div className={`canvas-area${actualSize ? ' actual-size' : ''}`}><SlidePreview html={shownDeck.slides[shownIndex].html} width={shownDeck.width} height={shownDeck.height} index={shownIndex} actualSize={actualSize} assets={shownDeck.assets} /></div>
          <nav className="slide-nav" aria-label="Slides" onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? Math.min(shownIndex + 1, shownDeck.slides.length - 1) : event.key === 'ArrowLeft' ? Math.max(0, shownIndex - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? shownDeck.slides.length - 1 : null;
            if (next !== null) { event.preventDefault(); setSelected(next); event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus(); }
          }}>{shownDeck.slides.map((slide, i) => <div className={`thumbnail${shownIndex === i ? ' selected' : ''}`} key={i}>
            <SlidePreview html={slide.html} width={shownDeck.width} height={shownDeck.height} index={i} thumbnail assets={shownDeck.assets} />
            <button aria-current={shownIndex === i ? 'page' : undefined} onClick={() => setSelected(i)}><span>Slide {i + 1}</span></button>
          </div>)}</nav>
          <div className="slide-actions"><span>Slide {shownIndex + 1}</span><details><summary>Slide actions</summary><div>
            <button onClick={() => slideAction('earlier')} disabled={locked || compare || shownIndex === 0}>Move earlier</button>
            <button onClick={() => slideAction('later')} disabled={locked || compare || shownIndex === shownDeck.slides.length - 1}>Move later</button>
            <button onClick={() => slideAction('duplicate')} disabled={locked || compare}>Duplicate</button>
            <button onClick={() => slideAction('delete')} disabled={locked || compare || shownDeck.slides.length === 1}>Delete slide</button>
            <button onClick={() => download(true)} disabled={locked}>Download this PNG</button>
          </div></details><button onClick={inspect} disabled={locked}>Check slides</button></div>
          {feedback('inspect')}
          <details className="diagnostics"><summary>{shownDeck.slides.some(s => s.diagnostics?.length) ? `${shownDeck.slides.filter(s => s.diagnostics?.length).length} slide(s) with review notes` : shownDeck.slides.every(s => s.diagnostics) ? 'Render checks complete · no issues detected' : 'Render checks available'}</summary>
            <p>Checks flag missing assets, failed fonts and possible clipped text. Intentional crops may be flagged; design choices stay yours. Checks do not assess factual accuracy or overall design quality.</p>
            {shownDeck.slides.map((slide, i) => slide.diagnostics?.length ? <div key={i}><button className="text-button" onClick={() => setSelected(i)}>Slide {i + 1}</button><ul>{slide.diagnostics.map((issue, j) => <li key={j}>{issue}</li>)}</ul></div> : null)}
          </details>
          <form className="revision-form" onSubmit={e => { e.preventDefault(); requestAgent(instruction, { intent: 'revise', target: scope === 'slide' ? selected : null, url: '' }); }}>
            <fieldset disabled={locked || compare}><div className="revision-heading"><label htmlFor="revision">What would you change?</label><select aria-label="Revision scope" value={scope} onChange={e => setScope(e.target.value as 'slide' | 'deck')}><option value="slide">Slide {Math.min(selected, deck.slides.length - 1) + 1} only</option><option value="deck">Whole deck</option></select></div>
              <textarea id="revision" rows={3} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Move the headline lower and give the photo more room…" required />
              <RevisionReferences images={workspace.revisionReferences} disabled={locked || compare} onBusyChange={setUploadBusy}
                onAdd={image => edit(current => ({ ...current, revisionTarget: selected, revisionReferences: [...current.revisionReferences.filter(item => item.original !== image.original), image] }))}
                onRemove={original => edit(current => ({ ...current, revisionReferences: current.revisionReferences.filter(image => image.original !== original) }))} />
              {deck.originBrief !== undefined && generationInstructionsChanged ? <label className="check-label"><input type="checkbox" checked={useUpdatedBrief} onChange={e => setUseUpdatedBrief(e.target.checked)} />Use edited main and slide instructions for this revision</label> : null}
              <details className="revision-context"><summary>Instructions used for revisions</summary><p>{directionSummary(useUpdatedBrief ? brief : deck.originBrief ?? brief, useUpdatedBrief ? directions : deck.originSlideDirections ?? [])}</p>{deck.originBrief === undefined ? <p className="field-hint">This older deck has no saved original brief; the current main brief is used.</p> : null}</details>
              {modelPicker('revise')}
              <div className="revision-actions"><span className="field-hint">I’ll review your request and show a proposal before changing the slides.</span><button type="submit" className="primary" disabled={!configured || !instruction.trim() || (useUpdatedBrief && duplicateSlide !== undefined)}>Discuss this change</button></div>
            </fieldset>{feedback('revise')}
            {workspace.lastInstruction ? <details className="last-direction"><summary>Last applied instruction</summary><p>{workspace.lastInstruction}</p></details> : null}
          </form>
        </> : <div className="empty-preview"><div className="empty-sheet"><span>A blank canvas.</span><p>Your direction comes first.</p></div><h2>Your slides will appear here</h2><p>Start with your instructions. Add a website when you want a brand reference.</p></div>}

      </section>
    </main>}
  </>;
}
