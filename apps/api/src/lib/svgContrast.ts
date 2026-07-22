/**
 * Static legibility gate for AUTHORED SVG backgrounds — a cheap, rasterizer-free
 * worst-case proxy for "can brand text sit on this background and stay readable?"
 *
 * It is deliberately conservative: the visual feedback loop (which actually
 * renders the composition and shows it to a vision model) is the ground truth.
 * This gate exists so a background that is obviously illegible never even enters
 * that loop — it's replaced by a safe procedural motif instead.
 *
 * Rules:
 *  - the full-canvas base coat (first painted <rect> fill) must clear AA (4.5:1)
 *    against the brand text color — this is the color text mostly sits on;
 *  - any other solid fill / gradient stop painted at effective opacity ≥ 0.25
 *    must clear AA-large (3:1) — bold shapes can't drop a local patch below the
 *    readable floor.
 */
import { contrastRatio, AA_TEXT, AA_LARGE } from '@contentbuilder/shared';

export interface BgLegibility {
  ok: boolean;
  /** Worst contrast ratio found among gated colors (lower = worse). */
  worst: number;
  /** Human-readable reasons a background failed (empty when ok). */
  offenders: string[];
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Effective opacity of an element from its own opacity + fill/stop-opacity attrs. */
function effectiveOpacity(tag: string, kind: 'fill' | 'stop'): number {
  const read = (name: string): number => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const raw = m ? (m[2] ?? m[3] ?? m[4]) : undefined;
    const n = raw != null ? parseFloat(raw) : 1;
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  };
  const base = read('opacity');
  const specific = kind === 'fill' ? read('fill-opacity') : read('stop-opacity');
  return base * specific;
}

function attrHex(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const v = m ? (m[2] ?? m[3] ?? m[4]) : undefined;
  return v && HEX6.test(v.trim()) ? v.trim() : null;
}

/**
 * @param svg      sanitized SVG markup (post-`sanitizeSvgBackground`)
 * @param textHex  the brand text color that will be set over this background
 * @param opts.baseOnly  check ONLY the base coat, not individual shapes. Use for
 *   "statement" backgrounds, whose bold fills are intentional and sit where text
 *   does not — the visual feedback loop is the real legibility check there.
 */
export function checkBackgroundLegibility(
  svg: string,
  textHex: string,
  opts: { baseOnly?: boolean } = {},
): BgLegibility {
  const offenders: string[] = [];
  let worst = 21;

  // 1) Base coat: the first painted <rect> fill.
  const firstRect = svg.match(/<rect\b[^>]*>/i);
  const baseHex = firstRect ? attrHex(firstRect[0], 'fill') : null;
  if (!baseHex) {
    return { ok: false, worst: 1, offenders: ['no solid base-coat rect fill found'] };
  }
  const baseC = contrastRatio(textHex, baseHex);
  worst = Math.min(worst, baseC);
  if (baseC < AA_TEXT) {
    offenders.push(`base coat ${baseHex} vs text ${textHex} is ${baseC.toFixed(2)}:1 (<${AA_TEXT})`);
  }
  if (opts.baseOnly) return { ok: offenders.length === 0, worst, offenders };

  // 2) Every other solid fill / gradient stop painted at opacity ≥ 0.25.
  const elements = svg.match(/<[a-z][^>]*>/gi) ?? [];
  let firstRectSeen = false;
  for (const tag of elements) {
    const isRect = /^<rect\b/i.test(tag);
    if (isRect && !firstRectSeen) {
      firstRectSeen = true; // the base coat itself is checked above
      continue;
    }
    const isStop = /^<stop\b/i.test(tag);
    const kind: 'fill' | 'stop' = isStop ? 'stop' : 'fill';
    const hex = attrHex(tag, isStop ? 'stop-color' : 'fill');
    if (!hex) continue;
    const op = effectiveOpacity(tag, kind);
    if (op < 0.25) continue;
    const c = contrastRatio(textHex, hex);
    worst = Math.min(worst, c);
    if (c < AA_LARGE) {
      offenders.push(`${hex} @${op.toFixed(2)} vs text ${textHex} is ${c.toFixed(2)}:1 (<${AA_LARGE})`);
    }
  }

  return { ok: offenders.length === 0, worst, offenders };
}
