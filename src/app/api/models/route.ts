import { modelCatalog } from '@/lib/models';
import { checkOrigin, failure } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { checkOrigin(request); return Response.json(await modelCatalog(new URL(request.url).searchParams.has('refresh'), request.signal)); }
  catch (error) { return failure(error); }
}
