'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { emptyWorkspace, type AgentAction, type AgentMessage, type Brand, type Caption, type Deck, type RunRecord, type Workspace } from '@/lib/schema';
import { addSpend } from '@/lib/pricing';
import { hasPost, postOf, withPost, type DraftSummary, type Post } from '@/lib/drafts';
import { switchProfile } from '@/lib/profiles';
import { downloadJson, streamRequest, jsonRequest } from '@/lib/client';
import { useWorkspace } from '@/lib/useWorkspace';
import type { SlideEvent, UsageInfo } from '@/lib/operation';
import { changeSlide, commitDeck, findVersion, replaceSlide, travel } from '@/lib/history';
import { activeDirections } from '@/lib/directions';
import { addLesson, isQuestion, looksLikeCreate, seedKit } from '@/lib/kit';
import { parseCanvas } from '@/lib/formats';
import type { ModelCatalog } from '@/lib/models';
import { appendStage, recordRun } from '@/lib/flow';
import { useContentAgent } from '@/lib/useContentAgent';
import { actionLabel, agentContextKey, agentReferences, appendAgentMessage, validateAgentAction } from '@/lib/agent-state';
import { websiteReferences, keepReference } from '@/lib/references';
import { Stage, type StageWork } from './studio/Stage';
import { CommandBar } from './studio/CommandBar';
import { Sheet } from './studio/Sheet';
import { Choices, Proposal } from './studio/Thread';
import { ThreadView } from './studio/ThreadView';
import { Compose, type ComposeRequest } from './studio/Compose';
import { Settings, hostOf } from './studio/Settings';
import { Icon } from './studio/Icon';
import { CaptionPanel, DraftList, OptionsTray, VersionList } from './studio/Extras';

type Action = RunRecord['operation'];
type Busy = { action: Action; started: number; phase: string; target: number | null };
type Toast = { id: number; text: string; undo?: 'undo' | 'redo'; tone?: 'error'; action?: { label: string; run: () => void } };
// Slides that have streamed in for the deck being written; a patch overlays them on the current deck.
type Stream = { base: Deck | null; size: { width: number; height: number }; assets: Deck['assets']; slides: Record<number, string>; mode: 'full' | 'patch' };
type View = 'compose' | 'thread' | 'stage';
type Result = string | { text: string; deckId?: string; retry?: AgentMessage['retry'] };
type Options = { index: number; htmls: string[]; assets: Deck['assets']; busy: boolean; controller: AbortController };

