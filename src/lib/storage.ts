import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { emptyWorkspace, workspaceSchema, type Workspace } from './schema';
import { externalizeBrand } from './assets';
import { RequestError } from './http';
import { stacksOf } from './history';

const directory = resolve(process.cwd(), '.data');
const file = resolve(directory, 'workspace.json');
const queues = globalThis as typeof globalThis & { contentBuilderSaves?: Map<string, Promise<unknown>> };
queues.contentBuilderSaves ??= new Map();
export interface SavedWorkspace { workspace: Workspace; version: string }

export async function readWorkspace(): Promise<SavedWorkspace> {
  try {
    const raw = await readFile(file, 'utf8');
    const value = JSON.parse(raw);
    const workspace = workspaceSchema.parse(value.workspace ?? value);
    return { workspace: { ...workspace, brand: await externalizeBrand(workspace.brand), references: await Promise.all(workspace.references.map(async brand => (await externalizeBrand(brand))!)) },
      version: value.version ?? createHash('sha256').update(raw).digest('hex') };
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { workspace: emptyWorkspace, version: 'empty' };
    throw error;
  }
}
export function saveWorkspace(workspace: Workspace, expectedVersion: string, keepStacks = false): Promise<SavedWorkspace> {
  const save = (queues.contentBuilderSaves!.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const current = await readWorkspace();
    if (current.version !== expectedVersion) throw new RequestError('This draft changed in another tab. Download your local draft if needed, then load the latest saved version.', 409);
    // The client left out unchanged versions; keep the stored ones.
    if (keepStacks) workspace = { ...workspace, ...stacksOf(current.workspace) };
    const saved = { workspace: { ...workspace, brand: await externalizeBrand(workspace.brand), references: await Promise.all((workspace.references ?? []).map(async brand => (await externalizeBrand(brand))!)) }, version: randomUUID() };
    await mkdir(directory, { recursive: true });
    const temporary = resolve(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    return saved;
  });
  queues.contentBuilderSaves!.set(file, save);
  return save;
}
