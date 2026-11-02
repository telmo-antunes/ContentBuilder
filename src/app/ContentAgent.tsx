'use client';
import { useEffect, useRef } from 'react';
import type { Workspace } from '@/lib/schema';
import type { ModelCatalog } from '@/lib/models';
import { actionLabel, agentContextKey } from '@/lib/agent-state';
import { useContentAgent } from '@/lib/useContentAgent';
import { RevisionReferences } from './RevisionReferences';
import { ModelPicker } from './ModelPicker';
import { WordingDiff } from './WordingDiff';

export function ContentAgent({ workspace, edit, agent, disabled, configured, selected, catalog, modelError, modelsLoading, reloadModels, onUploadBusy }: {
  workspace: Workspace; edit: (change: (w: Workspace) => Workspace) => void; agent: ReturnType<typeof useContentAgent>;
  disabled: boolean; configured: boolean; selected: number; catalog: ModelCatalog | null; modelError: string; modelsLoading: boolean; reloadModels: () => void; onUploadBusy: (busy: boolean) => void;
}) {
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const container = log.current; const last = container?.lastElementChild as HTMLElement | null;
    if (container && last) container.scrollTop = last.offsetTop;
  }, [workspace.agent.messages]);
  const key = agentContextKey(workspace, selected);
  return <section className="content-agent" aria-label="ContentBuilder conversation">
    <div className="agent-intro"><h1>What shall we create?</h1><p>Tell me what you have in mind. We can explore ideas, look at references, or work on your slides together.</p></div>
    <div className="agent-scope">{workspace.deck ? `Working with slide ${selected + 1} of ${workspace.deck.slides.length}` : 'Starting a new post'}<span>Changes start as proposals.</span></div>
    {workspace.agent.messages.length ? <ol ref={log} className="agent-log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">{workspace.agent.messages.map(message => <li key={message.id} className={`agent-message ${message.role}`}>
      <strong>{message.role === 'user' ? 'You' : message.role === 'tool' ? 'Activity' : 'ContentBuilder'}</strong><p>{message.text}</p>
      {message.attachments?.length ? <div className="agent-message-images">{message.attachments.map(image => <a key={image.original} href={image.original} target="_blank" rel="noreferrer" aria-label={`Open ${image.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.thumbnail} alt={image.name} width={64} height={64} />
      </a>)}</div> : null}
      {message.choices?.length && !message.action ? <div className="agent-choices">{message.choices.map((choice, i) => <button key={i} type="button" disabled={disabled || agent.busy || !configured} onClick={() => void agent.send(choice.message)}>{choice.label}</button>)}</div> : null}
      {message.action ? <div className="agent-proposal"><strong>{actionLabel(message.action)}</strong>
        {message.action.instruction ? <p>{message.action.instruction}</p> : null}
        {message.action.type === 'set_brief' ? <WordingDiff before={workspace.brief} after={message.action.instruction} /> : null}
        {message.actionStatus === 'proposed' ? <>{message.sourceKey !== key ? <p className="field-hint">The context changed. Ask for an updated proposal.</p> : null}<div className="agent-proposal-actions">
          <button type="button" className="primary" disabled={disabled || agent.busy || !configured || message.sourceKey !== key} onClick={() => void agent.apply(message.id)}>Apply proposal</button>
          <button type="button" disabled={disabled || agent.busy} onClick={() => void agent.send(`Suggest an alternative to this proposal without making changes: ${message.action?.instruction || actionLabel(message.action!)}`)}>Explore alternatives</button>
          <button type="button" className="text-button" disabled={disabled || agent.busy} onClick={() => agent.dismiss(message.id)}>Dismiss proposal</button>
        </div></> : <p className="field-hint">{message.actionStatus === 'done' ? 'Completed' : 'Dismissed'}</p>}
      </div> : null}
      {message.model ? <details className="agent-message-details"><summary>Reply details</summary><p>{message.model}{message.usage ? ` · ${message.usage.inputTokens ?? '—'} input / ${message.usage.outputTokens ?? '—'} output tokens` : ''}</p></details> : null}
    </li>)}</ol> : <div className="agent-starters"><button type="button" disabled={disabled || !configured} onClick={() => void agent.send(workspace.deck ? 'Review the current carousel and suggest the most useful improvements. Do not make changes yet.' : 'Help me work out what to create. Ask me what you need to know.')}>{workspace.deck ? 'Review these slides' : 'Help me get started'}</button><button type="button" disabled={disabled || !configured} onClick={() => void agent.send('Suggest a few creative directions based on my current brief and references. Do not make any changes yet.')}>Explore directions</button></div>}
    {!agent.busy && workspace.agent.messages.at(-1)?.role === 'user' ? <button type="button" disabled={disabled || !configured} onClick={() => void agent.resume()}>Resume reply</button> : null}
    {agent.phase ? <div className="agent-progress" role="status"><span>{agent.phase}</span><button type="button" onClick={agent.stop}>Stop agent</button></div> : null}
    {agent.error ? <div className="error" role="alert"><p>{agent.error}</p><button type="button" className="text-button" onClick={agent.clearError}>Dismiss error</button></div> : null}
    {!configured ? <p className="notice">Add ANTHROPIC_API_KEY to .env.local and restart the server to talk with the agent.</p> : null}
    <form className="agent-composer" onSubmit={event => { event.preventDefault(); void agent.send(workspace.agent.draft); }}>
      <label htmlFor="agent-message">Message ContentBuilder</label><textarea id="agent-message" value={workspace.agent.draft} rows={3} placeholder="Ask a question, describe a change, or ask for alternatives…" disabled={disabled || agent.busy}
        onChange={event => { const draft = event.target.value; edit(w => ({ ...w, agent: { ...w.agent, draft } })); }}
        onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!disabled && !agent.busy) void agent.send(workspace.agent.draft); } }} />
      <RevisionReferences images={workspace.agent.references} disabled={disabled || agent.busy} onBusyChange={onUploadBusy} purpose="conversation"
        onAdd={image => edit(w => ({ ...w, agent: { ...w.agent, references: [...w.agent.references.filter(r => r.original !== image.original), image] } }))}
        onRemove={original => edit(w => ({ ...w, agent: { ...w.agent, references: w.agent.references.filter(r => r.original !== original) } }))} />
      <div className="agent-send"><small>Ask freely. I’ll clarify when it matters.</small><button className="primary" disabled={disabled || agent.busy || !configured || !workspace.agent.draft.trim()}>Send message</button></div>
    </form>
    <details className="agent-settings"><summary>Agent settings</summary><fieldset disabled={disabled || agent.busy}><ModelPicker action="agent" value={workspace.models.agent} catalog={catalog} error={modelError} loading={modelsLoading} retry={reloadModels} onChange={model => edit(w => ({ ...w, models: { ...w.models, agent: model } }))} /><p className="field-hint">Website analysis, generation and revisions keep their own model selections in Brief & settings.</p></fieldset></details>
  </section>;
}
