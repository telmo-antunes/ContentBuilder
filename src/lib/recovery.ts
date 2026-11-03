import { workspaceSchema, type Workspace } from './schema';
export const recoveryPrefix = 'contentbuilder-pending-v1:';
// keptStacks: the backup leaves out versions that were already saved on the server.
export interface Recovery { workspace: Workspace; version: string; savedAt: number; key: string; keptStacks?: boolean }
export function readRecovery(storage: Pick<Storage, 'getItem'>, key: string): Recovery | null {
  try {
    const raw = JSON.parse(storage.getItem(key) ?? 'null');
    if (!raw || typeof raw.version !== 'string' || typeof raw.savedAt !== 'number') return null;
    const workspace = workspaceSchema.safeParse(raw.workspace);
    return workspace.success ? { workspace: workspace.data, version: raw.version, savedAt: raw.savedAt, key, ...(raw.keptStacks === true ? { keptStacks: true } : {}) } : null;
  } catch { return null; }
}
export function writeRecovery(storage: Pick<Storage, 'setItem'>, key: string, workspace: Workspace, version: string, keptStacks = false) {
  storage.setItem(key, JSON.stringify({ workspace, version, savedAt: Date.now(), ...(keptStacks ? { keptStacks } : {}) }));
}
