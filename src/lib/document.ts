import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
const ACTIVE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta']);

/** Isolate active content; leave layout, CSS, SVG and copy alone. */
export function slideDocument(html: string, assets: Record<string, string> = {}): string {
  // Replace longest URLs first to avoid a shorter URL consuming a variant.
  for (const [url, data] of Object.entries(assets).sort(([a], [b]) => b.length - a.length)) {
    html = html.replaceAll(url, data).replaceAll(url.replaceAll('&', '&amp;'), data);
  }
  const document = parse(html);
  function clean(node: Node) {
    if ('attrs' in node) {
      node.attrs = node.attrs.filter(a => !a.name.startsWith('on') && a.name !== 'srcdoc');
    }
    if ('childNodes' in node) {
      node.childNodes = node.childNodes.filter(child => !('tagName' in child) || !ACTIVE_TAGS.has(child.tagName));
      node.childNodes.forEach(clean);
    }
    if ('content' in node) clean(node.content as Node);
  }
  clean(document);
  const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https: data:; img-src data: https:; font-src data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  // Insert before authored markup, so it cannot loosen this policy. The same
  // document is used in an empty-sandbox iframe for preview AND PNG export.
  return serialize(document).replace('<head>', `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style>`);
}
