/// <reference lib="dom" />
// The page.evaluate() callbacks below run in the browser, so DOM globals
// (document, Element, location, …) are valid there — pull DOM types into this
// file for them. The surrounding code is still ordinary Node.
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Vibrant } from 'node-vibrant/node';
import { mapToBundledFont } from '@contentbuilder/shared';
import type { StoredMedia } from '@contentbuilder/shared';
import { getBrowser } from './browser';
import { getStorage } from '../storage';

export interface PaletteColor {
  hex: string;
  population: number;
  /** HSL as [h(0-360), s(0-1), l(0-1)]. */
  hsl: [number, number, number];
}

export interface Extraction {
  palette: PaletteColor[];
  detectedFonts: { heading: string; body: string };
  renderFonts: { heading: string; body: string };
  logo?: { sourceUrl: string } & StoredMedia;
  screenshot: StoredMedia;
  /** Base64 PNG (≤768px long edge) for the one vision call. */
  downscaledBase64: string;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const EXT_BY_CT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

/** Extract everything deterministic from a website (no AI here). */
export async function extractBrand(url: string, businessId: string): Promise<Extraction> {
  const browser = await getBrowser();
  const storage = getStorage();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });

    // Best-effort consent handling. First try the privacy-preserving option —
    // click a "reject / decline / necessary only" control if one is obvious —
    // then hide any leftover fixed/sticky overlay so it doesn't pollute the
    // screenshot or palette. We never click "accept".
    await page.evaluate(() => {
      const rejectRe = /^(reject|decline|refuse|necessary only|only necessary|essential only|deny)/i;
      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"], a'),
      ) as HTMLElement[];
      const rejectBtn = buttons.find((b) => rejectRe.test((b.textContent ?? '').trim()));
      if (rejectBtn) {
        try {
          rejectBtn.click();
        } catch {
          /* ignore */
        }
      }

      const selectors = [
        '[id*="cookie" i]',
        '[class*="cookie" i]',
        '[id*="consent" i]',
        '[class*="consent" i]',
        '[id*="onetrust" i]',
        '[class*="onetrust" i]',
        '[id*="cookiebot" i]',
        '[id*="gdpr" i]',
        '[class*="gdpr" i]',
        '[aria-label*="cookie" i]',
        '[aria-label*="consent" i]',
        '[role="dialog"]',
        '[role="alertdialog"]',
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const cs = getComputedStyle(el as Element);
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (cs.position === 'fixed' || cs.position === 'sticky' || rect.height > 160) {
            (el as HTMLElement).remove();
          }
        });
      }
      // Also drop any remaining full-width fixed bar pinned to the viewport edges.
      document.querySelectorAll('body *').forEach((el) => {
        const cs = getComputedStyle(el as Element);
        if (cs.position !== 'fixed') return;
        const r = (el as HTMLElement).getBoundingClientRect();
        const pinned = r.bottom >= window.innerHeight - 4 || r.top <= 4;
        if (pinned && r.width > window.innerWidth * 0.6 && r.height > 60 && r.height < window.innerHeight * 0.5) {
          (el as HTMLElement).remove();
        }
      });
      (document.documentElement as HTMLElement).style.overflow = 'auto';
      if (document.body) document.body.style.overflow = 'auto';
    });
    await new Promise((r) => setTimeout(r, 250));

    await page.evaluate(async () => {
      const d = document as Document & { fonts?: { ready: Promise<unknown> } };
      if (d.fonts?.ready) await d.fonts.ready;
    });
    await new Promise((r) => setTimeout(r, 500));

    // ── Fonts (computed) ────────────────────────────────────────────────────
    // NOTE: keep these callbacks free of named arrow/function consts — esbuild
    // (tsx) wraps those in a `__name()` helper that doesn't exist in the page.
    const detected = await page.evaluate(() => {
      const heading =
        document.querySelector('h1') ??
        document.querySelector('h2') ??
        document.querySelector('[class*="title" i], [class*="heading" i]');
      const body =
        document.querySelector('p') ?? document.querySelector('article, main') ?? document.body;
      return {
        heading: heading ? getComputedStyle(heading).fontFamily : '',
        body: body ? getComputedStyle(body).fontFamily : '',
      };
    });

    // ── Logo (DOM) ────────────────────────────────────────────────────────────
    const logoUrl = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const logoImg = imgs.find((i) =>
        /logo/i.test(
          `${i.getAttribute('src') ?? ''} ${i.getAttribute('alt') ?? ''} ${i.className ?? ''} ${i.id ?? ''}`,
        ),
      );
      const candidate =
        logoImg?.getAttribute('src') ??
        document
          .querySelector('meta[property="og:image"], meta[name="og:image"]')
          ?.getAttribute('content') ??
        document
          .querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
          ?.getAttribute('href') ??
        null;
      if (!candidate) return null;
      try {
        return new URL(candidate, location.href).href;
      } catch {
        return null;
      }
    });

    // ── Screenshot (viewport) ────────────────────────────────────────────────
    const shot = Buffer.from(await page.screenshot({ type: 'png' }));
    const screenshot = await storage.save(`brand/${businessId}/home-${randomUUID()}.png`, shot, {
      contentType: 'image/png',
    });

    // ── Palette (node-vibrant) ──────────────────────────────────────────────
    const swatches = await Vibrant.from(shot).getPalette();
    const palette: PaletteColor[] = Object.values(swatches)
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ hex: s.hex.toUpperCase(), population: s.population, hsl: s.hsl as [number, number, number] }));
    const palDeduped = dedupeByHex(palette).sort((a, b) => b.population - a.population);

    // ── Downscaled image for the vision call (≤768px long edge) ──────────────
    const small = await sharp(shot).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const downscaledBase64 = small.toString('base64');

    // ── Download logo via StorageProvider ────────────────────────────────────
    let logo: Extraction['logo'];
    if (logoUrl) {
      const stored = await downloadLogo(logoUrl, businessId);
      if (stored) logo = { sourceUrl: logoUrl, ...stored };
    }

    return {
      palette: palDeduped,
      detectedFonts: {
        heading: cleanFamily(detected.heading),
        body: cleanFamily(detected.body),
      },
      renderFonts: {
        heading: mapToBundledFont(detected.heading, 'heading'),
        body: mapToBundledFont(detected.body, 'body'),
      },
      logo,
      screenshot,
      downscaledBase64,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function downloadLogo(
  logoUrl: string,
  businessId: string,
): Promise<StoredMedia | undefined> {
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return undefined;
    const ct = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const ext = EXT_BY_CT[ct] ?? logoUrl.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'png';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return undefined;
    return await getStorage().save(`brand/${businessId}/logo-${randomUUID()}.${ext}`, buf, {
      contentType: ct || 'image/png',
    });
  } catch {
    return undefined;
  }
}

function dedupeByHex(colors: PaletteColor[]): PaletteColor[] {
  const seen = new Set<string>();
  const out: PaletteColor[] = [];
  for (const c of colors) {
    const k = c.hex.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/** Take the first concrete family from a CSS font-family stack. */
function cleanFamily(stack: string): string {
  const first = stack.split(',')[0]?.replace(/["']/g, '').trim() ?? '';
  return first || 'Inter';
}
