import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError } from './http';

/**
 * SSRF guard for user-supplied URLs that the server itself will fetch (brand
 * analysis drives Puppeteer at them; logo download fetches them). Without this,
 * "analyze my website" can be pointed at localhost, the LAN, or cloud metadata
 * (169.254.169.254). Best-effort by design — a DNS answer can change between
 * check and fetch — but it removes the drive-by cases.
 *
 * Set ALLOW_PRIVATE_URLS=true to disable (e.g. analyzing a site on localhost
 * during development).
 */

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    // v4-mapped v6 (::ffff:127.0.0.1) → recheck as v4.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    return v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd');
  }
  return PRIVATE_V4.some((re) => re.test(ip));
}

/** Validate an outbound URL: http(s) only, and not resolving to a private address. */
export async function assertPublicHttpUrl(raw: string, label = 'URL'): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, `${label} is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError(400, `${label} must use http or https.`);
  }
  if (process.env.ALLOW_PRIVATE_URLS === 'true') return url;

  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ApiError(400, `${label} points at a private host. Set ALLOW_PRIVATE_URLS=true to allow this in development.`);
  }
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        throw new ApiError(400, `${label} resolves to a private address. Set ALLOW_PRIVATE_URLS=true to allow this in development.`);
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, `${label} could not be resolved.`);
  }
  return url;
}
