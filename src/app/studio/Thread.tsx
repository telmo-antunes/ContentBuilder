'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import type { AgentMessage } from '@/lib/schema';
import { actionLabel } from '@/lib/agent-state';
import { Icon } from './Icon';

type Props = {
  messages: AgentMessage[]; contextKey: string; disabled: boolean; busy: boolean; phase: string;
  onSend: (text: string) => void; onApply: (id: string) => void; onDismiss: (id: string) => void; onResume: () => void;
};

export function Choices({ message, disabled, onSend }: { message: AgentMessage; disabled: boolean; onSend: (text: string) => void }) {
  if (!message.choices?.length || message.action) return null;
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

// The full conversation. The command bar stays docked beneath it, so replying needs no extra tap.
export function Thread({ messages, contextKey, disabled, busy, phase, onSend, onApply, onDismiss, onResume }: Props) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length, busy]);
  if (!messages.length) return <div className="thread-empty"><Icon name="chat" size={28} /><p>Your conversation shows up here. Ask for ideas, critique or changes from the bar below.</p></div>;
  return <ol className="thread" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
    {messages.map(message => message.role === 'tool'
      ? <li key={message.id} className="activity"><Icon name={/fail|stopp|could not|error/i.test(message.text) ? 'alert' : 'check'} size={14} /><span>{message.text}</span></li>
      : <li key={message.id} className={`bubble ${message.role}`}>
        <p>{message.text}</p>
        {message.attachments?.length ? <div className="bubble-images">{message.attachments.map(image => <a key={image.original} href={image.original} target="_blank" rel="noreferrer" aria-label={`Open ${image.name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.thumbnail} alt={image.name} width={56} height={56} />
        </a>)}</div> : null}
        <Choices message={message} disabled={disabled || busy} onSend={onSend} />
        <Proposal message={message} contextKey={contextKey} disabled={disabled || busy} onSend={onSend} onApply={onApply} onDismiss={onDismiss} />
        {message.action && message.actionStatus !== 'proposed' ? <small className="hint">{message.actionStatus === 'done' ? `Done · ${actionLabel(message.action)}` : 'Skipped'}</small> : null}
      </li>)}
    {busy ? <li className="bubble assistant typing" role="status"><span className="dots-typing"><i /><i /><i /></span><small>{phase}</small></li> : null}
    {!busy && messages.at(-1)?.role === 'user' ? <li className="activity"><button type="button" className="button" disabled={disabled} onClick={onResume}>Resume reply</button></li> : null}
    <li ref={end} className="thread-end" aria-hidden="true" />
  </ol>;
}
