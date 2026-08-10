/**
 * READING THE SOURCE — turning a URL in the brief into words the copywriter can
 * actually work from.
 *
 * "Make a carousel from this blog post <url>" was, until now, a prompt about a
 * URL: the copywriter received the link as literal text, had never seen the
 * page, and wrote a plausible carousel about the topic the slug implied. The
 * post's own headline, its list of five things, its one good sentence — none of
 * it reached the deck.
 *
 * So the compose path READS what the brief cites. Deliberately boring:
 *
 *   · NO MODEL. Extraction is string work over the HTML — the copywriter is the
 *     model, and it should read the article, not a summary of it.
 *   · NO CRAWL. The pages the brief names, nothing they link to.
 *   · SSRF-GUARDED. The same `assertPublicHttpUrl` gate the analyze and logo
 *     fetches use, so a brief cannot point the server at the LAN.
 *   · BEST EFFORT. A page that 404s, times out, or turns out to be a PDF is
 *     reported and skipped. Nothing here may fail a compose — the deck is still
 *     composable from the user's own words.
 *
 * The extractor is a small readability: prefer <article>/<main>, strip the
 * furniture, then keep the text of the elements that carry an article's meaning
 * (headings, paragraphs, list items, quotes) IN DOCUMENT ORDER, with list items
 * marked so an enumeration survives as an enumeration. Structure is the whole
 * point — a wall of de-tagged text loses exactly the thing that tells the
 * copywriter "these five belong on one slide".
 */
import { parseBrief, type ParsedBrief } from '@contentbuilder/shared';
import { assertPublicHttpUrl } from './urlGuard';

/** One page, read. */
export interface SourceDoc {
  url: string;
  title: string;
  /** Readable text, structure-marked, already capped. */
  text: string;
  /**
   * Who wrote it and when, when the page says so. A carousel that pulls a line
   * out of an article and attributes it needs the real name: without this the
   * copywriter attributed a quote to whoever it could infer, which is a
   * fabrication risk on somebody else's words.
   */
  byline?: string;
  published?: string;
}

/** Why a cited URL produced nothing. Surfaced to the user, never thrown. */
export interface SourceFailure {
  url: string;
  reason: string;
}

export interface IngestResult {
  sources: SourceDoc[];
  failures: SourceFailure[];
}

/** How much of one page reaches the copywriter. ~2.5k tokens: a long blog post. */
export const SOURCE_CHAR_BUDGET = 9000;
/** Refuse to buffer more than this off the wire, whatever the page claims. */
const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;
/** Two sources is a comparison; four is a research project. */
const MAX_SOURCES = 3;

/**
 * A browser-ish UA. Not evasion — a bare `node` UA is rejected outright by a
 * good share of CDNs, and a blog post the user explicitly asked us to read is
 * not a page we are sneaking into.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 ContentBuilder/1.0';

/** Injected in tests so nothing here needs the network. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

// ── Extraction ──────────────────────────────────────────────────────────────

/** Everything that is chrome, navigation, or code — never article prose. */
const STRIP_ELEMENTS = [
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'label',
];

