import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setClock,
  clearSourceCache,
  extractByline,
  extractReadable,
  extractTitle,
  readSource,
  readSources,
  sourceBlock,
  type FetchLike,
} from './sourceIngest';

/**
 * The SSRF guard resolves a hostname before any fetch is attempted, so these
 * tests would otherwise need working DNS to reach an injected fake. The dev
 * escape hatch skips the lookup entirely; the guard itself is exercised in its
 * own block below, with the flag off.
 */
beforeEach(() => {
  vi.stubEnv('ALLOW_PRIVATE_URLS', 'true');
  clearSourceCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  __setClock(() => Date.now());
  clearSourceCache();
});

const page = (body: string, head = '<title>How often to reapply | DetailMasters</title>') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

/** A fetch stand-in: no network, no SSRF lookup surprises in the assertions. */
function fakeFetch(html: string, init?: { ok?: boolean; status?: number; type?: string }): FetchLike {
  return async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? (init?.type ?? 'text/html; charset=utf-8') : null) },
    text: async () => html,
  });
}

describe('extractTitle', () => {
  it('prefers og:title and drops the site-name tail', () => {
    expect(extractTitle(page('', '<meta property="og:title" content="Reapplying a ceramic coating | DM">'))).toBe(
      'Reapplying a ceramic coating',
    );
    expect(extractTitle(page(''))).toBe('How often to reapply');
  });
});

describe('extractReadable', () => {
  it('keeps headings, paragraphs and list items in document order, marked', () => {
    const html = page(`
      <nav><a href="/">Home</a><a href="/blog">Blog</a></nav>
      <article>
        <h1>How often should you reapply?</h1>
        <p>Coatings are sold with a number attached, and that number describes a best case under ideal conditions.</p>
        <h2>Read the water</h2>
        <ul><li>Beads get flatter and wider</li><li>Water stops sheeting</li></ul>
        <blockquote>Judge the coating after the wash, not before it.</blockquote>
      </article>
      <footer><p>Copyright DetailMasters, all rights reserved worldwide forever</p></footer>`);
    const text = extractReadable(html);
    expect(text.split('\n')).toEqual([
      '# How often should you reapply?',
      'Coatings are sold with a number attached, and that number describes a best case under ideal conditions.',
      '## Read the water',
      '- Beads get flatter and wider',
      '- Water stops sheeting',
      '> Judge the coating after the wash, not before it.',
    ]);
  });

  it('drops navigation, scripts and styles entirely', () => {
    const text = extractReadable(
      page(`<script>var a = "a paragraph long enough to pass the filter, honestly";</script>
            <style>.x{content:"another long enough string of characters here"}</style>
            <p>The only real paragraph on this entire page, which is long enough.</p>`),
    );
    expect(text).toBe('The only real paragraph on this entire page, which is long enough.');
  });

  it('decodes entities and collapses whitespace', () => {
    const text = extractReadable(page('<p>Water   beads &amp; sheets &mdash; that&#39;s the whole test here.</p>'));
    expect(text).toBe("Water beads & sheets — that's the whole test here.");
  });

  it('honours the character budget', () => {
    const long = page(Array.from({ length: 50 }, (_, i) => `<p>Paragraph number ${i} padded out to clear the minimum length filter.</p>`).join(''));
    expect(extractReadable(long, 300).length).toBeLessThanOrEqual(300);
  });
});

describe('readSource', () => {
  it('returns the page title and its readable text', async () => {
    const html = page('<article><h1>Ceramic coatings</h1><p>' + 'A sentence about coatings that is long enough to keep. '.repeat(6) + '</p></article>');
    const out = await readSource('https://detailmasters.pro/en/blog/x', fakeFetch(html));
    expect(out).toMatchObject({ title: 'How often to reapply' });
    expect('text' in out && out.text).toContain('# Ceramic coatings');
  });

  it('reports a failure instead of throwing, for every unreadable case', async () => {
    await expect(readSource('https://x.com/a', fakeFetch('', { ok: false, status: 404 }))).resolves.toMatchObject({
      reason: 'the page returned 404',
    });
    await expect(readSource('https://x.com/a.pdf', fakeFetch('', { type: 'application/pdf' }))).resolves.toMatchObject({
      reason: 'not a web page (application/pdf)',
    });
    await expect(readSource('https://x.com/a', fakeFetch(page('<p>too short</p>')))).resolves.toMatchObject({
      reason: 'no readable article text on the page',
    });
    await expect(readSource('not a url', fakeFetch(''))).resolves.toMatchObject({ url: 'not a url' });
  });

});

