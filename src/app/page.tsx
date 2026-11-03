'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { emptyWorkspace, type AgentAction, type Brand, type Deck, type RunRecord, type Workspace } from '@/lib/schema';
import { downloadJson, streamRequest, jsonRequest } from '@/lib/client';
import { useWorkspace } from '@/lib/useWorkspace';
import type { UsageInfo } from '@/lib/operation';
import { changeSlide, commitDeck, travel } from '@/lib/history';
import type { ModelCatalog } from '@/lib/models';
import { appendStage, recordRun } from '@/lib/flow';
import { useContentAgent } from '@/lib/useContentAgent';
import { actionLabel, agentContextKey, agentReferences, validateAgentAction } from '@/lib/agent-state';
import { websiteReferences, keepReference } from '@/lib/references';
import { Stage, type StageWork } from './studio/Stage';
import { CommandBar } from './studio/CommandBar';
import { Sheet } from './studio/Sheet';
import { Choices, Proposal, Thread } from './studio/Thread';
import { Settings, hostOf } from './studio/Settings';
import { Formats } from './studio/Formats';
import { Icon } from './studio/Icon';

type Action = RunRecord['operation'];
type Busy = { action: Action; started: number; phase: string; target: number | null };
type Toast = { id: number; text: string; undo?: 'undo' | 'redo'; tone?: 'error' };

const starters = [
  '5-slide carousel: the mistakes that cost detailing studios their regulars',
  'Story announcing we’re open this Saturday, 9:00–13:00',
  'Before/after post for a full interior detail, bold and minimal',
  'Quote card from a happy client, big serif type',
];
const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 48);

