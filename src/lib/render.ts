import type { Page } from 'puppeteer';
import { withPage } from './browser';
import { slideDocument } from './document';
import type { Deck } from './schema';
import { RequestError } from './http';
import type { Operation } from './operation';
import { deckAssetData } from './assets';
import { cacheKey, cached, remember } from './cache';

export async function renderSlide(page: Page, deck: Deck, index: number, strictImages = true) {
  const failures = new Set<string>();
  const failed = (request: import('puppeteer').HTTPRequest) => { if (['image', 'font', 'stylesheet'].includes(request.resourceType())) failures.add(`A ${request.resourceType()} could not load: ${request.url().slice(0, 160)}`); };
  const response = (item: import('puppeteer').HTTPResponse) => { if (item.status() >= 400) failed(item.request()); };
  page.on('requestfailed', failed); page.on('response', response);
  try {
  await page.setViewport({ width: deck.width, height: deck.height, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html><body style="margin:0"><iframe sandbox="" style="border:0;display:block;width:100vw;height:100vh"></iframe></body></html>');
  const frame = await (await page.$('iframe'))!.contentFrame();
  if (!frame) throw new RequestError(`Slide ${index + 1} could not be rendered.`, 422);
  // Observe the browser's native load lifecycle. JavaScript polling callbacks
  // can be blocked inside an empty-sandbox iframe while images are loading.
  try {
    await Promise.all([
      frame.waitForNavigation({ waitUntil: 'load', timeout: 30_000 }),
      page.$eval('iframe', (element, html) => { element.srcdoc = html; }, slideDocument(deck.slides[index].html, await deckAssetData(deck))),
    ]);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new RequestError(`Slide ${index + 1} took too long to load an image or font. Try the export again or revise the unavailable asset.`, 422);
    throw error;
  }
  const missing = await frame.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {})));
    return Array.from(document.images).filter(image => !image.naturalWidth).length;
  });
  if (strictImages && missing) throw new RequestError(`Slide ${index + 1} has ${missing} image(s) that could not load. Revise the slide or try the export again.`, 422);
  const diagnostics = await frame.evaluate(() => {
    const issues: string[] = [];
    for (const font of document.fonts) if (font.status === 'error') issues.push(`Font failed to load: ${font.family}`);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) && issues.length < 8) {
      const parent = node.parentElement;
      if (!parent || ['STYLE', 'SCRIPT'].includes(parent.tagName) || !node.textContent?.trim()) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter(r => r.width && r.height);
      let clipped = rects.some(r => r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2);
      for (let ancestor: Element | null = parent; ancestor && !clipped; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor); const box = ancestor.getBoundingClientRect();
        if (['hidden', 'clip'].includes(css.overflowX)) clipped ||= rects.some(r => r.left < box.left - 2 || r.right > box.right + 2);
        if (['hidden', 'clip'].includes(css.overflowY)) clipped ||= rects.some(r => r.top < box.top - 2 || r.bottom > box.bottom + 2);
      }
      if (clipped) issues.push(`Possible clipped text: “${node.textContent.trim().slice(0, 100)}”`);
    }
    return issues;
  });
  return { missing, renderedText: await frame.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim()), diagnostics: [...(missing ? [`${missing} image(s) failed to load.`] : []), ...failures, ...diagnostics] };
  } finally { page.off('requestfailed', failed); page.off('response', response); }
}

export interface SlideCapture { png: Buffer; jpeg: string; diagnostics: string[]; missing: number; renderedText: string }
export async function captureSlide(page: Page, deck: Deck, index: number, fresh = false): Promise<SlideCapture & { hit: boolean }> {
  const html = deck.slides[index].html;
  const source = { ...deck, assets: Object.fromEntries(Object.entries(deck.assets ?? {}).filter(([url]) => html.includes(url) || html.includes(url.replaceAll('&', '&amp;')))) };
  const key = cacheKey(['render-v4', source.width, source.height, html, Object.entries(source.assets).sort()]);
  const previous = fresh ? undefined : cached<SlideCapture>(key);
  if (previous) return { ...previous, hit: true };
  const report = await renderSlide(page, source, index, false);
  const png = Buffer.from(await page.screenshot({ type: 'png' }));
  const jpeg = `data:image/jpeg;base64,${Buffer.from(await page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64')}`;
  const result = { png, jpeg, ...report };
  // Remote fonts/backgrounds can change. Keep those captures for only 30 seconds.
  const document = slideDocument(html, await deckAssetData(source));
  const external = /(?:src|href)=["']https?:|url\(["']?https?:|@import[\s"']+https?:/i.test(document);
  if (!report.missing && !report.diagnostics.some(d => /could not load|failed to load/.test(d))) remember(key, result, png.length + jpeg.length, external ? 30_000 : undefined);
  return { ...result, hit: false };
}

