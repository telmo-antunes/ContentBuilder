'use client';
import type { RunFeedback, RunRecord } from '@/lib/schema';
import { runKey } from '@/lib/flow';
import { RunFeedbackEditor } from './RunFeedbackEditor';

const labels = { analyze: 'Website analysis', generate: 'Slide generation', revise: 'Revision', export: 'PNG export', inspect: 'Render checks' };
function RunDetails({ run, running = false, elapsedMs, disabled, onFeedback }: { run: RunRecord; running?: boolean; elapsedMs: number; disabled: boolean; onFeedback: (key: string, feedback: RunFeedback) => void }) {
  const steps = run.steps ?? [];
  return <div className="flow-details">
    <p className="field-hint">{labels[run.operation]} · {running ? 'Running' : run.outcome} · {(elapsedMs / 1000).toFixed(1)}s{run.model || run.requestedModel ? ` · ${run.model ?? run.requestedModel}` : ''}</p>
    {steps.length ? <ol className="flow-steps">{steps.map((step, i) => {
      const last = i === steps.length - 1;
      const state = !last || (!running && run.outcome === 'success') ? 'done' : running ? 'running' : run.outcome;
      const duration = Math.max(0, (steps[i + 1]?.elapsedMs ?? elapsedMs) - step.elapsedMs);
      return <li key={`${i}-${step.elapsedMs}`} className={state}><span>{step.message}</span><small>{state === 'running' ? 'In progress · ' : state === 'failed' ? 'Failed · ' : state === 'cancelled' ? 'Stopped · ' : ''}{(duration / 1000).toFixed(1)}s</small></li>;
    })}</ol> : <p className="field-hint">This older run has no recorded stages.</p>}
    {run.result && steps[steps.length - 1]?.message !== run.result ? <p>{run.result}</p> : null}{run.message ? <p className="error">{run.message}</p> : null}
    <details><summary>Inputs used</summary>
      {run.inputs ? <><dl><dt>Scope</dt><dd>{run.inputs.target}</dd><dt>Canvas</dt><dd>{run.inputs.width} × {run.inputs.height} px</dd><dt>Website</dt><dd>{run.inputs.website ?? 'No website reference'}</dd><dt>Selected images</dt><dd>{run.inputs.images.length}</dd></dl>
        {run.inputs.brief ? <><h3>Main brief</h3><p className="flow-copy">{run.inputs.brief}</p></> : null}
        {run.inputs.directions.map(item => <div key={item.slide}><h3>Slide {item.slide}</h3><p className="flow-copy">{item.text}</p></div>)}
        {run.inputs.websiteNotes ? <details><summary>Website inspiration notes</summary><p className="flow-copy">{run.inputs.websiteNotes}</p></details> : null}
        {run.inputs.references?.slice(1).map(reference => <details key={reference.url}><summary>{reference.url}</summary><p className="flow-copy">{reference.notes}</p><p>{reference.images.length} selected images</p></details>)}
        {run.inputs.images.length ? <details><summary>Selected image URLs</summary><ul>{run.inputs.images.map(url => <li key={url}>{url}</li>)}</ul></details> : null}
        {run.inputs.revisionReferences?.length ? <details><summary>Uploaded revision references ({run.inputs.revisionReferences.length})</summary><ul className="revision-reference-list">{run.inputs.revisionReferences.map(image => <li key={image.original}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={image.original} target="_blank" rel="noreferrer"><img src={image.thumbnail} alt={image.name} width={72} height={72} /></a><div><span className="reference-name">{image.name}</span><small>{image.width} × {image.height} px</small></div>
        </li>)}</ul></details> : null}
      </> : null}
      {run.instruction && (run.operation === 'revise' || run.operation === 'export' || run.operation === 'inspect' || !run.inputs) ? <><h3>{run.operation === 'revise' ? 'Revision request' : 'Request'}</h3><p className="flow-copy">{run.instruction}</p></> : null}
    </details>
    <details><summary>Model and timing details</summary><dl>
      <dt>Requested model</dt><dd>{run.requestedModel || 'No model call'}</dd><dt>Reported model</dt><dd>{run.model || '—'}</dd>
      <dt>Input / output tokens</dt><dd>{run.inputTokens ?? '—'} / {run.outputTokens ?? '—'}</dd>
      <dt>Cache read / written tokens</dt><dd>{run.cacheReadTokens ?? '—'} / {run.cacheWriteTokens ?? '—'}</dd>
      <dt>Rendering / model time</dt><dd>{run.renderMs === undefined ? '—' : `${(run.renderMs / 1000).toFixed(1)}s`} / {run.modelMs === undefined ? '—' : `${(run.modelMs / 1000).toFixed(1)}s`}</dd>
      <dt>Slide renders reused</dt><dd>{run.renderCacheHits ?? '—'}</dd>
      <dt>First output received</dt><dd>{run.firstTokenMs === undefined ? '—' : `${(run.firstTokenMs / 1000).toFixed(1)}s`}</dd>
      <dt>Reasoning tokens / effort</dt><dd>{run.thinkingTokens ?? '—'} / {run.effort ?? 'Provider default'}</dd>
    </dl><p className="field-hint">Times are observed stage durations. Failed or cancelled requests may have incomplete token totals.</p></details>
    {!running ? <RunFeedbackEditor run={run} disabled={disabled} onChange={feedback => onFeedback(runKey(run), feedback)} /> : null}
  </div>;
}
export function CreationFlow({ active, elapsedMs, runs, lastRun, disabled, onFeedback, onSave }: { active: RunRecord | null; elapsedMs: number; runs: RunRecord[]; lastRun: RunRecord | null; disabled: boolean; onFeedback: (key: string, feedback: RunFeedback) => void; onSave: () => void }) {
  const history = runs.length ? runs : lastRun ? [lastRun] : [];
  return <section className="creation-flow" aria-label="Creation flow">
    <details open={active ? true : undefined}><summary><strong>Creation flow</strong><span>{active ? `${labels[active.operation]} · ${Math.floor(elapsedMs / 1000)}s` : history[0] ? `${labels[history[0].operation]} · ${history[0].outcome}` : 'How your post is made'}</span></summary>
      <p className="field-hint">Optional website analysis → your instructions → AI slide generation → render checks → PNG export. Revisions use the current slide renders and saved instructions.</p>
      {active ? <RunDetails run={active} running elapsedMs={elapsedMs} disabled={disabled} onFeedback={onFeedback} /> : history[0] ? <RunDetails run={history[0]} elapsedMs={history[0].durationMs} disabled={disabled} onFeedback={onFeedback} /> : <p className="field-hint">Start an action to see its live stages, model, inputs and timings here.</p>}
      {(active ? history : history.slice(1)).length ? <details className="flow-history"><summary>Earlier activity ({(active ? history : history.slice(1)).length})</summary>
        {(active ? history : history.slice(1)).map((run, i) => <details key={run.id ?? `${run.startedAt}-${i}`}><summary>{labels[run.operation]} · {run.outcome} · {new Date(run.startedAt).toLocaleString()}{run.feedback ? ' · feedback' : ''}</summary><RunDetails run={run} elapsedMs={run.durationMs} disabled={disabled} onFeedback={onFeedback} /></details>)}
      </details> : null}
      {history.some(run => run.feedback) ? <><button type="button" disabled={disabled} onClick={onSave}>Save draft with feedback</button><p className="field-hint">Includes the last ten runs and retained outputs. Save a copy before older activity leaves the history.</p></> : null}
    </details>
  </section>;
}
