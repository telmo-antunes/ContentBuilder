import { storeAsset } from './assets';
import type { Deck } from './schema';
import type { Operation } from './operation';

// Slides link Google Fonts stylesheets. Keeping a copy (font files inlined) makes previews,
// exports and portable drafts render the same type without the network.
const STYLESHEET = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)<>]+/g;
const FONT_FILE = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)/g;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_FILE = 1024 * 1024, MAX_STYLESHEET = 4 * 1024 * 1024;

export function fontStylesheets(deck: Deck): string[] {
  return [...new Set(deck.slides.flatMap(slide => [...slide.html.matchAll(STYLESHEET)].map(match => match[0].replaceAll('&amp;', '&'))))];
}

// Keep the Latin subsets; Instagram copy for these brands never needs the others.
function latinOnly(css: string) {
  const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/);
  const latin = blocks.filter(block => /^\/\*\s*latin(?:-ext)?\s*\*\//.test(block));
  return latin.length ? latin.join('') : css;
}

async function retain(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': BROWSER }, signal });
  if (!response.ok) throw new Error(`Font stylesheet returned ${response.status}`);
  let css = latinOnly(await response.text());
  let total = css.length;
  for (const file of [...new Set([...css.matchAll(FONT_FILE)].map(match => match[1]))]) {
    const font = await fetch(file, { signal });
    const bytes = Buffer.from(await font.arrayBuffer());
    if (!font.ok || bytes.length > MAX_FILE || (total += bytes.length * 1.34) > MAX_STYLESHEET) throw new Error('Font files are unavailable or too large to keep.');
    const type = /\.woff2(\?|$)/.test(file) ? 'font/woff2' : /\.woff(\?|$)/.test(file) ? 'font/woff' : 'font/ttf';
    css = css.replaceAll(file, `data:${type};base64,${bytes.toString('base64')}`);
  }
  return storeAsset(Buffer.from(css), 'css');
}

/** Adds a retained copy for every Google Fonts stylesheet the deck links. A font that cannot be kept stays remote. */
export async function retainFonts(deck: Deck, operation: Operation): Promise<Deck> {
  const missing = fontStylesheets(deck).filter(url => !deck.assets?.[url]);
  if (!missing.length) return deck;
  operation.progress('Keeping a copy of the fonts…');
  const kept = await Promise.all(missing.map(async url => {
    try { return [url, await retain(url, operation.signal)] as const; }
    catch { operation.signal.throwIfAborted(); return null; }
  }));
  return { ...deck, assets: { ...deck.assets, ...Object.fromEntries(kept.filter((item): item is readonly [string, string] => !!item)) } };
}
