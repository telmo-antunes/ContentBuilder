import puppeteer, { type Browser } from 'puppeteer';

/**
 * A single shared, lazily-launched headless browser, reused across screenshot
 * (M6) and PNG export. Pages are created/closed per job; the browser persists.
 */
let browserPromise: Promise<Browser> | null = null;

/**
 * How long a launch may take before it is treated as failed.
 *
 * Puppeteer has its own launch timeout, but it does not cover every way a
 * launch can wedge — and the memoised promise below turns one wedged launch
 * into a permanent one. Compose hung three times and persisted nothing; each
 * wedged run left a `__render-check-*` scaffold behind, which is the signature
 * of getting past the scaffold and never returning from here.
 */
const LAUNCH_TIMEOUT_MS = 60_000;

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    /**
     * A HUNG LAUNCH MUST NOT BE CACHED.
     *
     * `browserPromise` is memoised so one browser is shared, which is right —
     * but a promise that never settles is then handed to every later caller,
     * and the whole render path waits on it forever with no way back short of
     * a restart. The ceiling makes the launch fail instead, and the `catch`
     * clears the slot so the NEXT caller launches again rather than joining a
     * queue behind a corpse.
     */
    const launch = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    browserPromise = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          launch,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`browser launch exceeded ${LAUNCH_TIMEOUT_MS}ms`)), LAUNCH_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    browserPromise.catch(() => {
      browserPromise = null;
      // Never leave a browser running that nobody holds a reference to.
      void launch.then((b) => b.close()).catch(() => {});
    });
  }
  const browser = await browserPromise;
  // Relaunch if a previous crash disconnected it.
  if (browser.connected === false) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* ignore */
  } finally {
    browserPromise = null;
  }
}
