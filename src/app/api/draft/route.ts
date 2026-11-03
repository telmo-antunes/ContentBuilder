import { z } from 'zod';
import { body, failure } from '@/lib/http';
import { workspaceSchema } from '@/lib/schema';
import { packWorkspace, unpackWorkspace, portableSchema } from '@/lib/portable';
export async function POST(request: Request) {
  try {
    const input = await body(request, z.discriminatedUnion('action', [
      z.object({ action: z.literal('save'), workspace: workspaceSchema }),
      z.object({ action: z.literal('open'), bundle: portableSchema }),
    ]), 64 * 1024 * 1024);
    return Response.json(input.action === 'save' ? await packWorkspace(input.workspace) : await unpackWorkspace(input.bundle));
  } catch (error) { return failure(error); }
}
