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
import { assertPublicHttpUrl } from './urlGuard';
import { getStorage } from '../storage';

export interface PaletteColor {
  hex: string;
  population: number;
  /** HSL as [h(0-360), s(0-1), l(0-1)]. */
  hsl: [number, number, number];
}

/** Brand color roles derived deterministically from the page's computed styles. */
export interface DomRoles {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface Extraction {
  palette: PaletteColor[];
  /**
   * Roles read from the DOM's *computed* styles (button/link backgrounds, body
   * text, page surfaces). Present unless the harvest found too little to be
   * meaningful, in which case callers fall back to the sampled palette.
   */
  domRoles?: DomRoles;
  /** 'computed' when roles came from the DOM; 'sampled' when from the screenshot. */
  colorProvenance: 'computed' | 'sampled';
  detectedFonts: { heading: string; body: string };
  renderFonts: { heading: string; body: string };
  logo?: { sourceUrl: string } & StoredMedia;
  screenshot: StoredMedia;
  /** Base64 PNG (≤768px long edge) for the one vision call. */
  downscaledBase64: string;
  /** Homepage copy, harvested for brand-voice inference (never rendered as-is). */
  copy: { headline: string; tagline: string; description: string; sample: string };
  /** The site's largest content photos (candidates for the media library). */
  siteImages: Array<{ src: string; width: number; height: number }>;
}

/** Raw weighted color candidates harvested from computed styles (browser-side). */
interface RawDomColors {
  /** hex → total visible area painted with this background. */
  bgArea: Record<string, number>;
  /** hex → text weight (char count × font size) rendered in this color. */
  textWeight: Record<string, number>;
  /** hex → visible area of button / CTA backgrounds in this color. */
  btnArea: Record<string, number>;
  /** hex → text weight of link/nav text in this color. */
  linkWeight: Record<string, number>;
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
      // Wait for above-the-fold images too, else a lazy/half-loaded hero yields a
      // grey capture and a monochrome palette. Cap at 4s so a stuck image can't hang.
      const imgs = Array.from(document.images).filter((i) => !i.complete);
      await Promise.race([
        Promise.all(imgs.map((i) => new Promise((res) => { i.onload = i.onerror = () => res(null); }))),
        new Promise((res) => setTimeout(res, 4000)),
      ]);
    });
    await new Promise((r) => setTimeout(r, 600));

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

    // ── Copy (for brand-voice inference) ─────────────────────────────────────
    // Harvest a little real homepage text — headline, tagline, meta description,
    // one substantive paragraph — so the voice pass can hear how the brand talks.
    // NOTE: as above, no named arrow/function consts inside this callback.
    const copy = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2, [class*="subtitle" i], [class*="tagline" i]');
      const desc = document.querySelector('meta[name="description"], meta[property="og:description"]');
      const ps = Array.from(document.querySelectorAll('p'));
      let sample = '';
      for (let i = 0; i < ps.length; i++) {
        const el = ps[i];
        if (!el) continue;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 60) { sample = t; break; }
      }
      return {
        headline: (h1?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        tagline: (h2?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        description: (desc?.getAttribute('content') || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        sample: sample.slice(0, 400),
      };
    });

    // ── Content images (for the media library) ──────────────────────────────
    // The brand's real photos beat stock: collect the biggest content images
    // (skipping chrome — logos, icons, header/nav/footer imagery) as candidates.
    // NOTE: as above, no named arrow/function consts inside this callback.
    const siteImages = await page.evaluate(() => {
      const seen = new Set<string>();
      const out: Array<{ src: string; width: number; height: number; score: number }> = [];
      const imgs = Array.from(document.images);
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        if (!img) continue;
        const src = img.currentSrc || img.src || '';
        if (!/^https?:/.test(src) || seen.has(src)) continue;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w < 500 || h < 350) continue; // thumbnails/icons
        const ratio = w / h;
        if (ratio > 3.5 || ratio < 0.3) continue; // banners/sprites
        if (/logo|icon|sprite|favicon|avatar|badge/i.test(src)) continue;
        if (img.closest('header, nav, footer')) continue;
        const r = img.getBoundingClientRect();
        seen.add(src);
        // Prominence: rendered area × intrinsic resolution.
        out.push({ src, width: w, height: h, score: Math.max(r.width * r.height, 1) * Math.sqrt(w * h) });
      }
      out.sort((a, b) => b.score - a.score);
      return out.slice(0, 6).map((x) => ({ src: x.src, width: x.width, height: x.height }));
    });

    // ── Colors (computed styles) ─────────────────────────────────────────────
    // Read the *actual* colors the site paints — element backgrounds, text,
    // button/CTA backgrounds, link/nav text — each weighted by the visible area
    // (or text amount) it covers. Far more accurate than sampling a screenshot,
    // which is polluted by hero photos, gradients and imagery.
    // NOTE: as with the callbacks above, no named arrow/function consts in here.
    const rawDom: RawDomColors = await page.evaluate(() => {
      const bgArea: Record<string, number> = {};
      const textWeight: Record<string, number> = {};
      const btnArea: Record<string, number> = {};
      const linkWeight: Record<string, number> = {};

      const vw = window.innerWidth;
      const maxY = window.innerHeight * 3; // count a few folds, not the whole page

      const els = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
      for (const el of els) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) continue;

        const r = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, maxY) - Math.max(r.top, 0));
        const area = w * h;
        if (area < 4) continue;

        const tag = el.tagName.toLowerCase();
        const cls = (el.getAttribute('class') || '').toLowerCase();
        const role = el.getAttribute('role') || '';

        // Background color (only if reasonably opaque).
        const bm = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
        if (bm && bm[1]) {
          const p = bm[1].split(',').map((s) => parseFloat(s));
          const alpha = p.length > 3 ? (p[3] ?? 1) : 1;
          if (alpha >= 0.5 && p.length >= 3) {
            const hex =
              '#' +
              [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]
                .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
                .join('')
                .toUpperCase();
            bgArea[hex] = (bgArea[hex] || 0) + area;
            const isBtn =
              tag === 'button' ||
              role === 'button' ||
              (tag === 'input' && /^(button|submit)$/.test(el.getAttribute('type') || '')) ||
              /(^|[\s_-])(btn|button|cta)([\s_-]|$)/.test(cls);
            // ignore page-sized "buttons" (e.g. full-width wrappers)
            if (isBtn && area < vw * window.innerHeight * 0.25) {
              btnArea[hex] = (btnArea[hex] || 0) + area;
            }
          }
        }

        // Text color — only elements that own a non-empty text node.
        let hasText = false;
        const kids = el.childNodes;
        for (let i = 0; i < kids.length; i++) {
          const n = kids[i];
          if (n && n.nodeType === 3 && (n.textContent || '').trim().length > 0) {
            hasText = true;
            break;
          }
        }
        if (hasText) {
          const tm = cs.color.match(/rgba?\(([^)]+)\)/);
          if (tm && tm[1]) {
            const p = tm[1].split(',').map((s) => parseFloat(s));
            const alpha = p.length > 3 ? (p[3] ?? 1) : 1;
            if (alpha >= 0.5 && p.length >= 3) {
              const hex =
                '#' +
                [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]
                  .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
                  .join('')
                  .toUpperCase();
              const len = Math.min((el.textContent || '').trim().length, 200); // cap runaway containers
              const fs = parseFloat(cs.fontSize) || 16;
              const weight = len * fs;
              textWeight[hex] = (textWeight[hex] || 0) + weight;
              if (tag === 'a' || el.closest('nav, header')) linkWeight[hex] = (linkWeight[hex] || 0) + weight;
            }
          }
        }
      }
      return { bgArea, textWeight, btnArea, linkWeight };
    });

    // ── Screenshot (viewport) ────────────────────────────────────────────────
    const shot = Buffer.from(await page.screenshot({ type: 'png' }));
    const screenshot = await storage.save(`brand/${businessId}/home-${randomUUID()}.png`, shot, {
      contentType: 'image/png',
    });

    // ── Palette & roles (computed first, sampled only as a fallback) ─────────
    const dom = rolesFromRawDom(rawDom);

    // node-vibrant on the screenshot — kept ONLY as a fallback for sites where
    // the DOM harvest is too thin (canvas-rendered, heavily image-based, etc.).
    const swatches = await Vibrant.from(shot).getPalette();
    const sampled: PaletteColor[] = dedupeByHex(
      Object.values(swatches)
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({ hex: s.hex.toUpperCase(), population: s.population, hsl: s.hsl as [number, number, number] })),
    ).sort((a, b) => b.population - a.population);

    const useDom = dom.roles !== null && dom.palette.length >= 3;
    const palette = useDom ? dom.palette : sampled;
    const colorProvenance: 'computed' | 'sampled' = useDom ? 'computed' : 'sampled';

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
      palette,
      domRoles: useDom ? dom.roles! : undefined,
      colorProvenance,
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
      copy,
      siteImages,
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
    // The logo URL comes from the analyzed page's DOM — same SSRF rules apply.
    await assertPublicHttpUrl(logoUrl, 'Logo URL');
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

