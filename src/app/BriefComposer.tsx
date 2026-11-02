'use client';
import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '@/lib/schema';
import type { ModelCatalog } from '@/lib/models';
import type { UsageInfo } from '@/lib/operation';
import { streamRequest } from '@/lib/client';
import { appendWritingMessage, canApplyWording, insertCompletion, writingContext, type WritingMode, type WritingReply } from '@/lib/writing';
import { ModelPicker } from './ModelPicker';
import { WordingDiff } from './WordingDiff';
import { AUTOCOMPLETE_FAILURE_LIMIT, finishAutocomplete, mergeAutocompleteUsage } from '@/lib/autocomplete-usage';

type Props = { workspace: Workspace; edit: (change: (current: Workspace) => Workspace) => void; disabled: boolean; configured: boolean;
  required: boolean; catalog: ModelCatalog | null; modelError: string; modelsLoading: boolean; reloadModels: () => void; showChat?: boolean };
type Proposal = { source: string; text: string; explanation: string; usage: UsageInfo };
export function BriefComposer(props: Props) {
  const { workspace, edit, disabled, configured, required, catalog } = props;
  const { brief, writing, models } = workspace;
  const latest = useRef(props); latest.current = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const chatLog = useRef<HTMLOListElement>(null);
  const alive = useRef(true);
  const manual = useRef<{ controller: AbortController; mode: 'chat' | 'rephrase'; anchor?: string } | null>(null);
  const lastAutoKey = useRef('');
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [typed, setTyped] = useState(0);
  const [completion, setCompletion] = useState<{ key: string; text: string; source: string; cursor: number } | null>(null);
  const [autoStatus, setAutoStatus] = useState('');
  const [autoError, setAutoError] = useState('');
  const [pending, setPending] = useState<{ mode: 'chat' | 'rephrase'; phase: string } | null>(null);
  const [manualError, setManualError] = useState<{ mode: 'chat' | 'rephrase'; text: string } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const contextKey = JSON.stringify(writingContext(workspace));
  const autoKey = `${contextKey}|${models.complete || catalog?.defaultModel || ''}|${selection.start}|${selection.end}`;
  const modelAvailable = (mode: WritingMode) => !catalog || !!catalog.defaultModel || !!models[mode];
  const autoPaused = writing.usage.consecutiveFailures >= AUTOCOMPLETE_FAILURE_LIMIT;
  const autoAllowed = configured && !disabled && !pending && writing.autocomplete && !autoPaused && modelAvailable('complete');
  const visibleCompletion = autoAllowed && completion?.key === autoKey ? completion : null;

  useEffect(() => { alive.current = true; return () => { alive.current = false; manual.current?.controller.abort(); }; }, []);
  useEffect(() => { if (disabled) manual.current?.controller.abort(); }, [disabled]);
  useEffect(() => {
    if (manual.current?.anchor && !writing.messages.some(message => message.id === manual.current?.anchor)) manual.current.controller.abort();
    if (chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [writing.messages]);
  useEffect(() => {
    setAutoStatus(''); setAutoError('');
    if (!autoAllowed || !focused || composing || !typed || brief.trim().length < 8 || selection.start !== selection.end || lastAutoKey.current === autoKey) return;
    const controller = new AbortController(); let disposed = false, started = false, finished = false;
    let reported: UsageInfo = {}; const scope = latest.current.workspace.writing.usage.scope || crypto.randomUUID();
    const finish = (outcome: 'completed' | 'failed' | 'cancelled') => {
      if (!started || finished) return; finished = true;
      if (!alive.current) return;
      edit(current => current.writing.usage.scope !== scope ? current : { ...current, writing: { ...current.writing, usage: finishAutocomplete(current.writing.usage, outcome, reported) } });
    };
    const timer = setTimeout(async () => {
      started = true;
      edit(current => ({ ...current, writing: { ...current.writing, usage: { ...current.writing.usage, scope, requests: current.writing.usage.requests + 1 } } }));
      lastAutoKey.current = autoKey; setAutoStatus('Suggesting a continuation…');
      try {
        const reply = await streamRequest<WritingReply>('assist', { ...JSON.parse(contextKey), mode: 'complete', model: models.complete, cursor: selection.start, messages: [] }, controller.signal, () => {}, usage => { reported = mergeAutocompleteUsage(reported, usage); });
        finish('completed');
        if (!disposed) { setCompletion(reply.suggestion ? { key: autoKey, text: reply.suggestion, source: brief, cursor: selection.start } : null); setAutoStatus(reply.suggestion ? 'Continuation available.' : 'No suggestion right now.'); }
      } catch (error) { finish(controller.signal.aborted ? 'cancelled' : 'failed'); if (!disposed && !controller.signal.aborted) setAutoError((error as Error).message); }
      finally { if (!disposed) setAutoStatus(current => current === 'Suggesting a continuation…' ? '' : current); }
    }, 1200);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); finish('cancelled'); };
  }, [autoAllowed, autoKey, contextKey, models.complete, brief, focused, composing, typed, selection.start, selection.end, edit]);

  function replaceBrief(text: string, source: string) {
    if (disabled || latest.current.workspace.brief !== source) return;
    edit(current => current.brief === source ? { ...current, brief: text } : current);
    setUndo({ before: source, after: text }); setCompletion(null); setProposal(null); setTyped(0);
  }
  function acceptCompletion() {
    if (!visibleCompletion) return;
    const next = insertCompletion(latest.current.workspace.brief, visibleCompletion.source, visibleCompletion.cursor, visibleCompletion.text);
    if (next === null) return;
    const cursor = visibleCompletion.cursor + visibleCompletion.text.length;
    replaceBrief(next, visibleCompletion.source);
    setSelection({ start: cursor, end: cursor });
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(cursor, cursor); });
  }
  async function requestManual(mode: 'chat' | 'rephrase', message?: string) {
    if (manual.current || disabled || !configured || !modelAvailable(mode)) return;
    const snapshot = latest.current.workspace;
    let messages = snapshot.writing.messages;
    if (mode === 'chat' && message?.trim()) {
      const userMessage = { id: crypto.randomUUID(), role: 'user' as const, text: message.trim() };
      messages = appendWritingMessage(messages, userMessage);
      edit(current => ({ ...current, writing: { ...current.writing, draft: current.writing.draft === message ? '' : current.writing.draft, messages: appendWritingMessage(current.writing.messages, userMessage) } }));
    }
    if (mode === 'chat' && messages.at(-1)?.role !== 'user') return;
    const controller = new AbortController(); const anchor = mode === 'chat' ? messages.at(-1)!.id : undefined;
    manual.current = { controller, mode, anchor }; let usage: UsageInfo = {};
    setPending({ mode, phase: mode === 'chat' ? 'Reading your message…' : 'Reviewing the wording…' }); setManualError(null); setCompletion(null);
    if (mode === 'rephrase') setProposal(null); else setChatOpen(true);
    try {
      const reply = await streamRequest<WritingReply>('assist', { ...writingContext(snapshot), mode, model: snapshot.models[mode], cursor: snapshot.brief.length, messages: mode === 'chat' ? messages.slice(-20) : [] }, controller.signal,
        phase => { if (alive.current) setPending({ mode, phase }); }, value => { usage = { ...usage, ...value }; });
      if (!alive.current || controller.signal.aborted) return;
      if (mode === 'rephrase') setProposal({ source: snapshot.brief, text: reply.suggestion, explanation: reply.reply, usage });
      else edit(current => current.writing.messages.some(item => item.id === anchor) ? { ...current, writing: { ...current.writing, messages: appendWritingMessage(current.writing.messages,
        { id: crypto.randomUUID(), role: 'assistant', text: reply.reply, suggestion: reply.suggestion, sourceBrief: snapshot.brief, model: usage.model }) } } : current);
    } catch (error) {
      if (alive.current) setManualError({ mode, text: controller.signal.aborted ? 'Stopped. Your description is unchanged.' : (error as Error).message });
    } finally { manual.current = null; if (alive.current) setPending(null); }
  }
  function picker(mode: WritingMode) {
    return <ModelPicker action={mode} value={models[mode]} required={false} catalog={catalog} error={props.modelError} loading={props.modelsLoading} retry={props.reloadModels}
      onChange={value => edit(current => ({ ...current, models: { ...current.models, [mode]: value } }))} />;
  }
  const canUndo = undo && brief === undo.after;
  return <div className="brief-composer">
    <label htmlFor="brief">Your instructions</label>
    <textarea ref={textarea} id="brief" className="brief-input" rows={6} value={brief} required={required} aria-describedby="autocomplete-hint"
      placeholder={'Describe the content and how it should look.\n\nGive exact wording, a slide-by-slide plan, or room to explore.'}
      onChange={event => { const value = event.target.value; setCompletion(null); setTyped(value => value + 1); setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd }); edit(current => ({ ...current, brief: value })); }}
      onSelect={event => setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing) return;
        if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && visibleCompletion) { event.preventDefault(); acceptCompletion(); }
        if (event.key === 'Escape' && visibleCompletion) { event.preventDefault(); setCompletion(null); setAutoStatus(''); }
      }} />
    <div className="writing-tools"><label className="check-label"><input type="checkbox" checked={writing.autocomplete} onChange={event => { const autocomplete = event.target.checked; edit(current => ({ ...current, writing: { ...current.writing, autocomplete } })); }} />Autocomplete</label>
      <button type="button" className="text-button" disabled={!configured || !!pending || !brief.trim() || !modelAvailable('rephrase')} onClick={() => void requestManual('rephrase')}>Suggest rephrasing</button></div>
    <p id="autocomplete-hint" className="field-hint">{writing.autocomplete ? 'Pause while typing for a suggestion. Tab accepts; Esc dismisses.' : 'Autocomplete is off. Your wording stays yours.'}</p>
    {autoPaused ? <div className="notice" role="status"><p>Autocomplete paused after three failed requests.</p><button type="button" onClick={() => {
      lastAutoKey.current = ''; setAutoError(''); setTyped(value => value + 1);
      edit(current => ({ ...current, writing: { ...current.writing, autocomplete: true, usage: { ...current.writing.usage, consecutiveFailures: 0 } } })); textarea.current?.focus();
    }}>Resume autocomplete</button></div> : null}
    <details className="autocomplete-usage"><summary>Autocomplete usage · {writing.usage.requests} request{writing.usage.requests === 1 ? '' : 's'}</summary>
      <dl><dt>Completed / failed / stopped</dt><dd>{writing.usage.completed} / {writing.usage.failed} / {writing.usage.cancelled}</dd>
        <dt>Reported input / output tokens</dt><dd>{writing.usage.inputTokens} / {writing.usage.outputTokens}</dd>
        <dt>Cache read / written tokens</dt><dd>{writing.usage.cacheReadTokens} / {writing.usage.cacheWriteTokens}</dd>
        <dt>In progress or interrupted</dt><dd>{Math.max(0, writing.usage.requests - writing.usage.completed - writing.usage.failed - writing.usage.cancelled)}</dd>
        <dt>Finished without token reports</dt><dd>{writing.usage.unreported}</dd></dl>
      <p className="field-hint">Totals for this draft. Reported tokens are counted once per request. Failed, stopped and interrupted calls can have incomplete usage; these are not billing totals.</p>
    </details>
    <span className="sr-only" role="status">{autoStatus}</span>
    {autoStatus === 'Suggesting a continuation…' ? <p className="field-hint">{autoStatus}</p> : null}
    {visibleCompletion ? <div className="writing-suggestion"><p className="field-hint">Suggested continuation</p><p className="suggestion-copy">{visibleCompletion.text}</p><div className="writing-actions">
      <button type="button" onClick={acceptCompletion}>Accept continuation</button><button type="button" className="text-button" onClick={() => { setCompletion(null); setAutoStatus(''); }}>Dismiss suggestion</button>
    </div></div> : null}
    {autoError && !autoPaused ? <p className="field-hint">Autocomplete: {autoError} <button type="button" className="text-button" onClick={() => { lastAutoKey.current = ''; setTyped(value => value + 1); textarea.current?.focus(); }}>Retry autocomplete</button></p> : null}
    {pending ? <div className="writing-progress" role="status"><span>{pending.phase}</span><button type="button" onClick={() => manual.current?.controller.abort()}>Stop writing assistant</button></div> : null}
    {manualError ? <div className="error" role="alert"><p>{manualError.text}</p><div className="writing-actions"><button type="button" className="text-button" disabled={!!pending || !configured || (manualError.mode === 'chat' && writing.messages.at(-1)?.role !== 'user')} onClick={() => void requestManual(manualError.mode)}>Retry {manualError.mode === 'chat' ? 'reply' : 'rephrasing'}</button><button type="button" className="text-button" onClick={() => setManualError(null)}>Dismiss error</button></div></div> : null}
    {proposal ? <div className="wording-proposal"><p>{proposal.explanation}</p>
      {proposal.text ? <><label htmlFor="proposed-wording">Suggested wording</label><textarea id="proposed-wording" rows={5} value={proposal.text} onChange={event => setProposal({ ...proposal, text: event.target.value })} />
        <WordingDiff before={proposal.source} after={proposal.text} />
        {brief !== proposal.source ? <p className="field-hint">Your description has changed. Request a new rephrasing to keep those edits.</p> : null}
        <button type="button" disabled={!canApplyWording(brief, proposal.source, proposal.text)} onClick={() => replaceBrief(proposal.text, proposal.source)}>Use this wording</button></> : null}
      <button type="button" className="text-button" onClick={() => setProposal(null)}>Dismiss rephrasing</button>
      {proposal.usage.model ? <p className="field-hint">{proposal.usage.model} · {proposal.usage.inputTokens ?? '—'} input / {proposal.usage.outputTokens ?? '—'} output tokens</p> : null}
    </div> : null}
    {canUndo ? <button type="button" className="text-button" onClick={() => { edit(current => current.brief === undo.after ? { ...current, brief: undo.before } : current); setUndo(null); setTyped(0); }}>Undo accepted wording</button> : null}
    {props.showChat !== false ? <details className="brief-chat" open={chatOpen} onToggle={event => setChatOpen(event.currentTarget.open)}><summary>Talk through this brief</summary>
      <p className="field-hint">Ask for ideas or feedback. I’ll ask a question when something important is unclear. Suggestions change your description only when you apply them.</p>
      {writing.messages.length ? <ol ref={chatLog} className="chat-log" aria-label="Brief conversation" aria-live="polite" aria-relevant="additions">{writing.messages.map(message => <li key={message.id} className={`chat-message ${message.role}`}>
        <strong>{message.role === 'user' ? 'You' : 'Writing assistant'}</strong><p>{message.text}</p>
        {message.suggestion ? <details><summary>Suggested brief</summary><p>{message.suggestion}</p>
          {message.sourceBrief !== undefined ? <WordingDiff before={message.sourceBrief} after={message.suggestion} /> : <p className="field-hint">This older suggestion has no saved original description to compare.</p>}
          {!canApplyWording(brief, message.sourceBrief, message.suggestion) ? <p className="field-hint">{brief === message.suggestion ? 'Applied to your description.' : 'Your description has changed. Ask for an updated suggestion.'}</p> : null}
          <button type="button" disabled={!canApplyWording(brief, message.sourceBrief, message.suggestion)} onClick={() => replaceBrief(message.suggestion!, message.sourceBrief!)}>Use this brief</button>
        </details> : null}{message.model ? <small>{message.model}</small> : null}
      </li>)}</ol> : <button type="button" disabled={!configured || !!pending || !modelAvailable('chat')} onClick={() => void requestManual('chat', 'Help me refine this brief. Ask if you need clarification.')}>Help me refine this</button>}
      {writing.messages.at(-1)?.role === 'user' && !pending && manualError?.mode !== 'chat' ? <button type="button" disabled={!configured || !modelAvailable('chat')} onClick={() => void requestManual('chat')}>Reply to last message</button> : null}
      <label htmlFor="brief-chat-message">Message the writing assistant</label><textarea id="brief-chat-message" rows={3} value={writing.draft} placeholder="I have an idea, but I’m not sure how to describe it…"
        onChange={event => { const draft = event.target.value; edit(current => ({ ...current, writing: { ...current.writing, draft } })); }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (writing.draft.trim()) void requestManual('chat', writing.draft); } }} />
      <div className="writing-actions"><span className="field-hint">Ctrl / ⌘ Enter to send</span><button type="button" disabled={!configured || !!pending || !writing.draft.trim() || !modelAvailable('chat')} onClick={() => void requestManual('chat', writing.draft)}>Send message</button></div>
      <p className="field-hint">The latest 40 messages save with this draft. Replies use the latest 20, your current instructions and website notes.</p>
    </details> : null}
    <details className="writing-settings"><summary>Writing assistant models</summary><p className="field-hint">Autocomplete makes an AI call after a typing pause. Choose a model for each writing action.</p>{picker('complete')}{picker('rephrase')}{props.showChat !== false ? picker('chat') : null}</details>
    {configured && catalog && !catalog.defaultModel && (['complete', 'rephrase', 'chat'] as const).some(mode => !models[mode]) ? <p className="field-hint">Choose models above to enable the writing actions you want.</p> : null}
  </div>;
}
