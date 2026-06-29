import puppeteer, { type Browser } from 'puppeteer';

/**
 * A single shared, lazily-launched headless browser, reused across screenshot
 * (M6) and PNG export. Pages are created/closed per job; the browser persists.
 */
let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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
