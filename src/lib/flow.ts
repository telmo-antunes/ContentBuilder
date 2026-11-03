import type { RunFeedback, RunRecord, Workspace } from './schema';

export function appendStage(steps: NonNullable<RunRecord['steps']>, message: string, elapsedMs: number) {
  if (steps[steps.length - 1]?.message === message) return steps;
  return [...steps, { message, elapsedMs: Math.max(0, steps[steps.length - 1]?.elapsedMs ?? 0, elapsedMs) }];
}
export function recordRun(workspace: Workspace, run: RunRecord, patch?: Partial<Workspace>): Workspace {
  const history = workspace.recentRuns.length ? workspace.recentRuns : workspace.lastRun ? [workspace.lastRun] : [];
  const recentRuns = retainOutputs([run, ...history].slice(0, 10));
  return { ...workspace, ...patch, lastRun: recentRuns[0], recentRuns };
}
export function runKey(run: RunRecord) { return run.id ?? `${run.operation}:${run.startedAt}:${run.instruction}`; }
function retainOutputs(runs: RunRecord[]) {
  let keptLatest = false;
  return runs.map(run => {
    if (!run.output) return run;
    if (!keptLatest) { keptLatest = true; return run; }
    if (run.feedback) return run;
    const { output, ...withoutOutput } = run; return withoutOutput;
  });
}
export function updateRunFeedback(workspace: Workspace, key: string, feedback: RunFeedback): Workspace {
  const history = workspace.recentRuns.length ? workspace.recentRuns : workspace.lastRun ? [workspace.lastRun] : [];
  const recentRuns = retainOutputs(history.map(run => {
    if (runKey(run) !== key) return run;
    if (feedback.categories.length || feedback.note.trim()) return { ...run, feedback: { ...feedback, categories: [...new Set(feedback.categories)] } };
    const { feedback: removed, ...withoutFeedback } = run; return withoutFeedback;
  }));
  return { ...workspace, recentRuns, lastRun: workspace.lastRun ? recentRuns.find(run => runKey(run) === runKey(workspace.lastRun!)) ?? workspace.lastRun : null };
}
