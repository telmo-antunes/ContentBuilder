'use client';
import type { CSSProperties } from 'react';
import type { AgentMessage } from '@/lib/schema';
import { actionLabel } from '@/lib/agent-state';
import { Icon } from './Icon';

type Props = { onSend: (text: string) => void; onApply: (id: string) => void; onDismiss: (id: string) => void };

export function Choices({ message, disabled, onSend }: { message: AgentMessage; disabled: boolean; onSend: (text: string) => void }) {
  if (!message.choices?.length || (message.action && message.actionStatus !== 'done')) return null;
  return <div className="choices">{message.choices.map((choice, i) => <button type="button" key={i} style={{ '--i': i } as CSSProperties}
    className="chip choice" disabled={disabled} onClick={() => onSend(choice.message)}>{choice.label}</button>)}</div>;
}

export function Proposal({ message, contextKey, disabled, onSend, onApply, onDismiss }: { message: AgentMessage; contextKey: string; disabled: boolean } & Pick<Props, 'onSend' | 'onApply' | 'onDismiss'>) {
  if (!message.action || message.actionStatus !== 'proposed') return null;
  const stale = message.sourceKey !== contextKey;
  return <div className="proposal">
    <strong><Icon name="sparkle" size={16} />{actionLabel(message.action)}</strong>
    {message.action.instruction ? <p>{message.action.instruction}</p> : null}
    {stale ? <p className="hint">Things changed since this was suggested. Ask again for a fresh one.</p> : null}
    <div className="row">
      <button type="button" className="button primary" disabled={disabled || stale} onClick={() => onApply(message.id)}>Do it</button>
      <button type="button" className="button" disabled={disabled} onClick={() => onSend(`Suggest an alternative without making changes: ${message.action?.instruction || actionLabel(message.action!)}`)}>Other ideas</button>
      <button type="button" className="button ghost" disabled={disabled} onClick={() => onDismiss(message.id)}>Skip</button>
    </div>
  </div>;
}
