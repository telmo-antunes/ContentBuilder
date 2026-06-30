import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Opt-in HTTP Basic auth for the web UI (Edge runtime).
 *
 * Auth is DISABLED by default: if `process.env.APP_PASSWORD` is unset or empty,
 * every request passes through untouched so local development keeps working.
 * Set `APP_PASSWORD` to gate the UI behind a Basic-auth prompt.
 *
 * `/render` is intentionally excluded from the matcher below: the PNG export
 * pipeline (Puppeteer) navigates to `/render?...` server-side with NO
 * Authorization header, so gating it would break ZIP export. `_next` assets and
 * common static files are excluded too. This runs on the Edge runtime, so we
 * decode credentials with `atob` (Node's `Buffer` is unavailable here).
 */

/** Constant-time-ish string compare to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="ContentBuilder", charset="UTF-8"',
    },
  });
}

export function middleware(request: NextRequest): NextResponse {
  const expected = process.env.APP_PASSWORD;

  // Auth disabled by default — no password configured.
  if (!expected) {
    return NextResponse.next();
  }

  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Basic ')) {
    return unauthorized();
  }

  let decoded: string;
  try {
    // Edge runtime: use atob, not Node's Buffer (unavailable here).
    decoded = atob(header.slice('Basic '.length).trim());
  } catch {
    return unauthorized();
  }

  // Format is "username:password" — ignore the username.
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return unauthorized();
  }
  const password = decoded.slice(separatorIndex + 1);

  if (!safeEqual(password, expected)) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!render|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js)$).*)',
  ],
};
