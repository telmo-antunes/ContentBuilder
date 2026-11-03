import { describe, expect, it } from 'vitest';
import { appendStage, recordRun } from './flow';
import { emptyWorkspace, workspaceSchema, type RunRecord } from './schema';
const run: RunRecord = { operation: 'generate', startedAt: '2026-11-02T12:00:00Z', durationMs: 2000, instruction: 'Create', outcome: 'success' };
const output = { width: 1080, height: 1350, title: 'Original', slides: [{ html: '<h1>Original</h1>' }] };
describe('creation activity', () => {
  it('keeps no deck copies in the run log, since the versions hold them', () => {
    let workspace = recordRun(emptyWorkspace, { ...run, id: 'first', output });
    workspace = recordRun({ ...workspace, recentRuns: [{ ...run, id: 'legacy', output }] }, { ...run, id: 'second' });
    expect(workspace.recentRuns.map(item => item.output)).toEqual([undefined, undefined]);
    expect(workspace.lastRun?.id).toBe('second');
  });
  it('records distinct stages with monotonic elapsed times', () => {
    const steps = appendStage([], 'Preparing', 0);
    expect(appendStage(steps, 'Preparing', 20)).toBe(steps);
    expect(appendStage(appendStage(steps, 'Writing', 500), 'Checking', 450)).toEqual([{ message: 'Preparing', elapsedMs: 0 }, { message: 'Writing', elapsedMs: 500 }, { message: 'Checking', elapsedMs: 500 }]);
  });
  it('keeps the latest ten outcomes even when a deck patch contains older history', () => {
    let workspace = emptyWorkspace;
    for (let i = 0; i < 12; i++) workspace = recordRun(workspace, { ...run, id: String(i), outcome: i === 11 ? 'cancelled' : i === 10 ? 'failed' : 'success' }, { ...emptyWorkspace, brief: 'Updated' });
    expect(workspace.recentRuns.map(r => r.id)).toEqual(['11', '10', '9', '8', '7', '6', '5', '4', '3', '2']);
    expect(workspace.lastRun).toEqual(workspace.recentRuns[0]);
    expect(workspace.recentRuns.slice(0, 2).map(r => r.outcome)).toEqual(['cancelled', 'failed']);
    expect(workspace.brief).toBe('Updated');
  });
  it('loads older workspaces with independent default model choices and empty activity', () => {
    const { models, recentRuns, ...legacy } = emptyWorkspace;
    expect(workspaceSchema.parse(legacy)).toEqual(emptyWorkspace);
    const loaded = workspaceSchema.parse({ ...legacy, lastRun: run });
    expect(recordRun(loaded, { ...run, id: 'new' }).recentRuns).toEqual([{ ...run, id: 'new' }, run]);
  });
});
