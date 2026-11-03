'use client';
import { useEffect, useRef, useState } from 'react';
import type { AgentAction, AgentContext, AgentMessage, RevisionReference, Workspace } from './schema';
import type { AgentReply } from './content-agent';
import type { UsageInfo } from './operation';
import { actionLabel, agentContextKey, appendAgentMessage, requiresProposal, validateAgentAction } from './agent-state';
import { streamRequest } from './client';
import { addSpend } from './pricing';

type Props = {
  getWorkspace: () => Workspace; edit: (change: (current: Workspace) => Workspace) => void;
  selected: number; disabled: boolean; configured: boolean; flush: () => Promise<boolean>;
  // Direct mode runs slide changes as soon as the agent chooses them; Undo is the safety net.
  direct: boolean;
  execute: (action: AgentAction, signal: AbortSignal) => Promise<string | { text: string; deckId?: string }>;
};
export function useContentAgent(props: Props) {
  const latest = useRef(props); latest.current = props;
  const active = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState(''); const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  function append(message: AgentMessage) { latest.current.edit(w => ({ ...w, agent: { ...w.agent, messages: appendAgentMessage(w.agent.messages, message) } })); }
  function mark(id: string, status: 'done' | 'dismissed') { latest.current.edit(w => ({ ...w, agent: { ...w.agent, messages: w.agent.messages.map(m => m.id === id ? { ...m, actionStatus: status } : m) } })); }
  async function execute(message: AgentMessage, signal: AbortSignal) {
    const w = latest.current.getWorkspace();
    if (!message.action) return;
    if (message.sourceKey !== agentContextKey(w, latest.current.selected)) throw new Error('The draft or selected slide changed since this proposal. Ask for an updated proposal before applying it.');
    const problem = validateAgentAction(message.action, w); if (problem) throw new Error(problem);
    setPhase(actionLabel(message.action));
    if (!await latest.current.flush()) throw new Error('Save the draft before applying this proposal.');
    signal.throwIfAborted();
    const result = await latest.current.execute(message.action, signal);
    signal.throwIfAborted(); mark(message.id, 'done');
    append({ id: crypto.randomUUID(), role: 'tool', ...(typeof result === 'string' ? { text: result } : result) });
  }
  async function think(signal: AbortSignal) {
    for (let step = 0; step < 5; step++) {
      signal.throwIfAborted();
      const workspace = latest.current.getWorkspace(); const selectedSlide = latest.current.selected;
      const sourceKey = agentContextKey(workspace, selectedSlide); let usage: UsageInfo = {};
      setPhase('Considering your request…');
      const direct = latest.current.direct;
      const reply = await streamRequest<AgentReply>('agent', { workspace: { ...workspace, profiles: [], recentRuns: [], lastRun: null, history: [], future: [] }, selectedSlide, direct }, signal, setPhase, value => { usage = { ...usage, ...value }; });
      signal.throwIfAborted();
      const message: AgentMessage = { id: crypto.randomUUID(), role: 'assistant', text: reply.reply, choices: reply.choices, model: usage.model,
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, modelMs: usage.modelMs },
        ...(reply.action ? { action: reply.action, actionStatus: 'proposed', sourceKey } : {}) };
      append(message);
      latest.current.edit(w => addSpend(w, usage.spentUsd));
      if (!reply.action || (requiresProposal(reply.action) && !direct)) return;
      await execute(message, signal);
      // A direct slide change reports itself; skip the extra model call that would only narrate it.
      if (requiresProposal(reply.action)) return;
    }
    append({ id: crypto.randomUUID(), role: 'assistant', text: 'I’ve completed five steps. Tell me what you’d like to do next.' });
  }
  async function session(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current || latest.current.disabled || !latest.current.configured) return;
    const controller = new AbortController(); active.current = controller; setError(''); setPhase('Reading your message…');
    try { await work(controller.signal); }
    catch (failure) {
      const text = controller.signal.aborted ? 'Stopped. Any completed actions are kept; an unfinished slide change was not applied.' : (failure as Error).message;
      setError(text); append({ id: crypto.randomUUID(), role: 'tool', text });
    } finally { active.current = null; setPhase(''); }
  }
  async function send(text: string, context: AgentContext = { intent: 'chat', target: latest.current.selected, url: '' }, attachments?: RevisionReference[]) {
    if (!text.trim()) return;
    return session(async signal => {
      const current = latest.current.getWorkspace();
      const message: AgentMessage = { id: crypto.randomUUID(), role: 'user', text: text.trim(), context, attachments: attachments ?? current.agent.references };
      latest.current.edit(w => ({ ...w, agent: { ...w.agent, draft: w.agent.draft.trim() === text.trim() ? '' : w.agent.draft, references: [], messages: appendAgentMessage(w.agent.messages, message) } }));
      if (!await latest.current.flush()) throw new Error('Your message is kept locally. Save the draft before continuing.');
      await think(signal);
    });
  }
  async function apply(id: string) {
    const message = latest.current.getWorkspace().agent.messages.find(m => m.id === id && m.actionStatus === 'proposed');
    if (!message) return;
    return session(async signal => { await execute(message, signal); await think(signal); });
  }
  function dismiss(id: string) { mark(id, 'dismissed'); }
  function resume() { return session(think); }
  return { send, apply, dismiss, resume, phase, error, busy: !!phase, stop: () => active.current?.abort(), clearError: () => setError('') };
}
