import puppeteer, { type Browser, type Page } from 'puppeteer';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { RequestError } from './http';

const privateNetworks = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const) privateNetworks.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]] as const) privateNetworks.addSubnet(ip, prefix, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  // BlockList also checks IPv4-mapped IPv6 addresses against IPv4 subnets.
  return privateNetworks.check(address, address.includes(':') ? 'ipv6' : 'ipv4');
}
export async function publicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new RequestError('Enter a full website URL, such as https://example.com.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new RequestError('Use a public HTTP or HTTPS website without credentials.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /\.(local|internal|localhost)$/.test(host)) throw new RequestError('Please use a public website.');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new RequestError('That website could not be found. Check its address.'); });
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) throw new RequestError('Please use a public website.');
  return url;
}

let browser: Promise<Browser> | undefined;
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = puppeteer.launch({ headless: true, timeout: 30_000 }).catch(error => { browser = undefined; throw error; });
  }
  const instance = await browser;
  if (!instance.connected) { browser = undefined; return getBrowser(); }
  return instance;
}
export async function withPage<T>(run: (page: Page) => Promise<T>, website = false, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const context = await (await getBrowser()).createBrowserContext();
  const cancel = () => { void context.close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const hosts = new Map<string, Promise<unknown>>();
    await page.setRequestInterception(true);
    page.on('request', request => {
      void (async () => {
        const raw = request.url();
        if (raw.startsWith('data:') || raw === 'about:blank' || raw === 'about:srcdoc') { await request.continue(); return; }
        if (!website && request.isNavigationRequest()) { await request.abort(); return; }
        if (request.method() !== 'GET') { await request.abort(); return; }
        const url = new URL(raw);
        if (!hosts.has(url.origin)) hosts.set(url.origin, publicUrl(url.href));
        await hosts.get(url.origin);
        await request.continue();
      })().catch(() => { if (!request.isInterceptResolutionHandled()) void request.abort().catch(() => {}); });
    });
    const value = await run(page);
    signal?.throwIfAborted();
    return value;
  } finally { signal?.removeEventListener('abort', cancel); await context.close().catch(() => {}); }
}