export default function Studio() {
  const { workspace, getWorkspace, edit, ready, configured, status, error: saveError, flush, load, recovery, recover, dismissRecovery, backupError } = useWorkspace();
  const { deck, previous, redo, width, height } = workspace;
  const [busy, setBusy] = useState<Busy | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [modelError, setModelError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const [slideScope, setSlideScope] = useState(false);
  const [sheet, setSheet] = useState<'thread' | 'settings' | null>(null);
  const [peek, setPeek] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [direct, setDirectState] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [seen, setSeen] = useState('');
  const active = useRef<AbortController | null>(null);
  const restored = useRef(false);
  const agent = useContentAgent({ getWorkspace, edit, selected, configured, flush, direct, disabled: !ready || !!busy || fileBusy || uploadBusy || status === 'conflict', execute: executeAgentAction });
  const locked = !!busy || agent.busy || fileBusy || uploadBusy || status === 'conflict';
  const shownDeck = peek && previous ? previous.deck : deck;
  const index = shownDeck ? Math.min(selected, shownDeck.slides.length - 1) : 0;
  const handle = workspace.brand ? hostOf(workspace.brand.url).split('.')[0] : 'yourbrand';
  const messages = workspace.agent.messages;
  // The newest assistant reply since the user last spoke, floated above the bar.
  const reply = [...messages].reverse().find((message, i, newest) => message.role === 'assistant' && !newest.slice(0, i).some(item => item.role === 'user'));
  const showReply = !!reply && reply.id !== seen && sheet !== 'thread' && !agent.busy;
  const unread = messages.filter(message => message.role === 'assistant').length;
  const contextKey = agentContextKey(workspace, selected);

  const loadModels = useCallback(async (refresh = false) => {
    setModelsLoading(true); setModelError('');
    try { setCatalog(await jsonRequest<ModelCatalog>(`models${refresh ? '?refresh=1' : ''}`)); }
    catch (failure) { setModelError((failure as Error).message); }
    finally { setModelsLoading(false); }
  }, []);
  useEffect(() => { if (ready && configured) void loadModels(); }, [ready, configured, loadModels]);
  // A reply from an earlier session stays in the conversation, not floating over the post.
  useEffect(() => { if (ready && !restored.current) { setSelected(workspace.revisionTarget); setSeen(reply?.id ?? ''); restored.current = true; } }, [ready, workspace.revisionTarget, reply?.id]);
  useEffect(() => { try { setDirectState(localStorage.getItem('contentbuilder-direct') !== 'off'); } catch { /* defaults to direct */ } }, []);
  useEffect(() => { if (deck && selected > deck.slides.length - 1) setSelected(deck.slides.length - 1); }, [deck, selected]);
  useEffect(() => { if (!previous) setPeek(false); }, [previous]);
  useEffect(() => { if (agent.error) setToast({ id: Date.now(), text: agent.error, tone: 'error' }); }, [agent.error]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(current => current?.id === toast.id ? null : current), toast.tone === 'error' ? 9000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  useEffect(() => () => active.current?.abort(), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  function setDirect(value: boolean) { setDirectState(value); try { localStorage.setItem('contentbuilder-direct', value ? 'on' : 'off'); } catch { /* per-browser preference only */ } }
  function notify(text: string, undo?: Toast['undo']) { setToast({ id: Date.now(), text, undo }); }

  async function run(action: Action, label: string, work: (signal: AbortSignal, progress: (phase: string) => void, usage: (value: UsageInfo) => void) => Promise<Partial<Workspace> | void>, options?: { source?: Workspace; target?: number | null; signal?: AbortSignal }) {
    if (active.current || status === 'conflict') return false;
    const controller = new AbortController(); active.current = controller;
    const abort = () => controller.abort(); options?.signal?.addEventListener('abort', abort, { once: true });
    if (options?.signal?.aborted) controller.abort();
    const source = options?.source ?? getWorkspace();
    const started = Date.now(); let usage: UsageInfo = {};
    let phase = 'Saving your draft…'; let steps: NonNullable<RunRecord['steps']> = [{ message: phase, elapsedMs: 0 }];
    const target = options?.target ?? null;
    const record: RunRecord = { id: crypto.randomUUID(), operation: action, startedAt: new Date(started).toISOString(), durationMs: 0, instruction: label, outcome: 'success',
      ...(action === 'analyze' || action === 'generate' || action === 'revise' ? { requestedModel: source.models[action] || catalog?.defaultModel || 'Configured default' } : {}) };
    setBusy({ action, started, phase, target });
    try {
      if (!await flush()) throw new Error('Your draft could not be saved. See the message at the top.');
      controller.signal.throwIfAborted();
      const patch = await work(controller.signal, message => { phase = message; steps = appendStage(steps, message, Date.now() - started); setBusy({ action, started, phase, target }); }, value => {
        usage = { ...usage, ...value, renderMs: (usage.renderMs ?? 0) + (value.renderMs ?? 0), renderCacheHits: (usage.renderCacheHits ?? 0) + (value.renderCacheHits ?? 0) };
      });
      controller.signal.throwIfAborted();
      const durationMs = Date.now() - started;
      const result = action === 'analyze' ? 'Website learned.' : action === 'generate' || action === 'revise' ? `${patch?.deck?.slides.length ?? 0} slides ready.` : action === 'export' ? 'PNGs downloaded.' : 'Checks complete.';
      edit(current => recordRun(current, { ...record, ...usage, durationMs, result, steps: appendStage(steps, result, durationMs), ...(patch?.deck ? { output: patch.deck } : {}) }, patch ?? undefined));
      return true;
    } catch (failure) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? 'Stopped. Your post is unchanged.' : (failure as Error).message;
      if (!options?.signal) setToast({ id: Date.now(), text: message, tone: cancelled ? undefined : 'error' });
      edit(current => recordRun(current, { ...record, ...usage, steps, durationMs: Date.now() - started, outcome: cancelled ? 'cancelled' : 'failed', message }));
      return false;
    } finally { options?.signal?.removeEventListener('abort', abort); active.current = null; setBusy(null); }
  }

  async function executeAgentAction(action: AgentAction, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const snapshot = getWorkspace(); const problem = validateAgentAction(action, snapshot); if (problem) throw new Error(problem);
    const images = agentReferences(snapshot).filter(image => action.referenceUrls.includes(image.original));
    if (action.type === 'set_brief') { edit(w => ({ ...w, brief: action.instruction })); notify('Brief updated'); return 'The brief was updated.'; }
    if (action.type === 'undo' || action.type === 'redo') { edit(w => travel(w, action.type as 'undo' | 'redo')); setPeek(false); return `${actionLabel(action)} completed.`; }
    if (['move_earlier', 'move_later', 'duplicate', 'delete'].includes(action.type)) {
      const kind = action.type === 'move_earlier' ? 'earlier' : action.type === 'move_later' ? 'later' : action.type as 'duplicate' | 'delete';
      slideChange(changeSlide(snapshot.deck!, action.target!, kind), actionLabel(action));
      return `${actionLabel(action)} completed.`;
    }
    const source = { ...snapshot, ...(action.type === 'revise' ? { revisionReferences: images } : {}), ...(action.type === 'generate' ? { agent: { ...snapshot.agent, references: images } } : {}) };
    const ok = await run(action.type as Action, action.type === 'analyze' ? action.url : action.instruction || actionLabel(action), async (toolSignal, progress, usage) => {
      if (action.type === 'analyze') {
        progress('Opening the website…');
        const brand = await streamRequest<Brand>('analyze', { url: action.url, model: snapshot.models.analyze }, toolSignal, progress, usage);
        return keepReference(getWorkspace(), brand);
      }
      if (action.type === 'generate' || action.type === 'revise') {
        const revise = action.type === 'revise';
        progress(revise ? 'Reworking your slides…' : 'Designing your post…');
        const next = await streamRequest<Deck>('generate', { ...source, brief: snapshot.brief || action.instruction, previous: null, redo: null, recentRuns: [], lastRun: null,
          agent: { ...snapshot.agent, messages: [], references: [] }, writing: { ...snapshot.writing, messages: [], draft: '' },
          ...(revise ? { instruction: action.instruction, useUpdatedBrief: true, ...(action.target !== null ? { slideIndex: action.target } : {}) } : { generationTask: action.instruction, generationReferences: images }) }, toolSignal, progress, usage);
        const committed = commitDeck(getWorkspace(), next, action.instruction);
        setSelected(revise && action.target !== null ? action.target : revise ? index : 0); setPeek(false);
        notify(revise ? action.target !== null ? `Slide ${action.target + 1} updated` : 'Post updated' : 'Your post is ready', committed.previous ? 'undo' : undefined);
        return { deck: committed.deck, previous: committed.previous, redo: committed.redo, lastInstruction: committed.lastInstruction,
          ...(!snapshot.brief && !revise ? { brief: action.instruction } : {}),
          ...(revise ? { revisionReferences: [] } : {}) };
      }
      if (action.type === 'inspect') return { deck: await streamRequest<Deck>('inspect', snapshot.deck, toolSignal, progress, usage) };
      await exportDeck(snapshot.deck!, action.target, toolSignal, progress, usage);
    }, { source, target: action.target, signal });
    if (!ok) throw new Error(getWorkspace().lastRun?.message || 'That could not finish. Your post is unchanged.');
    const current = getWorkspace();
    return action.type === 'analyze' ? `Learned ${hostOf(action.url)}. Its look and images are now available.`
      : action.type === 'export' ? 'The PNGs were downloaded.'
      : `${actionLabel(action)} completed. ${current.deck?.slides.length} slides at ${current.deck?.width} × ${current.deck?.height}. Render notes: ${current.deck?.slides.flatMap((s, i) => (s.diagnostics ?? []).map(d => `Slide ${i + 1}: ${d}`)).join('; ') || 'none'}.`;
  }

  async function exportDeck(target: Deck, slide: number | null, signal: AbortSignal, progress: (phase: string) => void, usage: (value: UsageInfo) => void) {
    progress(slide === null ? 'Rendering your PNGs…' : `Rendering slide ${slide + 1}…`);
    const response = await fetch(`/api/export${slide === null ? '' : `?slide=${slide}`}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target), signal });
    if (!response.ok) throw new Error((await response.json()).error || 'Export failed. Please try again.');
    usage({ renderMs: Number(response.headers.get('X-Render-Ms')), renderCacheHits: Number(response.headers.get('X-Render-Cache-Hits')) });
    const href = URL.createObjectURL(await response.blob()); signal.throwIfAborted();
    const name = slug(target.title) || 'post';
    const link = document.createElement('a'); link.href = href; link.download = slide === null ? `${name}.zip` : `${name}-${slide + 1}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
  function download(slide: number | null = null) {
    if (!shownDeck) return;
    const target = shownDeck;
    void run('export', slide === null ? `Download ${target.slides.length} slides` : `Download slide ${slide + 1}`, async (signal, progress, usage) => {
      await exportDeck(target, slide, signal, progress, usage); notify(slide === null ? 'Downloaded · ready to post' : `Slide ${slide + 1} downloaded`);
    }, { target: slide });
  }
  function inspect() {
    if (!deck) return;
    void run('inspect', 'Check slides', async (signal, progress, usage) => ({ deck: await streamRequest<Deck>('inspect', deck, signal, progress, usage) }));
  }
  function analyze(url: string) {
    void run('analyze', url, async (signal, progress, usage) => {
      progress('Opening the website…');
      const brand = await streamRequest<Brand>('analyze', { url, model: getWorkspace().models.analyze }, signal, progress, usage);
      notify(`Learned ${hostOf(url)}`);
      return keepReference(getWorkspace(), brand);
    });
  }

  // Direct manipulation never needs the model: the change lands at once and Undo brings it back.
  function slideChange(next: { deck: Deck; index: number }, label: string) {
    edit(w => ({ ...commitDeck(w, next.deck, label), revisionTarget: next.index })); setSelected(next.index); setPeek(false); notify(label, 'undo');
  }
  function move(from: number, to: number) {
    if (!deck || locked) return;
    let next = { deck, index: from };
    while (next.index < to) next = changeSlide(next.deck, next.index, 'later');
    while (next.index > to) next = changeSlide(next.deck, next.index, 'earlier');
    slideChange(next, `Moved slide ${from + 1} to ${to + 1}`);
  }
  function time(direction: 'undo' | 'redo') {
    if (locked) return;
    edit(w => travel(w, direction)); setPeek(false);
    notify(direction === 'undo' ? 'Undone' : 'Redone', direction === 'undo' ? 'redo' : 'undo');
  }
  function send(text: string) {
    setSeen('');
    void agent.send(text, { intent: 'chat', target: deck && slideScope ? index : null, url: '' });
  }
  function hasWork() {
    return !!(workspace.brief || deck || messages.length || workspace.agent.draft.trim() || workspace.agent.references.length);
  }
  function reset(all = false) {
    if (hasWork() && !window.confirm(all ? 'Clear this post and everything ContentBuilder learned from websites?' : 'Start a new post? Your websites and format stay.')) return;
    edit({ ...emptyWorkspace, ...(all ? {} : { brand: workspace.brand, references: workspace.references ?? [], width, height, models: workspace.models }) });
    setSelected(0); setSlideScope(false); setPeek(false); setSheet(null); setSeen('');
  }
  async function savePortable(value = workspace) {
    if (fileBusy || uploadBusy) return; setFileBusy(true); setFileError('');
    try { downloadJson(await jsonRequest('draft', { action: 'save', workspace: value }), 'contentbuilder-draft.json'); }
    catch (failure) { setFileError((failure as Error).message); }
    finally { setFileBusy(false); }
  }
  async function openPortable(file: File) {
    if (file.size > 64 * 1024 * 1024) { setFileError('Choose a saved copy smaller than 64 MB.'); return; }
    setFileBusy(true); setFileError('');
    try {
      const imported = await jsonRequest<Workspace>('draft', { action: 'open', bundle: JSON.parse(await file.text()) });
      if (hasWork() && !window.confirm('Replace this post with the opened copy?')) return;
      edit(imported); setSelected(imported.revisionTarget); setPeek(false); setSheet(null);
    } catch (failure) { setFileError(failure instanceof SyntaxError ? 'This file is not a ContentBuilder copy.' : (failure as Error).message); }
    finally { setFileBusy(false); }
  }
  function reload() {
    if (window.confirm('Load the latest saved draft? Save a copy first if you need what is on screen.')) { restored.current = false; void load(); }
  }

  const work: StageWork | null = busy && (busy.action === 'generate' || busy.action === 'revise') ? { kind: busy.action, phase: busy.phase, target: busy.target } : null;
  const phase = busy?.phase || agent.phase;
  const placeholder = !configured ? 'Add an API key to start' : !deck ? 'Describe your post…' : slideScope ? 'Change this slide…' : 'Ask for a change…';

  const empty = <div className="hello">
    <span className="orb" aria-hidden="true" />
    <p className="eyebrow"><Icon name="sparkle" size={14} />New post</p>
    <h1>What are we posting today?</h1>
    <p className="lede">Describe it in your own words. Paste a link or drop images if you have them.</p>
    <Formats width={width} height={height} disabled={locked} onChange={size => edit(current => ({ ...current, ...size }))} />
    <div className="starters">{starters.map((text, i) => <button type="button" key={text} className="chip starter" style={{ '--i': i } as CSSProperties} disabled={locked || !configured}
      onClick={() => { edit(w => ({ ...w, agent: { ...w.agent, draft: text } })); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.command textarea')?.focus()); }}>{text}</button>)}</div>
  </div>;

  return <div className={`app sheet-${sheet ?? 'none'}${dragging ? ' dropping' : ''}`}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }}
    onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDragging(false); setDropped(Array.from(event.dataTransfer.files)); }}>
    <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
    <header className="topbar">
      <a className="wordmark" href="/"><span className="mark" aria-hidden="true" />ContentBuilder</a>
      <span className={`save-dot ${!ready ? 'saving' : status}`} role="status" title={!ready ? 'Opening…' : status === 'saved' ? 'Saved on this computer' : status === 'saving' ? 'Saving…' : status === 'conflict' ? 'A newer draft is open in another tab' : 'Not saved'}>
        <span className="sr-only">{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving' : 'Not saved'}</span></span>
      <div className="top-actions">
        {previous ? <button type="button" className="icon-button" aria-label="Undo" title="Undo" disabled={locked} onClick={() => time('undo')}><Icon name="undo" /></button> : null}
        {redo ? <button type="button" className="icon-button" aria-label="Redo" title="Redo" disabled={locked} onClick={() => time('redo')}><Icon name="redo" /></button> : null}
        {previous && deck ? <button type="button" className={`icon-button peek${peek ? ' on' : ''}`} aria-label="Hold to see the version before" title="Hold to compare" aria-pressed={peek}
          onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} onPointerCancel={() => setPeek(false)}
          onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setPeek(true); } }} onKeyUp={() => setPeek(false)} onBlur={() => setPeek(false)}><Icon name="eye" /></button> : null}
        <button type="button" className="icon-button" aria-label={`Conversation${unread ? `, ${unread} replies` : ''}`} title="Conversation" onClick={() => setSheet(sheet === 'thread' ? null : 'thread')}>
          <Icon name="chat" />{agent.busy ? <span className="badge pulse" /> : unread ? <span className="badge">{Math.min(unread, 99)}</span> : null}</button>
        <button type="button" className="icon-button" aria-label="Settings" title="Settings" onClick={() => setSheet(sheet === 'settings' ? null : 'settings')}><Icon name="sliders" /></button>
        {deck ? <button type="button" className="button primary download" disabled={locked} onClick={() => download()}>
          {busy?.action === 'export' ? <span className="spinner" /> : <Icon name="download" size={18} />}<span>{peek ? 'Download before' : 'Download'}</span></button> : null}
      </div>
    </header>

    <div className="banners">
      {recovery ? <div className="banner"><p>Unsaved changes from {new Date(recovery.savedAt).toLocaleString()} were found.</p><div>
        <button className="button" disabled={locked} onClick={() => { setSelected(recovery.workspace.revisionTarget); recover(); }}>Restore</button>
        <button className="button ghost" disabled={fileBusy} onClick={() => void savePortable(recovery.workspace)}>Save a copy</button>
        <button className="button ghost" onClick={dismissRecovery}>Dismiss</button></div></div> : null}
      {ready && saveError ? <div className="banner warn" role="alert"><p>{saveError}</p><div>
        <button className="button" disabled={fileBusy} onClick={() => void savePortable()}>Save a copy</button>
        <button className="button ghost" onClick={() => downloadJson(workspace)}>Text-only copy</button>
        {status === 'conflict' ? <button className="button ghost" onClick={reload} disabled={locked}>Load saved draft</button> : <button className="button ghost" onClick={() => void flush()}>Retry</button>}</div></div> : null}
      {backupError || fileError ? <div className="banner warn" role="alert"><p>{fileError || backupError}</p>{fileError ? <button className="button ghost" onClick={() => setFileError('')}>Dismiss</button> : null}</div> : null}
      {ready && !configured ? <div className="banner"><p>Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart to start creating.</p></div> : null}
    </div>

    {!ready ? <main className="loading" aria-busy="true">{saveError ? <><p role="alert">{saveError}</p><button className="button" onClick={load}>Try again</button></> : <span className="spinner big" />}</main>
      : <main className="studio">
        <Stage deck={shownDeck} width={width} height={height} selected={index} handle={handle} peeking={peek && !!previous} locked={locked} work={work} empty={empty}
          onSelect={setSelected} onAim={i => { setSelected(i); setSlideScope(true); }} onMove={move}
          onDuplicate={i => deck && slideChange(changeSlide(deck, i, 'duplicate'), `Duplicated slide ${i + 1}`)}
          onDelete={i => deck && slideChange(changeSlide(deck, i, 'delete'), `Deleted slide ${i + 1}`)}
          onDownloadSlide={i => download(i)} />
        {deck && !peek ? <p className="scope-hint">Tap a thumbnail to aim your next change at one slide{deck.slides.length > 1 ? ' · drag to reorder' : ''}.</p> : null}
      </main>}

    <div className="dock">
      {toast ? <div key={toast.id} className={`toast${toast.tone === 'error' ? ' error' : ''}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
        <Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={16} /><span>{toast.text}</span>
        {toast.undo && (toast.undo === 'undo' ? previous : redo) ? <button type="button" onClick={() => time(toast.undo!)}>{toast.undo === 'undo' ? 'Undo' : 'Redo'}</button> : null}
        <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="close" size={14} /></button>
      </div> : null}
      {showReply && reply ? <div className="reply" key={reply.id}>
        <button type="button" className="reply-close" aria-label="Hide reply" onClick={() => setSeen(reply.id)}><Icon name="close" size={14} /></button>
        <p>{reply.text}</p>
        <Choices message={reply} disabled={locked || !configured} onSend={send} />
        <Proposal message={reply} contextKey={contextKey} disabled={locked || !configured} onSend={send} onApply={id => void agent.apply(id)} onDismiss={agent.dismiss} />
        <button type="button" className="link" onClick={() => setSheet('thread')}>Open conversation</button>
      </div> : null}
      <CommandBar value={workspace.agent.draft} onChange={draft => edit(w => ({ ...w, agent: { ...w.agent, draft } }))} onSend={send}
        onStop={() => { agent.stop(); active.current?.abort(); }} busy={agent.busy || !!busy} phase={phase} disabled={!ready || !configured || status === 'conflict' || fileBusy}
        placeholder={placeholder} scope={deck ? { label: slideScope ? `Slide ${index + 1}` : 'Whole post', slide: slideScope } : null} onToggleScope={() => setSlideScope(value => !value)}
        images={workspace.agent.references} onUploadBusy={setUploadBusy}
        onAddImage={image => edit(w => ({ ...w, agent: { ...w.agent, references: [...w.agent.references.filter(r => r.original !== image.original), image] } }))}
        onRemoveImage={original => edit(w => ({ ...w, agent: { ...w.agent, references: w.agent.references.filter(r => r.original !== original) } }))}
        fileDrop={dropped} onFileDropHandled={() => setDropped(null)} />
    </div>

    <Sheet open={sheet === 'thread'} title="Conversation" onClose={closeSheet} className="thread-sheet">
      <Thread messages={messages} contextKey={contextKey} disabled={locked || !configured} busy={agent.busy} phase={agent.phase}
        onSend={send} onApply={id => void agent.apply(id)} onDismiss={agent.dismiss} onResume={() => void agent.resume()} />
    </Sheet>
    <Sheet open={sheet === 'settings'} title="Settings" onClose={closeSheet}>
      <Settings workspace={workspace} edit={edit} locked={locked} configured={configured} catalog={catalog} modelError={modelError} modelsLoading={modelsLoading} reloadModels={() => void loadModels(true)}
        analyzing={busy?.action === 'analyze' ? busy.phase : null} onAnalyze={analyze} direct={direct} onDirect={setDirect}
        fileBusy={fileBusy} onSavePortable={() => void savePortable()} onOpenPortable={file => void openPortable(file)} onNew={() => reset()} onResetAll={() => reset(true)}
        onCheck={inspect} checking={busy?.action === 'inspect'} />
    </Sheet>
    {dragging ? <div className="drop-hint" aria-hidden="true"><Icon name="image" size={28} /><span>Drop images to use them</span></div> : null}
  </div>;
}
