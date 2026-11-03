import { z } from 'zod';
import { body, checkOrigin, failure } from '@/lib/http';
import { draftIdSchema, postSchema } from '@/lib/drafts';
import { deleteDraft, listDrafts, openDraft, saveDraft } from '@/lib/draft-store';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { checkOrigin(request); return Response.json({ drafts: await listDrafts() }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const input = await body(request, z.discriminatedUnion('action', [
      z.object({ action: z.literal('save'), post: postSchema }),
      z.object({ action: z.literal('open'), id: draftIdSchema }),
      z.object({ action: z.literal('delete'), id: draftIdSchema }),
    ]), 32 * 1024 * 1024);
    if (input.action === 'save') return Response.json(await saveDraft(input.post));
    if (input.action === 'open') return Response.json({ post: await openDraft(input.id) });
    await deleteDraft(input.id); return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