// ── Computed-color → roles (Node side) ────────────────────────────────────────

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((n) => n / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s, l];
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function topKey(map: Record<string, number>): string | undefined {
  let best: string | undefined;
  let max = -Infinity;
  for (const k in map) if (map[k]! > max) { max = map[k]!; best = k; }
  return best;
}

function sortKeysByWeight(map: Record<string, number>): string[] {
  return Object.keys(map).sort((a, b) => (map[b] ?? 0) - (map[a] ?? 0));
}

function mostSaturated(keys: string[]): string | undefined {
  let best: string | undefined;
  let max = -Infinity;
  for (const k of keys) {
    const sat = hslOf(k)[1];
    if (sat > max) { max = sat; best = k; }
  }
  return best;
}

/**
 * Turn the weighted, role-tagged color candidates harvested from the DOM into
 * brand roles + an ordered palette — all deterministic, no AI.
 *
 * background = largest painted surface · text = most-used text color ·
 * primary = dominant CTA/button (else dominant link) · accent = a brand color
 * with a distinct hue from primary · secondary = a supporting surface color.
 * Returns roles: null when the page yielded too little to be trustworthy.
 */
function rolesFromRawDom(raw: RawDomColors): { roles: DomRoles | null; palette: PaletteColor[] } {
  const combined: Record<string, number> = {};
  for (const m of [raw.bgArea, raw.btnArea, raw.linkWeight, raw.textWeight]) {
    for (const k in m) combined[k] = (combined[k] || 0) + m[k]!;
  }
  const palette: PaletteColor[] = sortKeysByWeight(combined)
    .slice(0, 8)
    .map((hex) => ({ hex, population: Math.round(combined[hex]!), hsl: hslOf(hex) }));

  const background = topKey(raw.bgArea);
  // text: the most-used text color that actually reads on the chosen background
  // (the dominant text color may come from a different-colored section, e.g. a
  // dark hero, and would be unreadable on a light body surface).
  let text: string | undefined;
  if (background) {
    const texts = sortKeysByWeight(raw.textWeight);
    text =
      texts.find((h) => contrast(background, h) >= 4.5) ??
      texts.find((h) => contrast(background, h) >= 3) ??
      texts.slice().sort((a, b) => contrast(background, b) - contrast(background, a))[0];
  } else {
    text = topKey(raw.textWeight);
  }

  let primary = topKey(raw.btnArea) ?? topKey(raw.linkWeight);
  if (!primary && background && text) {
    primary = mostSaturated(Object.keys(combined).filter((h) => h !== background && h !== text));
  }

  if (!background || !text || !primary) return { roles: null, palette };

  // accent: prefer a CTA/link color whose hue clearly differs from primary.
  const brandCandidates: string[] = [];
  for (const h of [...sortKeysByWeight(raw.btnArea), ...sortKeysByWeight(raw.linkWeight)]) {
    if (h !== background && h !== text && !brandCandidates.includes(h)) brandCandidates.push(h);
  }
  // accent: a *saturated* brand color with a hue distinct from primary; never a
  // near-grayscale (white/black) pick, which would be invisible on slides.
  // Falls back to primary for monochrome brands.
  const primaryHue = hslOf(primary)[0];
  const sat = (h: string): number => hslOf(h)[1];
  const accent =
    brandCandidates.find((h) => h !== primary && sat(h) > 0.12 && hueDist(hslOf(h)[0], primaryHue) > 25) ??
    brandCandidates.find((h) => h !== primary && sat(h) > 0.12) ??
    mostSaturated(Object.keys(combined).filter((h) => ![background, text, primary].includes(h) && sat(h) > 0.12)) ??
    primary;

  // secondary: a supporting surface (e.g. nav/section/card bg) distinct from the rest.
  const secondary =
    sortKeysByWeight(raw.bgArea).find((h) => ![background, primary, accent, text].includes(h)) ??
    sortKeysByWeight(combined).find((h) => ![background, primary, accent, text].includes(h)) ??
    primary;

  // Make sure every role color is represented in the palette.
  const merged = [...new Set([background, text, primary, secondary, accent, ...palette.map((p) => p.hex)])].slice(0, 8);
  const finalPalette: PaletteColor[] = merged.map((hex) => ({
    hex,
    population: Math.round(combined[hex] ?? 0),
    hsl: hslOf(hex),
  }));

  return { roles: { primary, secondary, accent, background, text }, palette: finalPalette };
}
