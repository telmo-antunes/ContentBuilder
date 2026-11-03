export type DiffKind = 'same' | 'removed' | 'added';
export interface DiffPart { kind: DiffKind; text: string; start: number }
type Token = { text: string; start: number };
const tokens = (text: string): Token[] => [...text.matchAll(/\s+|[\p{L}\p{N}_]+(?:['’\-][\p{L}\p{N}_]+)*|[^\s]/gu)].map(match => ({ text: match[0], start: match.index! }));
export function wordingDiff(before: string, after: string): { parts: DiffPart[]; grouped: boolean } {
  const a = tokens(before), b = tokens(after); const parts: DiffPart[] = [];
  const push = (kind: DiffKind, token: Token) => { const last = parts.at(-1); if (last?.kind === kind && last.start + last.text.length === token.start) last.text += token.text; else parts.push({ kind, ...token }); };
  let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix].text === b[prefix].text) { push('same', b[prefix]); prefix++; }
  let ae = a.length, be = b.length;
  while (ae > prefix && be > prefix && a[ae - 1].text === b[be - 1].text) { ae--; be--; }
  const n = ae - prefix, m = be - prefix;
  const grouped = n * m > 500_000;
  if (grouped) { a.slice(prefix, ae).forEach(token => push('removed', token)); b.slice(prefix, be).forEach(token => push('added', token)); }
  else {
    const stride = m + 1, table = new Uint32Array((n + 1) * stride);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i * stride + j] = a[prefix + i].text === b[prefix + j].text ? table[(i + 1) * stride + j + 1] + 1 : Math.max(table[(i + 1) * stride + j], table[i * stride + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i].text === b[prefix + j].text) { push('same', b[prefix + j]); i++; j++; }
      else if (i < n && (j === m || table[(i + 1) * stride + j] >= table[i * stride + j + 1])) push('removed', a[prefix + i++]);
      else push('added', b[prefix + j++]);
    }
  }
  b.slice(be).forEach(token => push('same', token));
  return { parts, grouped };
}
export function sensitiveRanges(text: string) {
  const patterns = [/[“"]([^”"\n]+)[”"]|‘([^’\n]+)’/g, /\p{N}+(?:[.,]\p{N}+)*%?/gu,
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|um|dois|três|quatro|cinco|seis|sete|oito|nove|dez)\s+slides?\b|\bslide count\s*[:=]?\s*\d+/gi];
  return patterns.flatMap((pattern, kind) => [...text.matchAll(pattern)].map(match => ({ start: match.index!, end: match.index! + match[0].length, kind })));
}
export function changedSensitiveKinds(before: string, after: string) {
  const extract = (text: string, kind: number) => sensitiveRanges(text).filter(range => range.kind === kind).map(range => text.slice(range.start, range.end).replace(/[“”"]/g, '').trim()).sort();
  return [0, 1, 2].filter(kind => JSON.stringify(extract(before, kind)) !== JSON.stringify(extract(after, kind)));
}
export function highlightedPart(part: DiffPart, source: string) {
  if (part.kind === 'same') return [{ text: part.text, important: false }];
  const ranges = sensitiveRanges(source).filter(range => range.start < part.start + part.text.length && range.end > part.start);
  const cuts = [...new Set([0, part.text.length, ...ranges.flatMap(range => [Math.max(0, range.start - part.start), Math.min(part.text.length, range.end - part.start)])])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => ({ text: part.text.slice(start, cuts[i + 1]), important: ranges.some(range => range.start < part.start + cuts[i + 1] && range.end > part.start + start) }));
}
