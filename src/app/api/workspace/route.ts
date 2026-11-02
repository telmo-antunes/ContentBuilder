import { readWorkspace, saveWorkspace } from '@/lib/storage';
import { workspaceSchema } from '@/lib/schema';
import { aiConfigured } from '@/lib/ai';
import { body, failure, checkOrigin } from '@/lib/http';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { checkOrigin(request); return Response.json({ ...await readWorkspace(), configured: aiConfigured() }); }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const input = await body(request, z.object({ workspace: workspaceSchema, version: z.string() }));
    return Response.json(await saveWorkspace(input.workspace, input.version));
  }
  catch (error) { return failure(error); }
}
