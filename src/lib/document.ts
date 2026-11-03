import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
const ACTIVE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta']);

/** Isolate active content; leave layout, CSS, SVG and copy alone. */
export function slideDocument(html: string, assets: Record<string, string> = {}): string {
  // One pass, longest URL first, so a replacement is never matched again (an /api/assets path inside an absolute URL).
  const replacements = new Map(Object.entries(assets).flatMap(([url, data]) => [[url.replaceAll('&', '&amp;'), data], [url, data]] as const));
  if (replacements.size) {
    const pattern = new RegExp([...replacements.keys()].sort((a, b) => b.length - a.length).map(url => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    html = html.replace(pattern, url => replacements.get(url)!);
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
  // Assets arrive inlined: an empty-sandbox frame has an opaque origin, and the browser will not let it load from this local app.
  const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https: data:; img-src data: https:; font-src data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  // Insert before authored markup, so it cannot loosen this policy. The same
  // document is used in an empty-sandbox iframe for preview AND PNG export.
  return serialize(document).replace('<head>', `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style>`);
}
