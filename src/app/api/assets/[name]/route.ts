import { readImage, assetType } from '@/lib/assets';
import { checkOrigin, failure } from '@/lib/http';

export async function GET(request: Request, { params }: { params: { name: string } }) {
  try {
    checkOrigin(request);
    return new Response(new Uint8Array(await readImage(`/api/assets/${params.name}`)), {
      headers: { 'Content-Type': assetType(params.name), 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  } catch (error) { return failure(error); }
}
