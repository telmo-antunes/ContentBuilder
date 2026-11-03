import { failure } from '@/lib/http';
import { receiveReference } from '@/lib/reference-upload';

export async function POST(request: Request) {
  try { return Response.json(await receiveReference(request)); }
  catch (error) { return failure(error); }
}
