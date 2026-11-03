import { describe, expect, it } from 'vitest';
import { exportDeck } from './export';
import { inflateRawSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { storeAsset } from './assets';
import { renderSlide, captureSlide, inspectDeck } from './render';

// Inspect the central directory rather than assuming entries use a particular
// streaming ZIP flag. This verifies the actual downloadable artifact.
function unzip(buffer: Buffer) {
  const files: Array<{ name: string; data: Buffer }> = [];
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let position = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const compression = buffer.readUInt16LE(position + 10);
    const size = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const offset = buffer.readUInt32LE(position + 42);
    const name = buffer.toString('utf8', position + 46, position + 46 + nameLength);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const bytes = buffer.subarray(start, start + size);
    files.push({ name, data: compression === 8 ? inflateRawSync(bytes) : bytes });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('PNG export through the real sandboxed renderer', () => {
  it('waits for a delayed external image without enabling iframe scripts', async () => {
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 40, height: 40 });
      await page.setContent('<body style="background:red">');
      const bytes = await page.screenshot({ type: 'png' });
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (request.url() === 'https://example.com/delayed.png') {
          setTimeout(() => { void request.respond({ status: 200, contentType: 'image/png', body: bytes }); }, 150);
        } else void request.continue();
      });
      await renderSlide(page, { title: 'Image', width: 300, height: 400, slides: [{ html: '<img src="https://example.com/delayed.png"><p>Still sandboxed</p>' }] }, 0);
      const frame = await (await page.$('iframe'))!.contentFrame();
      expect(await frame!.evaluate(() => document.images[0].naturalWidth)).toBe(40);
      expect(await page.$eval('iframe', element => element.getAttribute('sandbox'))).toBe('');
    } finally { await browser.close(); }
  }, 15_000);
  it('reports clipped text and missing assets without rewriting the slide', async () => {
    const deck = { width: 300, height: 400, title: 'Diagnostics', slides: [{ html: '<p style="position:absolute;left:280px;white-space:nowrap">This text is clipped</p><img src="data:image/png;base64,broken">' }] };
    const operation = { signal: new AbortController().signal, progress: () => {}, usage: () => {} };
    const checked = await inspectDeck(deck, operation);
    expect(checked.slides[0].html).toBe(deck.slides[0].html);
    expect(checked.slides[0].diagnostics?.join(' ')).toContain('clipped text');
    expect(checked.slides[0].diagnostics?.join(' ')).toContain('failed to load');
  }, 15_000);
  it('reuses renders and invalidates on HTML or dimension changes', async () => {
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const deck = { width: 301, height: 401, title: 'Cache', slides: [{ html: '<p>Cache proof</p>' }] };
      expect((await captureSlide(page, deck, 0)).hit).toBe(false);
      const hit = await captureSlide(page, deck, 0); expect(hit.hit).toBe(true); expect(hit.png.readUInt32BE(16)).toBe(301);
      expect((await captureSlide(page, { ...deck, width: 302 }, 0)).hit).toBe(false);
      expect((await captureSlide(page, { ...deck, slides: [{ html: '<p>Changed</p>' }] }, 0)).hit).toBe(false);
      expect((await captureSlide(page, deck, 0, true)).hit).toBe(false);
    } finally { await browser.close(); }
  }, 15_000);
  it('uses retained originals offline and invalidates changed asset versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cb-render-assets-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage(); await page.setViewport({ width: 40, height: 40 });
      await page.setContent('<body style="background:red">'); const red = await storeAsset(await page.screenshot({ type: 'png' }), 'png');
      await page.setContent('<body style="background:blue">'); const blue = await storeAsset(await page.screenshot({ type: 'png' }), 'png');
      await page.setRequestInterception(true);
      page.on('request', request => { void (request.url().startsWith('https:') ? request.abort() : request.continue()); });
      const url = 'https://unavailable.example/photo.png';
      const deck = { width: 300, height: 400, title: 'Offline', assets: { [url]: red }, slides: [{ html: `<img src="${url}" style="width:300px;height:400px">` }] };
      const first = await captureSlide(page, deck, 0); expect(first.missing).toBe(0);
      expect((await captureSlide(page, deck, 0)).hit).toBe(true);
      expect((await captureSlide(page, { ...deck, assets: { ...deck.assets, 'https://example.com/unused.png': blue } }, 0)).hit).toBe(true);
      const changed = await captureSlide(page, { ...deck, assets: { [url]: blue } }, 0);
      expect(changed.hit).toBe(false); expect(changed.png.equals(first.png)).toBe(false);
    } finally { await browser.close(); cwd.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  }, 15_000);
  it('reports a failed font without changing the design', async () => {
    const deck = { width: 300, height: 400, title: 'Font', slides: [{ html: '<style>@font-face{font-family:Broken;src:url(data:font/woff2;base64,bm90LWEtZm9udA==)}p{font-family:Broken}</style><p>Fallback text</p>' }] };
    const checked = await inspectDeck(deck, { signal: new AbortController().signal, progress: () => {}, usage: () => {} });
    expect(checked.slides[0].diagnostics?.join(' ')).toContain('Font failed to load');
    expect(checked.slides[0].html).toBe(deck.slides[0].html);
  }, 15_000);
  it('exports every slide at the exact requested canvas dimensions', async () => {
    const zip = await exportDeck({ title: 'Render test', width: 480, height: 600, slides: [
      { html: '<style>body{background:#b201ff;display:grid;place-items:center}h1{color:white;font-size:44px}</style><h1>Exact words.</h1>' },
      { html: '<style>body{background:#ffcc00}</style><svg width="480" height="600"><circle cx="240" cy="300" r="140" fill="#135a40"/></svg>' },
    ] });
    const entries = unzip(zip);
    expect(entries.map(e => e.name)).toEqual(['slide-01.png', 'slide-02.png']);
    for (const entry of entries) {
      expect(entry.data.subarray(1, 4).toString()).toBe('PNG');
      expect(entry.data.readUInt32BE(16)).toBe(480);
      expect(entry.data.readUInt32BE(20)).toBe(600);
      expect(entry.data.byteLength).toBeGreaterThan(2500);
    }
    expect(entries[0].data.equals(entries[1].data)).toBe(false);
  }, 60_000);
});
