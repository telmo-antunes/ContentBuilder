import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { draftIdSchema, postSchema, summarize, type DraftSummary, type Post } from './drafts';
import { RequestError } from './http';

// One file per post set aside, next to the workspace.
const directory = resolve(process.cwd(), '.data', 'drafts');
const MAX_DRAFTS = 40;
const fileSchema = z.object({ id: draftIdSchema, savedAt: z.string(), post: postSchema });
const fileOf = (id: string) => resolve(directory, `${draftIdSchema.parse(id)}.json`);

async function readDraft(id: string): Promise<z.infer<typeof fileSchema>> {
  try { return fileSchema.parse(JSON.parse(await readFile(fileOf(id), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RequestError('This draft is no longer saved.', 404);
    throw error;
  }
}
export async function listDrafts(): Promise<DraftSummary[]> {
  let names: string[] = [];
  try { names = (await readdir(directory)).filter(name => name.endsWith('.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const drafts = await Promise.all(names.map(async name => {
    try { const draft = await readDraft(name.slice(0, -5)); return summarize(draft.id, draft.savedAt, draft.post); }
    catch { return null; }
  }));
  return drafts.filter((draft): draft is DraftSummary => !!draft).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function saveDraft(post: Post): Promise<DraftSummary> {
  const id = randomUUID(); const savedAt = new Date().toISOString();
  await mkdir(directory, { recursive: true });
  const temporary = resolve(directory, `${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify({ id, savedAt, post }), { mode: 0o600 }); await rename(temporary, fileOf(id)); }
  finally { await rm(temporary, { force: true }); }
  // Keep the newest drafts; the oldest fall away.
  const all = await listDrafts();
  await Promise.all(all.slice(MAX_DRAFTS).map(draft => rm(fileOf(draft.id), { force: true })));
  return summarize(id, savedAt, post);
}
export async function openDraft(id: string): Promise<Post> { return (await readDraft(id)).post; }
export async function deleteDraft(id: string): Promise<void> { await rm(fileOf(id), { force: true }); }