function stripElements(html: string): string {
  let out = html;
  for (const tag of STRIP_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
    // An unclosed <script src> style tag would otherwise leave its open tag behind.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }
  return out.replace(/<!--[\s\S]*?-->/g, ' ');
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    const hit = ENTITIES[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

/** Tag-free, entity-decoded, whitespace-normalised text of a fragment. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * The article's own container, when the page marks one. Falls back to the whole
 * document — a site that ships no semantic wrapper still has readable prose, it
 * just arrives with more noise, which the block filter below handles.
 */
function articleScope(html: string): string {
  for (const re of [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*\b(?:post-content|entry-content|article-body|prose)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]) {
    const m = html.match(re);
    if (m && textOf(m[1] ?? '').length > 400) return m[1]!;
  }
  return html;
}

/**
 * WHO WROTE IT AND WHEN, when the page is willing to say.
 *
 * Read from the machine-readable declarations first (JSON-LD, `article:*` and
 * `<meta name="author">`), then from the visible byline pattern every CMS
 * produces — "By Telmo Antunes · Published August 9, 2026 · 2 min read". A page
 * that declares nothing simply has no byline, and the copywriter is told
 * nothing rather than something invented.
 */
export function extractByline(html: string): { byline?: string; published?: string } {
  const meta = (re: RegExp): string | undefined => {
    const m = html.match(re);
    return m?.[1] ? textOf(m[1]).slice(0, 120) : undefined;
  };
  let byline =
    meta(/<meta\b[^>]*(?:name|property)\s*=\s*["'](?:author|article:author)["'][^>]*content\s*=\s*["']([^"']+)["']/i) ??
    meta(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*(?:name|property)\s*=\s*["'](?:author|article:author)["']/i) ??
    meta(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i) ??
    meta(/"author"\s*:\s*"([^"]+)"/i);
  let published =
    meta(/<meta\b[^>]*(?:name|property)\s*=\s*["'](?:article:published_time|datePublished|date)["'][^>]*content\s*=\s*["']([^"']+)["']/i) ??
    meta(/"datePublished"\s*:\s*"([^"]+)"/i) ??
    meta(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/i);

  // The visible line, when nothing was declared: "By <name> · Published <date>".
  if (!byline || !published) {
    const visible = textOf(html).match(
      /\bBy\s+([A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){0,3})(?:\s*[·|,–—-]\s*Published\s+([^·|]{4,30}))?/u,
    );
    byline ??= visible?.[1]?.trim();
    published ??= visible?.[2]?.trim();
  }
  return {
    ...(byline ? { byline: byline.replace(/^by\s+/i, '').trim().slice(0, 120) } : {}),
    ...(published ? { published: published.trim().slice(0, 40) } : {}),
  };
}

/** The `<title>`, minus the site-name tail most CMSs append. */
export function extractTitle(html: string): string {
  const og = html.match(/<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i);
  const raw = og?.[1] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const title = textOf(raw);
  // "Post title | Brand" / "Post title – Brand": keep the longer half.
  const parts = title.split(/\s+[|–—·]\s+/);
  if (parts.length > 1) {
    const best = parts.reduce((a, b) => (b.length > a.length ? b : a));
    if (best.length >= 12) return best.slice(0, 160);
  }
  return title.slice(0, 160);
}

/** Blocks worth keeping, and how each one is marked for the copywriter. */
const BLOCK_RE = /<(h1|h2|h3|h4|li|p|blockquote|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** Below this a <p> is a caption, a byline or a cookie notice, not prose. */
const MIN_PARAGRAPH = 40;
/** A "list item" this long is a nav menu entry or a whole nested section. */
const MAX_ITEM = 400;

/**
 * The readable text of a page, structure preserved.
 *
 * Headings keep their level (`## …`) and list items keep their bullet (`- …`),
 * because those two marks are exactly what tells the copywriter where a slide
 * boundary is and which slide is secretly a list. Everything else arrives as
 * plain paragraphs, in document order, deduplicated (a page's h1 is routinely
 * repeated in a hero and a breadcrumb).
 */
export function extractReadable(html: string, budget = SOURCE_CHAR_BUDGET): string {
  const scoped = stripElements(articleScope(stripElements(html)));
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const m of scoped.matchAll(BLOCK_RE)) {
    const tag = (m[1] ?? '').toLowerCase();
    const text = textOf(m[2] ?? '');
    if (!text) continue;
    const isItem = tag === 'li' || tag === 'dt' || tag === 'dd';
    const isHeading = tag[0] === 'h';
    if (!isItem && !isHeading && text.length < MIN_PARAGRAPH) continue;
    if (isItem && (text.length < 3 || text.length > MAX_ITEM)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const line = isHeading
      ? `${'#'.repeat(Math.min(3, Number(tag[1]) || 2))} ${text}`
      : isItem
        ? `- ${text}`
        : tag === 'blockquote'
          ? `> ${text}`
          : text;
    if (used + line.length + 1 > budget) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

// ── Fetching ────────────────────────────────────────────────────────────────

// ── A tiny read-through cache ───────────────────────────────────────────────

/**
 * WHY CACHE AT ALL. Re-composing a post is the single most common thing a user
 * does — a deck they did not like, a plan they just wrote, a slide count they
 * want to see again — and every one of those refetched the same article and
 * re-extracted it from scratch. The page has not changed in the ninety seconds
 * since the last attempt, so the second compose should start writing straight
 * away rather than waiting on somebody else's server.
 *
 * Deliberately small and dumb: successes only (a 404 must be retried, in case
 * it was transient or the page has since been published), in memory (nothing to
 * invalidate across a restart), and evicted oldest-first past a hard cap.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 32;
const cache = new Map<string, { at: number; doc: SourceDoc }>();

/** Injected by tests so a TTL can be exercised without waiting for one. */
let now = () => Date.now();
export function __setClock(fn: () => number): void {
  now = fn;
}

/** Forget everything read so far. Tests, and the only honest response to "refetch". */
export function clearSourceCache(): void {
  cache.clear();
}

function cached(url: string): SourceDoc | undefined {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (now() - hit.at > CACHE_TTL_MS) {
    cache.delete(url);
    return undefined;
  }
  // Refresh insertion order so the cap evicts the least recently USED.
  cache.delete(url);
  cache.set(url, hit);
  return hit.doc;
}

function remember(url: string, doc: SourceDoc): void {
  cache.set(url, { at: now(), doc });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Read ONE page. Resolves to a failure rather than throwing. */
export async function readSource(
  url: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<SourceDoc | SourceFailure> {
  let safe: URL;
  try {
    safe = await assertPublicHttpUrl(url, 'Source URL');
  } catch (err) {
    return { url, reason: err instanceof Error ? err.message : 'blocked' };
  }
  const key = safe.toString();
  const hit = cached(key);
  if (hit) {
    console.warn(`[source] ${hit.url}: served from cache (${hit.text.length} chars)`);
    return hit;
  }
  try {
    const res = await fetchImpl(key, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return { url, reason: `the page returned ${res.status}` };
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type && !type.includes('html') && !type.includes('text/plain')) {
      return { url, reason: `not a web page (${type.split(';')[0]})` };
    }
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) return { url, reason: 'the page is too large to read' };
    const html = (await res.text()).slice(0, MAX_BYTES);
    const text = extractReadable(html);
    if (text.length < 200) return { url, reason: 'no readable article text on the page' };
    const doc: SourceDoc = { url: key, title: extractTitle(html) || safe.hostname, text, ...extractByline(html) };
    remember(key, doc);
    return doc;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, reason: /abort|timeout/i.test(message) ? 'the page took too long to respond' : message };
  }
}

const isFailure = (v: SourceDoc | SourceFailure): v is SourceFailure => 'reason' in v;

/**
 * Read every URL the brief cites, concurrently. Always resolves; a brief that
 * cites nothing costs nothing.
 */
export async function readSources(
  urls: readonly string[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<IngestResult> {
  const wanted = urls.slice(0, MAX_SOURCES);
  if (!wanted.length) return { sources: [], failures: [] };
  const settled = await Promise.all(wanted.map((u) => readSource(u, fetchImpl)));
  const sources: SourceDoc[] = [];
  const failures: SourceFailure[] = [];
  for (const r of settled) (isFailure(r) ? failures : sources).push(r as never);
  for (const f of failures) console.warn(`[source] ${f.url}: ${f.reason}`);
  for (const s of sources) console.warn(`[source] ${s.url}: read ${s.text.length} chars — "${s.title}"`);
  return { sources, failures };
}

/**
 * THE ONE CALL A COMPOSE MAKES: brief in, everything the copywriter needs out.
 *
 * Parsing the brief is pure and instant; reading its sources is the only part
 * that touches the network, and it never fails the compose — a page that would
 * not load comes back in `failures` so the user can be told which link was
 * skipped and why, rather than silently receiving a deck written from nothing.
 */
export async function resolveBrief(
  idea: string,
  plan?: readonly string[],
  fetchImpl?: FetchLike,
): Promise<{ brief: ParsedBrief } & IngestResult> {
  const brief = parseBrief(idea, plan);
  const read = await readSources(brief.urls, fetchImpl);
  return { brief, ...read };
}

/** The block the copywriter reads. Empty string when there are no sources. */
export function sourceBlock(sources: readonly SourceDoc[]): string {
  if (!sources.length) return '';
  return sources
    .map((s, i) => {
      const credit = [s.byline ? `by ${s.byline}` : '', s.published ? `published ${s.published}` : '']
        .filter(Boolean)
        .join(', ');
      return (
        `SOURCE ${i + 1} — "${s.title}" (${s.url})${credit ? `\nWritten ${credit}.` : ''}\n` +
        `This is the material the post is made from. Use ITS facts, ITS structure and ITS best lines; do not invent claims it does not make.\n` +
        (s.byline
          ? `If you pull a line out as a quote, attribute it to ${s.byline} and nobody else.\n`
          : `Do NOT attribute a quote to a named person — this page does not say who wrote it.\n`) +
        `"""\n${s.text}\n"""`
      );
    })
    .join('\n\n');
}