export async function inspectDeck(deck: Deck, operation: Operation, fresh = false): Promise<Deck> {
  const start = Date.now(); let hits = 0;
  const slides = await withPage(async page => {
    const output: Deck['slides'] = [];
    for (const [index, slide] of deck.slides.entries()) {
      operation.signal.throwIfAborted(); operation.progress(`Checking slide ${index + 1} of ${deck.slides.length}…`);
      try { const capture = await captureSlide(page, deck, index, fresh); hits += Number(capture.hit); output.push({ ...slide, diagnostics: capture.diagnostics, renderedText: capture.renderedText }); }
      catch (error) { operation.signal.throwIfAborted(); output.push({ ...slide, diagnostics: [`Render check incomplete: ${(error as Error).message}`] }); }
    }
    return output;
  }, false, operation.signal);
  operation.usage({ renderMs: Date.now() - start, renderCacheHits: hits });
  return { ...deck, slides };
}

export interface VisualReference { label: string; data: string }
export async function imageSheets(images: VisualReference[], signal?: AbortSignal): Promise<VisualReference[]> {
  signal?.throwIfAborted();
  const key = cacheKey(['sheets-v1', images]);
  const previous = cached<VisualReference[]>(key); if (previous) return previous;
  const result = await buildImageSheets(images, signal);
  remember(key, result, JSON.stringify(result).length); return result;
}
async function buildImageSheets(images: VisualReference[], signal?: AbortSignal): Promise<VisualReference[]> {
  if (!images.length) return [];
  return withPage(async page => {
    const sheets: VisualReference[] = [];
    for (let start = 0; start < images.length; start += 12) {
      signal?.throwIfAborted();
      const group = images.slice(start, start + 12);
      await page.setViewport({ width: 1000, height: Math.ceil(group.length / 4) * 270, deviceScaleFactor: 1 });
      await page.setContent('<html><body style="margin:0;background:#eeeeea;font:14px sans-serif;display:grid;grid-template-columns:repeat(4,250px)"></body></html>');
      await page.evaluate(items => {
        for (const item of items) {
          const card = document.createElement('div'); card.style.cssText = 'padding:10px;height:270px;box-sizing:border-box';
          const image = document.createElement('img'); image.src = item.data; image.style.cssText = 'width:230px;height:225px;object-fit:contain';
          const label = document.createElement('div'); label.textContent = item.label;
          card.append(image, label); document.body.append(card);
        }
      }, group);
      await page.evaluate(async () => { await Promise.all(Array.from(document.images).map(image => image.decode())); });
      sheets.push({ label: group.map(i => i.label).join(', '), data: `data:image/jpeg;base64,${Buffer.from(await page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64')}` });
    }
    return sheets;
  }, false, signal);
}

/** Shrink full-size captures for the model: enough to judge type and spacing, far fewer tokens. */
export async function downscale(images: VisualReference[], width: number, signal?: AbortSignal): Promise<VisualReference[]> {
  if (!images.length) return [];
  const key = cacheKey(['downscale-v1', width, images]);
  const previous = cached<VisualReference[]>(key); if (previous) return previous;
  const result = await withPage(async page => {
    const output: VisualReference[] = [];
    for (const image of images) {
      signal?.throwIfAborted();
      await page.setViewport({ width, height: width, deviceScaleFactor: 1 });
      await page.setContent('<html><body style="margin:0"><img style="display:block;width:100%;height:auto"></body></html>');
      const height = await page.$eval('img', async (element, data) => { element.src = data; await element.decode(); return element.getBoundingClientRect().height; }, image.data);
      await page.setViewport({ width, height: Math.max(1, Math.ceil(height)), deviceScaleFactor: 1 });
      output.push({ label: image.label, data: `data:image/jpeg;base64,${Buffer.from(await page.screenshot({ type: 'jpeg', quality: 82 })).toString('base64')}` });
    }
    return output;
  }, false, signal);
  remember(key, result, JSON.stringify(result).length); return result;
}

export async function revisionImages(deck: Deck, index: number | undefined, operation: Operation): Promise<VisualReference[]> {
  const start = Date.now(); let hits = 0;
  const images = await withPage(async page => {
    const output: VisualReference[] = [];
    const indices = index === undefined ? deck.slides.map((_, i) => i) : [index];
    for (const i of indices) {
      operation.progress(`Rendering slide ${i + 1} for the revision…`);
      const capture = await captureSlide(page, deck, i); hits += Number(capture.hit);
      output.push({ label: `Slide ${i + 1}`, data: capture.jpeg });
    }
    return output;
  }, false, operation.signal);
  // Up to ten slides go one by one at phone-review size; bigger decks fall back to contact sheets.
  const result = index === undefined && images.length > 10 ? await imageSheets(images, operation.signal) : await downscale(images, 540, operation.signal);
  operation.usage({ renderMs: Date.now() - start, renderCacheHits: hits }); return result;
}
