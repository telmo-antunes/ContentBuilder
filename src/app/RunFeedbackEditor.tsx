'use client';
import { useId } from 'react';
import type { RunFeedback, RunRecord } from '@/lib/schema';
const categories = [['instructions', 'Ignored instructions'], ['copy', 'Copy issue'], ['layout', 'Layout issue']] as const;
export function RunFeedbackEditor({ run, disabled, onChange }: { run: RunRecord; disabled: boolean; onChange: (feedback: RunFeedback) => void }) {
  const id = useId(); const feedback = run.feedback ?? { categories: [], note: '', updatedAt: '' };
  return <details className="run-feedback"><summary>{run.feedback ? 'Feedback saved' : 'Add feedback to this run'}</summary><fieldset disabled={disabled}>
    <legend>What should improve?</legend><div className="feedback-categories">{categories.map(([value, label]) => <label className="check-label" key={value}><input type="checkbox" checked={feedback.categories.includes(value)} onChange={event => onChange({ ...feedback, updatedAt: new Date().toISOString(), categories: event.target.checked ? [...feedback.categories, value] : feedback.categories.filter(category => category !== value) })} />{label}</label>)}</div>
    <label htmlFor={id}>Feedback note</label><textarea id={id} rows={3} value={feedback.note} placeholder="What did you request, and what did the result miss?" onChange={event => onChange({ ...feedback, note: event.target.value, updatedAt: new Date().toISOString() })} />
    <p className="field-hint">Saved with this run’s inputs, model and timings.{run.output ? ` Its ${run.output.slides.length}-slide output is retained when you add feedback.` : ' This run has no saved slide output.'}</p>
  </fieldset></details>;
}
