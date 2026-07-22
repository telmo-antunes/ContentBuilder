import type { BlockFrame, BlockType, BrandLayout } from '@contentbuilder/shared';

/**
 * Deterministic reading-order guard. Free AI composition (and draft-time leftover
 * placement) occasionally strands a header BELOW the body it introduces — e.g. a
 * "list" title under its list. This detects that within a vertical column and
 * re-stacks the column top-to-bottom in canonical reading order — but ONLY when
 * there is an actual violation, so deliberate asymmetric layouts are untouched.
 * Works on brand layouts AND drafted slides. Pure + unit-testable.
 */

const READING_PRIORITY: Record<BlockType, number> = {
  eyebrow: 0,
  date: 1,
  title: 2,
  quote: 2,
  subtitle: 3,
  price: 3,
  paragraph: 4,
  list: 4,
  caption: 5,
  attribution: 5,
  cta: 6,
  handle: 7,
  footer: 8,
};

const prio = (t: BlockType): number => READING_PRIORITY[t] ?? 4;

/** Two frames share a column when they overlap on the majority of the narrower one. */
function sameColumn(a: { x: number; w: number }, b: { x: number; w: number }): boolean {
  const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return overlap > 0.5 * Math.min(a.w, b.w);
}

/**
 * Reorder framed blocks into canonical reading order within each column. Returns
 * the SAME array reference when nothing needs moving (so callers can skip work).
 * Blocks without a frame are left in place.
 */
export function reorderByReading<B extends { type: BlockType; frame?: BlockFrame }>(blocks: B[]): B[] {
  const framed = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.frame);
  if (framed.length < 2) return blocks;

  // Greedy-group into columns by horizontal overlap (indices into `framed`).
  const cols: number[][] = [];
  framed.forEach((x, k) => {
    const col = cols.find((c) => c.some((j) => sameColumn(framed[j]!.b.frame!, x.b.frame!)));
    if (col) col.push(k);
    else cols.push([k]);
  });

  const out = blocks.map((b) => ({ ...b, frame: b.frame ? { ...b.frame } : b.frame }));
  let changed = false;

  for (const col of cols) {
    if (col.length < 2) continue;
    const ordered = [...col].sort((a, c) => {
      const d = prio(framed[a]!.b.type) - prio(framed[c]!.b.type);
      return d !== 0 ? d : framed[a]!.b.frame!.y - framed[c]!.b.frame!.y;
    });
    const violated = ordered.some((k, p) => p > 0 && framed[k]!.b.frame!.y < framed[ordered[p - 1]!]!.b.frame!.y);
    if (!violated) continue;

    const tops = col.map((k) => framed[k]!.b.frame!.y);
    const top = Math.min(...tops);
    const totalH = col.reduce((s, k) => s + framed[k]!.b.frame!.h, 0);
    const span = Math.max(...col.map((k) => framed[k]!.b.frame!.y + framed[k]!.b.frame!.h)) - top;
    const gap = ordered.length > 1 ? Math.max(0.015, (span - totalH) / (ordered.length - 1)) : 0;
    let y = top;
    for (const k of ordered) {
      out[framed[k]!.i]!.frame!.y = +y.toFixed(4);
      y += framed[k]!.b.frame!.h + gap;
    }
    changed = true;
  }

  return changed ? out : blocks;
}

/** Reading-order guard for a whole brand layout. */
export function enforceReadingOrder<T extends BrandLayout>(layout: T): T {
  const blocks = reorderByReading(layout.blocks);
  return blocks === layout.blocks ? layout : { ...layout, blocks };
}