describe('readSource — the SSRF guard', () => {
  beforeEach(() => vi.stubEnv('ALLOW_PRIVATE_URLS', ''));

  it('refuses a private host without fetching it', async () => {
    const spy = vi.fn();
    const out = await readSource('http://localhost:4000/secret', spy as unknown as FetchLike);
    expect(out).toMatchObject({ reason: expect.stringContaining('private host') });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a literal private address', async () => {
    const spy = vi.fn();
    await expect(readSource('http://169.254.169.254/latest/meta-data', spy as unknown as FetchLike)).resolves.toMatchObject({
      reason: expect.stringContaining('private address'),
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('readSources', () => {
  it('separates what was read from what was skipped, and never rejects', async () => {
    const good = page('<article><p>' + 'Readable prose that clears the minimum length. '.repeat(8) + '</p></article>');
    let call = 0;
    const impl: FetchLike = async () => {
      call += 1;
      return call === 1
        ? { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => good }
        : { ok: false, status: 500, headers: { get: () => 'text/html' }, text: async () => '' };
    };
    const out = await readSources(['https://a.com/one', 'https://b.com/two'], impl);
    expect(out.sources).toHaveLength(1);
    expect(out.failures).toHaveLength(1);
  });

  it('costs nothing when the brief cites nothing', async () => {
    const spy = vi.fn();
    await expect(readSources([], spy as unknown as FetchLike)).resolves.toEqual({ sources: [], failures: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('sourceBlock', () => {
  it('is empty with no sources, and names the material with one', () => {
    expect(sourceBlock([])).toBe('');
    const block = sourceBlock([{ url: 'https://a.com', title: 'A title', text: 'the words' }]);
    expect(block).toContain('SOURCE 1 — "A title" (https://a.com)');
    expect(block).toContain('the words');
    expect(block).toContain('do not invent claims it does not make');
  });
});

describe('extractByline', () => {
  it('prefers what the page declares', () => {
    expect(
      extractByline(
        '<meta property="article:author" content="Telmo Antunes">' +
          '<meta property="article:published_time" content="2026-08-09">',
      ),
    ).toEqual({ byline: 'Telmo Antunes', published: '2026-08-09' });
  });

  it('reads JSON-LD when there are no meta tags', () => {
    const ld = '<script type="application/ld+json">{"author":{"name":"A Writer"},"datePublished":"2026-01-02"}</script>';
    expect(extractByline(ld)).toEqual({ byline: 'A Writer', published: '2026-01-02' });
  });

  it('falls back to the visible byline every CMS prints', () => {
    const html = page('<article><p>By Telmo Antunes · Published August 9, 2026 · 2 min read</p></article>');
    expect(extractByline(html)).toMatchObject({ byline: 'Telmo Antunes' });
  });

  it('reports nothing rather than guessing', () => {
    expect(extractByline(page('<p>An article with no attribution anywhere on it at all.</p>'))).toEqual({});
  });
});

describe('sourceBlock — attribution', () => {
  it('names who may be quoted when the page says', () => {
    const block = sourceBlock([{ url: 'u', title: 't', text: 'words', byline: 'Telmo Antunes', published: '2026-08-09' }]);
    expect(block).toContain('Written by Telmo Antunes, published 2026-08-09.');
    expect(block).toContain('attribute it to Telmo Antunes and nobody else');
  });

  it('forbids a named attribution when the page names nobody', () => {
    expect(sourceBlock([{ url: 'u', title: 't', text: 'words' }])).toContain('Do NOT attribute a quote to a named person');
  });
});

describe('the source cache', () => {
  const good = page('<article><p>' + 'Readable prose that clears the minimum length. '.repeat(8) + '</p></article>');

  it('serves a second read of the same URL without touching the network', async () => {
    const impl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => good,
    })) as unknown as FetchLike;
    const first = await readSource('https://a.com/post', impl);
    const second = await readSource('https://a.com/post', impl);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('refetches once the entry is stale', async () => {
    let t = 1_000_000;
    __setClock(() => t);
    const impl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => good,
    })) as unknown as FetchLike;
    await readSource('https://a.com/post', impl);
    t += 11 * 60 * 1000;
    await readSource('https://a.com/post', impl);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('never caches a failure — a 404 may have been transient', async () => {
    let ok = false;
    const impl = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 404,
      headers: { get: () => 'text/html' },
      text: async () => good,
    })) as unknown as FetchLike;
    await expect(readSource('https://a.com/post', impl)).resolves.toHaveProperty('reason');
    ok = true;
    await expect(readSource('https://a.com/post', impl)).resolves.toHaveProperty('text');
    expect(impl).toHaveBeenCalledTimes(2);
  });
});
