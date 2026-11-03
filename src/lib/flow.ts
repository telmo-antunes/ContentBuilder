import type { RunRecord, Workspace } from './schema';

export function appendStage(steps: NonNullable<RunRecord['steps']>, message: string, elapsedMs: number) {
  if (steps[steps.length - 1]?.message === message) return steps;
  return [...steps, { message, elapsedMs: Math.max(0, steps[steps.length - 1]?.elapsedMs ?? 0, elapsedMs) }];
}
export function recordRun(workspace: Workspace, run: RunRecord, patch?: Partial<Workspace>): Workspace {
  const history = workspace.recentRuns.length ? workspace.recentRuns : workspace.lastRun ? [workspace.lastRun] : [];
  const recentRuns = withoutOutputs([run, ...history].slice(0, 10));
  return { ...workspace, ...patch, lastRun: recentRuns[0], recentRuns };
}
// The version history already holds every deck; run records keep only what happened.
function withoutOutputs(runs: RunRecord[]) {
  return runs.map(run => { if (!run.output) return run; const { output, ...withoutOutput } = run; return withoutOutput; });
}