const urlPattern = /https?:\/\/[^\s)]+/i;
// Heavy history never needs to travel with a request.
const lean = (w: Workspace): Workspace => ({ ...w, profiles: [], previous: null, redo: null, history: [], future: [], recentRuns: [], lastRun: null, agent: { ...w.agent, messages: [], references: [] }, writing: { ...w.writing, messages: [], draft: '' } });
// Every image a freshly written slide may reference, so streamed slides preview with their pictures.
const knownAssets = (w: Workspace): Deck['assets'] => ({ ...w.deck?.assets,
  ...Object.fromEntries(websiteReferences(w).flatMap(brand => brand.previews).filter(p => p.original).map(p => [p.url, p.original!])),
  ...(w.kit.logo ? { [w.kit.logo]: w.kit.logo } : {}), ...Object.fromEntries([...w.pinned, ...agentReferences(w)].map(image => [image.original, image.original])) });
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
  const [sheet, setSheet] = useState<'settings' | 'caption' | 'versions' | 'drafts' | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [draftsError, setDraftsError] = useState('');
  const [rewriting, setRewriting] = useState(false);
  // Compose in three beats, work in the conversation, review on the stage.
  const [view, setView] = useState<View>('compose');
  const [stream, setStream] = useState<Stream | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
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
  const streamed = stream ? Object.keys(stream.slides).map(Number).sort((a, b) => a - b) : [];
  const streamDeck: Deck | null = !stream || !streamed.length ? null : stream.mode === 'patch' && stream.base
    ? { ...stream.base, slides: stream.base.slides.map((slide, i) => stream.slides[i] !== undefined ? { html: stream.slides[i] } : slide) }
    : { title: '', ...stream.size, assets: stream.assets, slides: streamed.map(i => ({ html: stream.slides[i] })) };
  const shownDeck = streamDeck ?? (peek && previous ? previous.deck : deck);
  const index = shownDeck ? Math.min(selected, shownDeck.slides.length - 1) : 0;
  const handle = workspace.kit.handle.replace(/^@/, '') || (workspace.brand ? hostOf(workspace.brand.url).split('.')[0] : 'yourbrand');
  const messages = workspace.agent.messages;
  // The newest assistant reply since the user last spoke, floated above the bar.
  const reply = [...messages].reverse().find((message, i, newest) => message.role === 'assistant' && !newest.slice(0, i).some(item => item.role === 'user'));
  const showReply = !!reply && reply.id !== seen && view === 'stage' && !agent.busy;
  const contextKey = agentContextKey(workspace, selected);

  const loadModels = useCallback(async (refresh = false) => {
    setModelsLoading(true); setModelError('');
    try { setCatalog(await jsonRequest<ModelCatalog>(`models${refresh ? '?refresh=1' : ''}`)); }
    catch (failure) { setModelError((failure as Error).message); }
    finally { setModelsLoading(false); }
  }, []);
  useEffect(() => { if (ready && configured) void loadModels(); }, [ready, configured, loadModels]);
  // A reply from an earlier session stays in the conversation, not floating over the post.
  useEffect(() => {
    if (!ready || restored.current) return;
    setSelected(workspace.revisionTarget); setSeen(reply?.id ?? ''); setView(workspace.deck || messages.length ? 'thread' : 'compose'); restored.current = true;
  }, [ready, workspace.revisionTarget, workspace.deck, messages.length, reply?.id]);
  useEffect(() => { if (view === 'stage' && !deck && !stream) setView(deck || messages.length ? 'thread' : 'compose'); }, [view, deck, stream, messages.length]);
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
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') document.title = 'ContentBuilder'; };
    document.addEventListener('visibilitychange', back); return () => document.removeEventListener('visibilitychange', back);
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);
  function setDirect(value: boolean) { setDirectState(value); try { localStorage.setItem('contentbuilder-direct', value ? 'on' : 'off'); } catch { /* per-browser preference only */ } }
  // View changes morph where the browser supports it: the current version card grows into the stage.
  function go(next: View) {
    if (next === view) return;
    setSheet(null);
    const start = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (start && !reduce) start.call(document, () => flushSync(() => setView(next))); else setView(next);
    window.scrollTo({ top: 0 });
  }
  function log(result: Result) {
    const entry = typeof result === 'string' ? { text: result } : result;
    edit(current => ({ ...current, agent: { ...current.agent, messages: appendAgentMessage(current.agent.messages, { id: crypto.randomUUID(), role: 'tool', ...entry }) } }));
  }
  function notify(text: string, undo?: Toast['undo'], action?: Toast['action']) { setToast({ id: Date.now(), text, undo, action }); }
  // A post takes minutes; if you went to another app, say when it lands: a title badge, a notification if allowed, a buzz.
  function announce(text: string) {
    if (document.visibilityState === 'visible') return;
    document.title = `● ${text} · ContentBuilder`;
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('ContentBuilder', { body: text, tag: 'contentbuilder-ready' }); } catch { /* the title badge still shows */ }
    navigator.vibrate?.(120);
  }
  function onSlide(event: SlideEvent) {
    setStream(current => current ? { ...current, mode: event.pass || event.mode !== 'patch' ? current.mode : 'patch', slides: { ...current.slides, [event.index]: event.html } } : current);
    if (event.mode === 'full' && !event.pass) setSelected(event.index);
  }

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
      edit(current => addSpend(recordRun(current, { ...record, ...usage, durationMs, result, steps: appendStage(steps, result, durationMs) }, patch ?? undefined), usage.spentUsd));
      return true;
    } catch (failure) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? 'Stopped. Your post is unchanged.' : (failure as Error).message;
      if (!options?.signal) setToast({ id: Date.now(), text: message, tone: cancelled ? undefined : 'error' });
      edit(current => addSpend(recordRun(current, { ...record, ...usage, steps, durationMs: Date.now() - started, outcome: cancelled ? 'cancelled' : 'failed', message }), usage.spentUsd));
      return false;
    } finally { options?.signal?.removeEventListener('abort', abort); active.current = null; setBusy(null); }
  }

  async function executeAgentAction(action: AgentAction, signal: AbortSignal): Promise<Result> {
    signal.throwIfAborted();
    const snapshot = getWorkspace(); const problem = validateAgentAction(action, snapshot); if (problem) throw new Error(problem);
    const images = agentReferences(snapshot).filter(image => action.referenceUrls.includes(image.original));
    if (action.type === 'set_brief') { edit(w => ({ ...w, brief: action.instruction })); notify('Brief updated'); return 'The brief was updated.'; }
    if (action.type === 'undo' || action.type === 'redo') { edit(w => travel(w, action.type as 'undo' | 'redo')); setPeek(false); return `${actionLabel(action)} completed.`; }
    if (action.type === 'set_canvas') { const size = parseCanvas(action.instruction)!; edit(w => ({ ...w, ...size })); notify(`Format set to ${size.width} × ${size.height}`); return `The next new post will be ${size.width} × ${size.height}.`; }
    if (['move_earlier', 'move_later', 'duplicate', 'delete'].includes(action.type)) {
      const kind = action.type === 'move_earlier' ? 'earlier' : action.type === 'move_later' ? 'later' : action.type as 'duplicate' | 'delete';
      const deckId = slideChange(changeSlide(snapshot.deck!, action.target!, kind), actionLabel(action));
      return { text: `${actionLabel(action)} completed.`, deckId };
    }
    const remixSize = action.type === 'remix' ? parseCanvas(action.instruction)! : null;
    const source = { ...snapshot, ...(remixSize ?? {}), ...(action.type === 'revise' ? { revisionReferences: images } : {}), ...(action.type === 'generate' || action.type === 'remix' ? { agent: { ...snapshot.agent, references: images } } : {}) };
    const ok = await run((action.type === 'remix' ? 'generate' : action.type) as Action, action.type === 'analyze' ? action.url : action.instruction || actionLabel(action), async (toolSignal, progress, usage) => {
      if (action.type === 'analyze') {
        progress('Opening the website…');
        const brand = await streamRequest<Brand>('analyze', { url: action.url, model: snapshot.models.analyze }, toolSignal, progress, usage);
        const current = getWorkspace();
        return { ...keepReference(current, brand), kit: seedKit(current.kit, brand.kitHints) };
      }
      if (action.type === 'generate' || action.type === 'revise' || action.type === 'remix') {
        const revise = action.type === 'revise', remix = action.type === 'remix';
        progress(revise ? 'Reworking your slides…' : remix ? 'Re-flowing your post…' : 'Designing your post…');
        setStream({ base: revise ? snapshot.deck : null, size: revise && snapshot.deck ? snapshot.deck : { width: source.width, height: source.height }, assets: knownAssets(snapshot), slides: {}, mode: revise ? 'patch' : 'full' });
        let next: Deck;
        try {
          next = await streamRequest<Deck>('generate', { ...lean(source), brief: snapshot.brief || action.instruction,
            ...(revise ? { instruction: action.instruction, useUpdatedBrief: true, ...(action.target !== null ? { slideIndex: action.target } : {}) }
              : { generationTask: action.instruction, generationReferences: images, ...(remix ? { remix: true } : {}) }) }, toolSignal, progress, usage, onSlide);
        } finally { setStream(null); }
        const committed = commitDeck(getWorkspace(), next, remix ? `${actionLabel(action)}` : action.instruction);
        setSelected(revise && action.target !== null ? action.target : revise ? index : 0); setPeek(false);
        notify(revise ? action.target !== null ? `Slide ${action.target + 1} updated` : 'Post updated' : remix ? `${remixSize!.height > remixSize!.width * 1.6 ? 'Story' : 'Feed'} version ready` : 'Your post is ready', committed.previous ? 'undo' : undefined);
        if (revise) void learn(action.instruction);
        announce(revise ? 'Your change is ready' : 'Your post is ready');
        return { deck: committed.deck, previous: committed.previous, redo: committed.redo, history: committed.history, future: committed.future, lastInstruction: committed.lastInstruction,
          ...(remixSize ?? {}), ...(!snapshot.brief && !revise && !remix ? { brief: action.instruction } : {}),
          ...(revise ? { revisionReferences: [] } : {}) };
      }
      if (action.type === 'inspect') return { deck: await streamRequest<Deck>('inspect', snapshot.deck, toolSignal, progress, usage) };
      await exportDeck(snapshot.deck!, action.target, toolSignal, progress, usage);
    }, { source, target: action.target, signal });
    if (!ok) throw new Error(getWorkspace().lastRun?.message || 'That could not finish. Your post is unchanged.');
    const current = getWorkspace();
    if ((action.type === 'generate' || action.type === 'revise' || action.type === 'remix') && current.deck?.id) {
      return { deckId: current.deck.id, text: `${actionLabel(action)} completed. ${current.deck.slides.length} slides at ${current.deck.width} × ${current.deck.height}. Render notes: ${current.deck.slides.flatMap((s, i) => (s.diagnostics ?? []).map(d => `Slide ${i + 1}: ${d}`)).join('; ') || 'none'}.` };
    }
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
      notify(`Learned ${hostOf(url)}${brand.article ? ' and its article' : ''}`);
      const current = getWorkspace();
      return { ...keepReference(current, brand), kit: seedKit(current.kit, brand.kitHints) };
    });
  }

  // Direct manipulation never needs the model: the change lands at once and Undo brings it back.
  // Acting directly on the post retires the agent's last floating reply.
  function quiet() { setSeen(reply?.id ?? ''); }
  function slideChange(next: { deck: Deck; index: number }, label: string) {
    quiet(); edit(w => ({ ...commitDeck(w, next.deck, label), revisionTarget: next.index })); setSelected(next.index); setPeek(false); notify(label, 'undo');
    return getWorkspace().deck?.id;
  }
  // A change made by hand shows up in the conversation as its own version.
  function changeByHand(next: { deck: Deck; index: number }, label: string) {
    const deckId = slideChange(next, label);
    if (deckId) log({ text: label, deckId });
  }
  function move(from: number, to: number) {
    if (!deck || locked) return;
    let next = { deck, index: from };
    while (next.index < to) next = changeSlide(next.deck, next.index, 'later');
    while (next.index > to) next = changeSlide(next.deck, next.index, 'earlier');
    changeByHand(next, `Moved slide ${from + 1} to ${to + 1}`);
  }
  function time(direction: 'undo' | 'redo') {
    if (locked) return;
    quiet(); edit(w => travel(w, direction)); setPeek(false);
    notify(direction === 'undo' ? 'Undone' : 'Redone', direction === 'undo' ? 'redo' : 'undo');
    log(direction === 'undo' ? 'Undid the last change.' : 'Redid the change.');
  }
  function restore(direction: 'undo' | 'redo', steps: number) {
    if (locked) return;
    edit(w => travel(w, direction, steps)); setPeek(false); setSheet(null);
    const text = `Went ${direction === 'undo' ? 'back' : 'forward'} ${steps} version${steps === 1 ? '' : 's'}`;
    notify(text, direction === 'undo' ? 'redo' : 'undo'); log(`${text}.`);
  }
  // Runs actions straight from the interface, in order, logging each result. A failure is logged with the
  // steps still to run, so Retry picks up where it stopped.
  async function runSteps(actions: AgentAction[]) {
    const controller = new AbortController();
    for (const [i, action] of actions.entries()) {
      try { log(await executeAgentAction(action, controller.signal)); }
      catch (failure) {
        const message = (failure as Error).message;
        log({ text: message, retry: { label: 'Try again', actions: actions.slice(i) } });
        setToast({ id: Date.now(), text: message, tone: 'error' }); announce('Something needs your attention');
        return false;
      }
    }
    return true;
  }
  function retry(message: AgentMessage) {
    if (!message.retry || locked) return;
    edit(w => ({ ...w, agent: { ...w.agent, messages: w.agent.messages.map(item => item.id === message.id ? { ...item, retry: undefined } : item) } }));
    void runSteps(message.retry.actions);
  }
  function remix(format: 'story' | 'post') {
    quiet();
    void runSteps([{ type: 'remix', instruction: format, url: '', target: null, referenceUrls: [] }]);
  }
  async function showOptions(slide: number) {
    const source = getWorkspace();
    if (!source.deck || locked) return;
    quiet();
    const controller = new AbortController();
    setOptions({ index: slide, htmls: [], assets: knownAssets(source), busy: true, controller });
    const started = await run('revise', `Options for slide ${slide + 1}`, async (signal, progress, usage) => {
      const result = await streamRequest<{ options: { html: string }[]; assets: Deck['assets'] }>('variants', { ...lean(source), slideIndex: slide, count: 3 }, signal, progress, usage,
        event => setOptions(current => current && current.index === slide ? { ...current, htmls: Object.assign([...current.htmls], { [event.index]: event.html }) } : current));
      setOptions(current => current && current.index === slide ? { ...current, htmls: result.options.map(option => option.html), assets: { ...current.assets, ...result.assets }, busy: false } : current);
    }, { target: slide, signal: controller.signal });
    if (!started) {
      setOptions(current => current?.index === slide ? null : current);
      if (!controller.signal.aborted) setToast({ id: Date.now(), text: getWorkspace().lastRun?.message || 'The options could not be made.', tone: 'error' });
    }
  }
  function pickOption(html: string) {
    if (!deck || !options) return;
    changeByHand({ deck: replaceSlide(deck, options.index, html, options.assets), index: options.index }, `Picked an option for slide ${options.index + 1}`);
    setOptions(null);
  }
  // A revision that states a lasting preference becomes a brand lesson the next post will follow.
  async function learn(instruction: string) {
    const w = getWorkspace();
    try {
      let spent = 0;
      const { lesson } = await streamRequest<{ lesson: string }>('lesson', { instruction, lessons: w.kit.lessons, model: w.models.complete }, new AbortController().signal, () => {}, value => { spent = value.spentUsd ?? spent; });
      edit(current => addSpend(current, spent));
      if (!lesson || addLesson(getWorkspace().kit, lesson) === getWorkspace().kit) return;
      edit(current => ({ ...current, kit: addLesson(current.kit, lesson) }));
      notify(`Learned: ${lesson}`, undefined, { label: 'Forget', run: () => edit(current => ({ ...current, kit: { ...current.kit, lessons: current.kit.lessons.filter(item => item !== lesson) } })) });
    } catch { /* lessons are a bonus; a failure changes nothing */ }
  }
  // A change aimed at one slide is already explicit: revise that slide directly, no agent call in between.
  async function reviseSlide(text: string, slide: number) {
    const attachments = getWorkspace().agent.references;
    edit(current => ({ ...current, agent: { ...current.agent, draft: current.agent.draft.trim() === text.trim() ? '' : current.agent.draft, references: [],
      messages: appendAgentMessage(current.agent.messages, { id: crypto.randomUUID(), role: 'user', text, context: { intent: 'revise', target: slide, url: '' }, attachments }) } }));
    await runSteps([{ type: 'revise', instruction: text, url: '', target: slide, referenceUrls: attachments.map(image => image.original) }]);
  }
  // A plain request for a post skips the agent and goes straight to generation (after reading any link).
  async function create(text: string, options: { url?: string; instruction?: string; summary?: string; count?: number | null } = {}) {
    const w = getWorkspace(); const attachments = w.agent.references;
    const url = options.url ?? text.match(urlPattern)?.[0] ?? '';
    edit(current => ({ ...current, agent: { ...current.agent, draft: current.agent.draft.trim() === text.trim() ? '' : current.agent.draft, references: [],
      messages: appendAgentMessage(current.agent.messages, { id: crypto.randomUUID(), role: 'user', text: options.summary ?? text, context: { intent: 'generate', target: null, url }, attachments }) } }));
    const made = await runSteps([...(url ? [{ type: 'analyze' as const, url, instruction: '', target: null, referenceUrls: [] }] : []),
      { type: 'generate', instruction: options.instruction ?? text, url: '', target: null, referenceUrls: attachments.map(image => image.original) }]);
    // The count is asked for in words; when the model misses it, say so and offer the fix.
    const count = options.count, slides = getWorkspace().deck?.slides.length;
    if (made && count && slides && slides !== count) log({ text: `You asked for ${count} slide${count === 1 ? '' : 's'}; this version has ${slides}.`,
      retry: { label: `Make it ${count}`, actions: [{ type: 'revise', instruction: `Make the post exactly ${count} slide${count === 1 ? '' : 's'}: keep the content, language and design, splitting or merging slides as needed.`, url: '', target: null, referenceUrls: [] }] } });
  }
  // The three beats hand over a brief, optional per-slide instructions and a slide count; the conversation takes it from there.
  function compose({ url, count }: ComposeRequest) {
    const w = getWorkspace();
    const directions = activeDirections(w);
    const summary = [w.brief.trim(), count ? `${count} slide${count === 1 ? '' : 's'}.` : '', ...directions.map(item => `Slide ${item.slide}: ${item.text.trim()}`), url].filter(Boolean).join('\n');
    go('thread');
    try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => {}); } catch { /* the title badge still works */ }
    void create(w.brief, { url, summary, count, instruction: count ? `Make exactly ${count} slide${count === 1 ? '' : 's'}.` : 'Make the post described in the brief.' });
  }
  function restoreVersion(id: string) {
    const found = findVersion(getWorkspace(), id);
    if (found?.direction) restore(found.direction, found.steps);
  }
  function quote(slide: number) {
    setSelected(slide); setSlideScope(true);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.command textarea')?.focus());
  }
  function send(text: string) {
    setSeen('');
    if (!getWorkspace().deck && direct && looksLikeCreate(text)) { void create(text); return; }
    // In the conversation an aimed message aims once; on the stage the slide chip stays in view, so the aim stays.
    if (view === 'thread') setSlideScope(false);
    if (deck && slideScope && direct && !isQuestion(text)) { void reviseSlide(text, index); return; }
    void agent.send(text, { intent: 'chat', target: deck && slideScope ? index : null, url: '' });
  }
  function hasWork() {
    return !!(workspace.brief || deck || messages.length || workspace.agent.draft.trim() || workspace.agent.references.length);
  }
  function fresh(post?: Post) {
    setSelected(post?.revisionTarget ?? 0); setSlideScope(false); setPeek(false); setSheet(null);
    setSeen([...(post?.agent.messages ?? [])].reverse().find(message => message.role === 'assistant')?.id ?? '');
    go(post && (post.deck || post.agent.messages.length) ? 'thread' : 'compose');
  }
  function resetAll() {
    if (hasWork() && !window.confirm('Clear this post, your brands and everything ContentBuilder learned from websites? Drafts stay.')) return;
    edit({ ...emptyWorkspace, models: workspace.models }); fresh();
  }
  // A new post sets the current one aside in Drafts; Undo brings it straight back.
  async function newPost() {
    if (locked) return;
    const before = getWorkspace();
    let saved: DraftSummary | null = null;
    if (hasPost(before)) {
      try { saved = await jsonRequest<DraftSummary>('drafts', { action: 'save', post: postOf(before) }); }
      catch (failure) { setToast({ id: Date.now(), text: `This post could not be set aside, so it is still open. ${(failure as Error).message}`, tone: 'error' }); return; }
    }
    edit(current => withPost(current, postOf({ ...emptyWorkspace, width: current.width, height: current.height })));
    fresh();
    if (saved) notify('Saved to Drafts', undefined, { label: 'Undo', run: () => {
      edit(current => withPost(current, postOf(before))); fresh(postOf(before));
      void jsonRequest('drafts', { action: 'delete', id: saved!.id }).catch(() => {});
    } });
  }
  async function loadDrafts() {
    setDrafts(null); setDraftsError('');
    try { setDrafts((await jsonRequest<{ drafts: DraftSummary[] }>('drafts')).drafts); }
    catch (failure) { setDraftsError((failure as Error).message); }
  }
  function showDrafts() { setSheet('drafts'); void loadDrafts(); }
  // Opening a draft swaps it with the current post, which waits in Drafts in its place.
  async function openDraft(id: string) {
    if (locked) return;
    const current = getWorkspace();
    try {
      const { post } = await jsonRequest<{ post: Post }>('drafts', { action: 'open', id });
      if (hasPost(current)) await jsonRequest('drafts', { action: 'save', post: postOf(current) });
      await jsonRequest('drafts', { action: 'delete', id });
      edit(w => withPost(post.profileId ? switchProfile(w, post.profileId) : w, post));
      fresh(post);
      notify(hasPost(current) ? 'Opened · the other post waits in Drafts' : 'Draft opened');
    } catch (failure) { setDraftsError((failure as Error).message); }
  }
  async function deleteDraft(id: string) {
    try { await jsonRequest('drafts', { action: 'delete', id }); setDrafts(list => list?.filter(draft => draft.id !== id) ?? null); }
    catch (failure) { setDraftsError((failure as Error).message); }
  }
  async function rewriteCaption(wish: string) {
    const w = getWorkspace();
    if (!w.deck || rewriting || locked) return;
    setRewriting(true); let spent = 0;
    try {
      const { caption } = await streamRequest<{ caption: Caption }>('caption', { brief: w.brief.slice(0, 20_000), title: w.deck.title.slice(0, 300), kit: w.kit, model: w.models.complete, wish,
        slides: w.deck.slides.map(slide => ({ text: (slide.renderedText ?? '').slice(0, 4000), alt: (slide.alt ?? '').slice(0, 1000) })), ...(w.deck.caption ? { current: w.deck.caption } : {}) },
        new AbortController().signal, () => {}, value => { spent = value.spentUsd ?? spent; });
      const label = wish ? `Caption: ${wish}` : w.deck.caption ? 'Rewrote the caption' : 'Wrote the caption';
      edit(current => current.deck ? addSpend(commitDeck(current, { ...current.deck, caption }, label), spent) : current);
      const deckId = getWorkspace().deck?.id;
      if (deckId) log({ text: `${label}.`, deckId });
      notify(label, 'undo');
    } catch (failure) { setToast({ id: Date.now(), text: (failure as Error).message, tone: 'error' }); }
    finally { setRewriting(false); }
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

  const work: StageWork | null = busy && (busy.action === 'generate' || busy.action === 'revise') && !options ? { kind: busy.action, phase: busy.phase, target: busy.target } : null;
  // Another slide is still coming while the model writes a new deck.
  const pending = !!stream && stream.mode === 'full' && !!busy && /Designing|Writing|Re-flowing|preparing its response|Considering/i.test(busy.phase);
  const phase = busy?.phase || agent.phase;
  // Short enough to fit beside the scope chip on a phone.
  const placeholder = !configured ? 'Add an API key to start' : !deck ? 'Describe your post…' : slideScope ? `Change slide ${index + 1}…` : 'Change it…';

  const banners = <div className="banners">
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
  </div>;
  const saveDot = <span className={`save-dot ${!ready ? 'saving' : status}`} role="status" title={!ready ? 'Opening…' : status === 'saved' ? 'Saved on this computer' : status === 'saving' ? 'Saving…' : status === 'conflict' ? 'A newer draft is open in another tab' : 'Not saved'}>
    <span className="sr-only">{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving' : 'Not saved'}</span></span>;
  const settingsButton = <button type="button" className="icon-button" aria-label="Settings" title="Settings" onClick={() => setSheet(sheet === 'settings' ? null : 'settings')}><Icon name="sliders" /></button>;
  const downloadButton = deck ? <button type="button" className="button primary download" disabled={locked} onClick={() => download()}>
    {busy?.action === 'export' ? <span className="spinner" /> : <Icon name="download" size={18} />}<span>{peek ? 'Download before' : 'Download'}</span></button> : null;
  const generating = !!busy && (busy.action === 'generate' || busy.action === 'revise') && !options;
  const live = generating && stream ? { deck: streamDeck, size: stream.size, phase: busy!.phase, pending } : null;
  const bar = <CommandBar value={workspace.agent.draft} onChange={draft => edit(w => ({ ...w, agent: { ...w.agent, draft } }))} onSend={send}
    onStop={() => { agent.stop(); active.current?.abort(); }} busy={agent.busy || !!busy} phase={phase} disabled={!ready || !configured || status === 'conflict' || fileBusy}
    placeholder={view === 'thread' && deck && !slideScope ? 'Reply…' : placeholder}
    scope={deck ? { label: slideScope ? `Slide ${index + 1}` : 'Whole post', slide: slideScope } : null} onToggleScope={() => setSlideScope(value => !value)}
    images={workspace.agent.references} onUploadBusy={setUploadBusy}
    onAddImage={image => edit(w => ({ ...w, agent: { ...w.agent, references: [...w.agent.references.filter(r => r.original !== image.original), image] } }))}
    onRemoveImage={original => edit(w => ({ ...w, agent: { ...w.agent, references: w.agent.references.filter(r => r.original !== original) } }))}
    onPinImage={image => { edit(w => ({ ...w, pinned: [...w.pinned.filter(item => item.original !== image.original), image].slice(-8), agent: { ...w.agent, references: w.agent.references.filter(r => r.original !== image.original) } })); notify('Pinned as inspiration for every post'); }}
    fileDrop={dropped} onFileDropHandled={() => setDropped(null)} />;

  return <div className={`app view-${view} sheet-${sheet ?? 'none'}${dragging ? ' dropping' : ''}`}
    onDragOver={event => { if (view !== 'compose' && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }}
    onDrop={event => { if (!event.dataTransfer.files.length || view === 'compose') return; event.preventDefault(); setDragging(false); setDropped(Array.from(event.dataTransfer.files)); }}>
    <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
    <header className="topbar">
      {view === 'stage' ? <button type="button" className="back" onClick={() => go('thread')}><Icon name="left" size={18} /><span>Conversation</span></button>
        : <a className="wordmark" href="/"><span className="mark" aria-hidden="true" />ContentBuilder</a>}
      {saveDot}
      <div className="top-actions">
        {view === 'stage' ? <>
          {previous ? <button type="button" className="icon-button" aria-label="Undo" title="Undo" disabled={locked} onClick={() => time('undo')}><Icon name="undo" /></button> : null}
          {redo ? <button type="button" className="icon-button redo" aria-label="Redo" title="Redo" disabled={locked} onClick={() => time('redo')}><Icon name="redo" /></button> : null}
          {previous && deck ? <button type="button" className={`icon-button peek${peek ? ' on' : ''}`} aria-label="Hold to see the version before" title="Hold to compare" aria-pressed={peek}
            onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} onPointerCancel={() => setPeek(false)}
            onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setPeek(true); } }} onKeyUp={() => setPeek(false)} onBlur={() => setPeek(false)}><Icon name="eye" /></button> : null}
          {previous || redo ? <button type="button" className="icon-button" aria-label="Versions" title="Versions" onClick={() => setSheet(sheet === 'versions' ? null : 'versions')}><Icon name="clock" /></button> : null}
          {settingsButton}{downloadButton}
        </> : view === 'thread' ? <>
          <button type="button" className="icon-button" aria-label="New post" title="New post" disabled={locked} onClick={() => void newPost()}><Icon name="plus" /></button>
          <button type="button" className="icon-button" aria-label="Drafts" title="Drafts" disabled={locked} onClick={showDrafts}><Icon name="layers" /></button>
          {settingsButton}
          {deck ? <button type="button" className="button primary download" onClick={() => go('stage')}><Icon name="phone" size={18} /><span>Review</span></button> : null}
        </> : <>
          {messages.length || deck ? <button type="button" className="icon-button" aria-label="Back to the conversation" title="Conversation" onClick={() => go('thread')}><Icon name="chat" /></button> : null}
          <button type="button" className="icon-button" aria-label="Drafts" title="Drafts" disabled={locked} onClick={showDrafts}><Icon name="layers" /></button>
          {settingsButton}
        </>}
      </div>
    </header>
    {banners}

    {!ready ? <main className="loading" aria-busy="true">{saveError ? <><p role="alert">{saveError}</p><button className="button" onClick={load}>Try again</button></> : <span className="spinner big" />}</main>
      : view === 'compose' ? <main className="studio compose-view">
        <Compose workspace={workspace} edit={edit} locked={locked} configured={configured} onCreate={compose} onUploadBusy={setUploadBusy} onManageBrands={() => setSheet('settings')}
          onClose={messages.length || deck ? () => go('thread') : null} />
      </main>
      : view === 'thread' ? <main className="studio thread-view">
        <ThreadView workspace={workspace} contextKey={contextKey} disabled={locked || !configured} thinking={agent.busy && !busy ? agent.phase || 'Thinking…' : null} live={live}
          onSend={send} onApply={id => void agent.apply(id)} onDismiss={agent.dismiss} onResume={() => void agent.resume()}
          onReview={slide => { setSelected(slide); go('stage'); }} onRestore={restoreVersion} onDownload={() => download()} onQuote={quote}
          onOptions={slide => { setSelected(slide); void showOptions(slide); }} onRetry={retry} />
      </main>
      : <main className="studio stage-view">
        <Stage deck={shownDeck} width={width} height={height} selected={index} handle={handle} logo={workspace.kit.logo} peeking={peek && !!previous} locked={locked} work={work}
          empty={<div className="hello"><p className="lede">No post yet.</p></div>}
          fresh={streamed} pending={pending} onCaption={() => setSheet('caption')} onOptions={i => void showOptions(i)} onRemix={remix}
          onSelect={setSelected} onAim={i => { setSelected(i); setSlideScope(true); }} onMove={move}
          onDuplicate={i => deck && changeByHand(changeSlide(deck, i, 'duplicate'), `Duplicated slide ${i + 1}`)}
          onDelete={i => deck && changeByHand(changeSlide(deck, i, 'delete'), `Deleted slide ${i + 1}`)}
          onDownloadSlide={i => download(i)} />
        {deck && !peek ? <p className="scope-hint">Tap a thumbnail to aim your next change at one slide{deck.slides.length > 1 ? ' · drag to reorder' : ''}.</p> : null}
      </main>}

    <div className="dock">
      {toast ? <div key={toast.id} className={`toast${toast.tone === 'error' ? ' error' : ''}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
        <Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={16} /><span>{toast.text}</span>
        {toast.undo && (toast.undo === 'undo' ? previous : redo) ? <button type="button" onClick={() => time(toast.undo!)}>{toast.undo === 'undo' ? 'Undo' : 'Redo'}</button> : null}
        {toast.action ? <button type="button" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button> : null}
        <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="close" size={14} /></button>
      </div> : null}
      {view !== 'compose' && options && deck ? <OptionsTray deck={deck} index={options.index} options={options.htmls.filter(Boolean)} assets={options.assets} busy={options.busy}
        onPick={pickOption} onClose={() => { options.controller.abort(); setOptions(null); }} /> : null}
      {showReply && reply && !options ? <div className="reply" key={reply.id}>
        <button type="button" className="reply-close" aria-label="Hide reply" onClick={() => setSeen(reply.id)}><Icon name="close" size={14} /></button>
        <p>{reply.text}</p>
        <Choices message={reply} disabled={locked || !configured} onSend={send} />
        <Proposal message={reply} contextKey={contextKey} disabled={locked || !configured} onSend={send} onApply={id => void agent.apply(id)} onDismiss={agent.dismiss} />
        <button type="button" className="link" onClick={() => go('thread')}>Open conversation</button>
      </div> : null}
      {view !== 'compose' ? bar : null}
    </div>

    <Sheet open={sheet === 'caption'} title="Caption" onClose={closeSheet}>{deck ? <CaptionPanel deck={deck} locked={locked || rewriting} rewriting={rewriting}
      onChange={caption => edit(w => w.deck ? { ...w, deck: { ...w.deck, caption } } : w)} onRewrite={wish => void rewriteCaption(wish)} /> : null}</Sheet>
    <Sheet open={sheet === 'drafts'} title="Drafts" onClose={closeSheet}><DraftList drafts={drafts} error={draftsError} disabled={locked} onOpen={id => void openDraft(id)} onDelete={id => void deleteDraft(id)} /></Sheet>
    <Sheet open={sheet === 'versions'} title="Versions" onClose={closeSheet}><VersionList workspace={workspace} disabled={locked} onRestore={restore} /></Sheet>
    <Sheet open={sheet === 'settings'} title="Settings" onClose={closeSheet}>
      <Settings workspace={workspace} edit={edit} locked={locked} configured={configured} catalog={catalog} modelError={modelError} modelsLoading={modelsLoading} reloadModels={() => void loadModels(true)}
        analyzing={busy?.action === 'analyze' ? busy.phase : null} onAnalyze={analyze} direct={direct} onDirect={setDirect}
        fileBusy={fileBusy} onSavePortable={() => void savePortable()} onOpenPortable={file => void openPortable(file)} onNew={() => void newPost()} onDrafts={showDrafts} onResetAll={resetAll}
        onCheck={inspect} checking={busy?.action === 'inspect'} />
    </Sheet>
    {dragging ? <div className="drop-hint" aria-hidden="true"><Icon name="image" size={28} /><span>Drop images to use them</span></div> : null}
  </div>;
}
