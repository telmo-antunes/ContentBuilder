/**
 * Procedural brand backgrounds: turn a brand palette + the business's *vertical*
 * into subtle, depth-giving SVG backgrounds (no photos) to drop behind posts.
 *
 * Two goals beyond "recolor a template":
 *  - **Unique per business** — a seed derived from the businessId drives a small
 *    PRNG so placement/scale/rotation/counts vary; same business → same output
 *    (stable, so already-placed backgrounds keep rendering identically).
 *  - **Relevant to the vertical** — each business category maps to its own family
 *    of motifs (a local service looks different from a SaaS), and `tone` nudges
 *    density/contrast within a family.
 *
 * Pure + dependency-free so both the API (to store) and the web app (to preview)
 * can use it. Authored at 1080×1350, `cover`-cropped across square/portrait/story.
 */
import type { BusinessCategory } from './profile';

export interface BgColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text?: string;
  palette?: string[];
}

export interface BgOptions {
  /** Business vertical — selects the motif family. */
  category?: BusinessCategory;
  /** Tone descriptors (BUSINESS_TONES) — modulate density/contrast. */
  tone?: string[];
  /** Stable per-business seed (e.g. the businessId). Same seed → same output. */
  seed?: string | number;
  /** How many backgrounds to produce (business-chosen). Default 3. */
  count?: number;
}

export interface BrandBackground {
  id: string;
  label: string;
  svg: string;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

const clamp = (n: number) => Math.max(0, Math.min(255, n));

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = (hex || '#000000').replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return { r: parseInt(f.slice(0, 2), 16) || 0, g: parseInt(f.slice(2, 4), 16) || 0, b: parseInt(f.slice(4, 6), 16) || 0 };
}
function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
/** Linear blend a→b by t in [0,1]. */
function mix(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}
/** Perceived lightness 0..1. */
function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function hashSeed(seed: string | number | undefined): number {
  if (typeof seed === 'number') return seed >>> 0;
  const s = String(seed ?? 'default');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SVG_W = 1080;
const SVG_H = 1350;

function svgWrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMid slice" width="${SVG_W}" height="${SVG_H}">${inner}</svg>`;
}

// ── Drawing context (palette + dark-awareness + rng + tone knobs) ─────────────

interface Ctx {
  c: BgColors;
  bg: string;
  dark: boolean;
  pal: string[];
  rnd: () => number;
  /** Multiplies element counts (Bold/Playful denser, Minimal sparser). */
  density: number;
  /** Multiplies opacity (Bold stronger, Minimal/Premium softer). */
  alpha: number;
  /** Multiplies stroke widths. */
  stroke: number;
}

function rint(rnd: () => number, min: number, max: number): number {
  return Math.round(min + (max - min) * rnd());
}
function rfloat(rnd: () => number, min: number, max: number): number {
  return min + (max - min) * rnd();
}

function toneKnobs(tone: string[] | undefined): { density: number; alpha: number; stroke: number } {
  const t = new Set((tone ?? []).map((s) => s.toLowerCase()));
  let density = 1;
  let alpha = 1;
  let stroke = 1;
  if (t.has('bold')) { density *= 1.25; alpha *= 1.25; stroke *= 1.3; }
  if (t.has('playful')) { density *= 1.35; alpha *= 1.1; }
  if (t.has('minimal')) { density *= 0.6; alpha *= 0.8; stroke *= 0.85; }
  if (t.has('premium')) { alpha *= 0.85; stroke *= 0.85; }
  return { density, alpha, stroke };
}

/** Opacity helper: dark themes carry a touch more so motifs read; clamp for safety. */
function op(ctx: Ctx, base: number): string {
  const v = (ctx.dark ? base : base * 0.72) * ctx.alpha;
  return Math.max(0, Math.min(0.5, v)).toFixed(3);
}

// ── Motifs (each returns inner SVG; all rng-varied, all text-safe/subtle) ─────

/** A gentle two-stop gradient base — every motif paints over this. */
function base(ctx: Ctx, tint = 0.06): string {
  const a = mix(ctx.bg, ctx.c.primary, ctx.dark ? tint + 0.06 : tint * 0.5);
  const b = mix(ctx.bg, ctx.c.secondary, ctx.dark ? tint : tint * 0.4);
  const ang = rint(ctx.rnd, 0, 1);
  return `<defs><linearGradient id="bg-g" x1="0" y1="0" x2="${ang}" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${SVG_W}" height="${SVG_H}" fill="url(#bg-g)"/>`;
}

function blur(id: string, dev: number): string {
  return `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${dev}"/></filter>`;
}

function mesh(ctx: Ctx): string {
  const n = Math.max(2, Math.round(3 * ctx.density));
  let fields = '';
  for (let i = 0; i < n; i++) {
    const col = ctx.pal[i % ctx.pal.length] ?? ctx.c.primary;
    fields += `<circle cx="${rint(ctx.rnd, 60, SVG_W - 60)}" cy="${rint(ctx.rnd, 80, SVG_H - 80)}" r="${rint(ctx.rnd, 260, 460)}" fill="${col}" opacity="${op(ctx, 0.2)}"/>`;
  }
  return `${base(ctx, 0.1)}<defs>${blur('mesh-b', 150)}</defs><g filter="url(#mesh-b)">${fields}</g>`;
}

function orbs(ctx: Ctx): string {
  const n = Math.max(3, Math.round(4 * ctx.density));
  let o = '';
  for (let i = 0; i < n; i++) {
    const col = ctx.pal[i % ctx.pal.length] ?? ctx.c.accent;
    o += `<circle cx="${rint(ctx.rnd, 80, SVG_W - 80)}" cy="${rint(ctx.rnd, 120, SVG_H - 120)}" r="${rint(ctx.rnd, 200, 430)}" fill="${col}" opacity="${op(ctx, 0.18)}"/>`;
  }
  return `${base(ctx, 0.05)}<defs>${blur('orbs-b', 130)}</defs><g filter="url(#orbs-b)">${o}</g>`;
}

/** Concentric corner arcs + diagonals — automotive/clean, good for services. */
function livery(ctx: Ctx): string {
  const corner = ctx.rnd() < 0.5 ? SVG_W : 0;
  const cy = ctx.rnd() < 0.5 ? 0 : SVG_H;
  const n = Math.max(4, Math.round(6 * ctx.density));
  let rings = '';
  for (let i = 0; i < n; i++) rings += `<circle cx="${corner}" cy="${cy}" r="${300 + i * 170}" stroke-width="${(2.5 * ctx.stroke).toFixed(2)}"/>`;
  let lines = '';
  const ln = Math.max(3, Math.round(4 * ctx.density));
  for (let i = 0; i < ln; i++) {
    const y = 760 + i * rint(ctx.rnd, 130, 180);
    lines += `<line x1="-100" y1="${y}" x2="700" y2="${y - 520}" stroke-width="${(2.5 * ctx.stroke).toFixed(2)}"/>`;
  }
  return `${base(ctx, 0.04)}<g stroke="${ctx.c.accent}" fill="none" opacity="${op(ctx, 0.2)}">${rings}</g><g stroke="${ctx.c.primary}" fill="none" opacity="${op(ctx, 0.13)}">${lines}</g>`;
}

/** Diagonal motion/speed lines of varying length — momentum, clean services. */
function speedlines(ctx: Ctx): string {
  const n = Math.max(6, Math.round(11 * ctx.density));
  let lines = '';
  for (let i = 0; i < n; i++) {
    const y = rint(ctx.rnd, 40, SVG_H - 40);
    const len = rfloat(ctx.rnd, 0.3, 0.95) * SVG_W;
    const x = rint(ctx.rnd, -100, SVG_W - 200);
    const col = ctx.rnd() < 0.4 ? ctx.c.accent : ctx.c.primary;
    lines += `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y - len * 0.28}" stroke="${col}" stroke-width="${(rfloat(ctx.rnd, 2, 5) * ctx.stroke).toFixed(2)}" stroke-linecap="round" opacity="${op(ctx, 0.16)}"/>`;
  }
  return `${base(ctx, 0.05)}${lines}`;
}

/** Four-point sparkle glints + a soft diagonal sheen — "shine"/detailing. */
function shine(ctx: Ctx): string {
  const n = Math.max(4, Math.round(8 * ctx.density));
  let stars = '';
  for (let i = 0; i < n; i++) {
    const x = rint(ctx.rnd, 60, SVG_W - 60);
    const y = rint(ctx.rnd, 80, SVG_H - 80);
    const s = rfloat(ctx.rnd, 16, 46);
    const col = ctx.rnd() < 0.5 ? ctx.c.accent : ctx.c.primary;
    stars += `<path d="M${x} ${y - s} Q${x + s * 0.16} ${y - s * 0.16} ${x + s} ${y} Q${x + s * 0.16} ${y + s * 0.16} ${x} ${y + s} Q${x - s * 0.16} ${y + s * 0.16} ${x - s} ${y} Q${x - s * 0.16} ${y - s * 0.16} ${x} ${y - s} Z" fill="${col}" opacity="${op(ctx, 0.5)}"/>`;
  }
  const sheen = `<defs><linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ctx.c.primary}" stop-opacity="0"/><stop offset="0.5" stop-color="${ctx.c.primary}" stop-opacity="${op(ctx, 0.14)}"/><stop offset="1" stop-color="${ctx.c.primary}" stop-opacity="0"/></linearGradient></defs><rect width="${SVG_W}" height="${SVG_H}" fill="url(#sheen)"/>`;
  return `${base(ctx, 0.05)}${sheen}${stars}`;
}

/** Regular dot grid with a soft fade — technical/SaaS. */
function dotgrid(ctx: Ctx): string {
  const gap = Math.round(rfloat(ctx.rnd, 54, 74) / Math.max(0.7, ctx.density));
  const r = (2.4 * ctx.stroke).toFixed(2);
  let dots = '';
  for (let y = gap; y < SVG_H; y += gap) for (let x = gap; x < SVG_W; x += gap) {
    dots += `<circle cx="${x}" cy="${y}" r="${r}"/>`;
  }
  const fade = `<defs><radialGradient id="dg-f" cx="0.7" cy="0.25" r="0.9"><stop offset="0" stop-color="white" stop-opacity="1"/><stop offset="1" stop-color="white" stop-opacity="0.15"/></radialGradient><mask id="dg-m"><rect width="${SVG_W}" height="${SVG_H}" fill="url(#dg-f)"/></mask></defs>`;
  return `${base(ctx, 0.06)}${fade}<g fill="${ctx.c.primary}" opacity="${op(ctx, 0.22)}" mask="url(#dg-m)">${dots}</g>`;
}

/** Nodes + connecting edges — network/SaaS. */
function nodenet(ctx: Ctx): string {
  const n = Math.max(6, Math.round(10 * ctx.density));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) pts.push({ x: rint(ctx.rnd, 80, SVG_W - 80), y: rint(ctx.rnd, 100, SVG_H - 100) });
  let edges = '';
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1 + Math.floor(ctx.rnd() * 2)) % pts.length]!;
    edges += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${(1.5 * ctx.stroke).toFixed(2)}"/>`;
  }
  const nodes = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${rfloat(ctx.rnd, 4, 9).toFixed(1)}"/>`).join('');
  return `${base(ctx, 0.06)}<g stroke="${ctx.c.primary}" opacity="${op(ctx, 0.14)}">${edges}</g><g fill="${ctx.c.accent}" opacity="${op(ctx, 0.28)}">${nodes}</g>`;
}

/** Offset soft rounded panels — UI cards / product. */
function panels(ctx: Ctx): string {
  const n = Math.max(2, Math.round(4 * ctx.density));
  let p = '';
  for (let i = 0; i < n; i++) {
    const w = rint(ctx.rnd, 320, 620);
    const h = rint(ctx.rnd, 180, 360);
    const x = rint(ctx.rnd, -80, SVG_W - 200);
    const y = rint(ctx.rnd, -60, SVG_H - 200);
    const col = ctx.rnd() < 0.5 ? ctx.c.primary : ctx.c.secondary;
    p += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="${col}" opacity="${op(ctx, 0.1)}"/>`;
  }
  return `${base(ctx, 0.07)}${p}`;
}

/** Repeating rounded-rect "card" grid — catalog/e-commerce. */
function cardgrid(ctx: Ctx): string {
  const cols = rint(ctx.rnd, 3, 4);
  const rows = rint(ctx.rnd, 4, 5);
  const pad = 36;
  const cw = (SVG_W - pad * (cols + 1)) / cols;
  const ch = (SVG_H - pad * (rows + 1)) / rows;
  let cards = '';
  for (let r = 0; r < rows; r++) for (let cI = 0; cI < cols; cI++) {
    if (ctx.rnd() < 0.12) continue; // a few gaps for life
    const col = ctx.pal[(r + cI) % ctx.pal.length] ?? ctx.c.primary;
    cards += `<rect x="${pad + cI * (cw + pad)}" y="${pad + r * (ch + pad)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="20" fill="${col}" opacity="${op(ctx, 0.1)}"/>`;
  }
  return `${base(ctx, 0.06)}${cards}`;
}

/** Scattered rotated rounded confetti — playful/e-commerce. */
function confetti(ctx: Ctx): string {
  const n = Math.max(10, Math.round(22 * ctx.density));
  let bits = '';
  for (let i = 0; i < n; i++) {
    const x = rint(ctx.rnd, 20, SVG_W - 40);
    const y = rint(ctx.rnd, 20, SVG_H - 40);
    const w = rint(ctx.rnd, 16, 46);
    const col = ctx.pal[i % ctx.pal.length] ?? ctx.c.accent;
    bits += `<rect x="${x}" y="${y}" width="${w}" height="${Math.round(w * 0.5)}" rx="6" transform="rotate(${rint(ctx.rnd, 0, 360)} ${x} ${y})" fill="${col}" opacity="${op(ctx, 0.22)}"/>`;
  }
  return `${base(ctx, 0.05)}${bits}`;
}

/** Concentric spotlight rings around an off-centre point — personal brand. */
function rings(ctx: Ctx): string {
  const cx = rint(ctx.rnd, SVG_W * 0.35, SVG_W * 0.7);
  const cy = rint(ctx.rnd, SVG_H * 0.3, SVG_H * 0.6);
  const n = Math.max(5, Math.round(8 * ctx.density));
  let rs = '';
  for (let i = 1; i <= n; i++) rs += `<circle cx="${cx}" cy="${cy}" r="${i * rint(ctx.rnd, 90, 130)}" stroke-width="${(2 * ctx.stroke).toFixed(2)}"/>`;
  const glow = `<defs>${blur('rg-b', 120)}</defs><circle cx="${cx}" cy="${cy}" r="240" fill="${ctx.c.primary}" opacity="${op(ctx, 0.18)}" filter="url(#rg-b)"/>`;
  return `${base(ctx, 0.06)}${glow}<g stroke="${ctx.c.accent}" fill="none" opacity="${op(ctx, 0.14)}">${rs}</g>`;
}

/** Organic blurred blobs — warm/personal/nonprofit. */
function blobs(ctx: Ctx): string {
  const n = Math.max(2, Math.round(3 * ctx.density));
  let b = '';
  for (let i = 0; i < n; i++) {
    const cx = rint(ctx.rnd, 120, SVG_W - 120);
    const cy = rint(ctx.rnd, 160, SVG_H - 160);
    const rr = rint(ctx.rnd, 220, 380);
    const col = ctx.pal[i % ctx.pal.length] ?? ctx.c.primary;
    // a wobbly blob via a few cubic arcs
    b += `<path d="M${cx - rr} ${cy} C${cx - rr} ${cy - rr * 0.7} ${cx - rr * 0.5} ${cy - rr} ${cx} ${cy - rr} C${cx + rr * 0.7} ${cy - rr} ${cx + rr} ${cy - rr * 0.4} ${cx + rr} ${cy} C${cx + rr} ${cy + rr * 0.7} ${cx + rr * 0.4} ${cy + rr} ${cx} ${cy + rr} C${cx - rr * 0.7} ${cy + rr} ${cx - rr} ${cy + rr * 0.5} ${cx - rr} ${cy} Z" fill="${col}" opacity="${op(ctx, 0.16)}"/>`;
  }
  return `${base(ctx, 0.07)}<defs>${blur('bl-b', 80)}</defs><g filter="url(#bl-b)">${b}</g>`;
}

/** Stacked flowing waves — calm/nonprofit. */
function waves(ctx: Ctx): string {
  const n = Math.max(3, Math.round(5 * ctx.density));
  let w = '';
  for (let i = 0; i < n; i++) {
    const y = (SVG_H / (n + 1)) * (i + 1) + rint(ctx.rnd, -40, 40);
    const amp = rint(ctx.rnd, 40, 110);
    const col = ctx.pal[i % ctx.pal.length] ?? ctx.c.primary;
    w += `<path d="M0 ${y} C${SVG_W * 0.3} ${y - amp} ${SVG_W * 0.7} ${y + amp} ${SVG_W} ${y}" stroke="${col}" fill="none" stroke-width="${(rfloat(ctx.rnd, 3, 7) * ctx.stroke).toFixed(2)}" opacity="${op(ctx, 0.16)}"/>`;
  }
  return `${base(ctx, 0.06)}${w}`;
}

/** Bold overlapping geometric blocks/triangles — agency. */
function geoblocks(ctx: Ctx): string {
  const n = Math.max(3, Math.round(5 * ctx.density));
  let g = '';
  for (let i = 0; i < n; i++) {
    const col = ctx.pal[i % ctx.pal.length] ?? ctx.c.primary;
    const x = rint(ctx.rnd, -60, SVG_W - 200);
    const y = rint(ctx.rnd, -60, SVG_H - 200);
    const s = rint(ctx.rnd, 240, 480);
    if (ctx.rnd() < 0.5) g += `<rect x="${x}" y="${y}" width="${s}" height="${s}" transform="rotate(${rint(ctx.rnd, -20, 20)} ${x} ${y})" fill="${col}" opacity="${op(ctx, 0.12)}"/>`;
    else g += `<polygon points="${x},${y + s} ${x + s / 2},${y} ${x + s},${y + s}" fill="${col}" opacity="${op(ctx, 0.12)}"/>`;
  }
  return `${base(ctx, 0.06)}${g}`;
}

/** Halftone dot-size gradient — agency/editorial. */
function halftone(ctx: Ctx): string {
  const gap = 46;
  let dots = '';
  for (let y = gap; y < SVG_H; y += gap) for (let x = gap; x < SVG_W; x += gap) {
    const t = y / SVG_H; // grow downward
    const r = (1 + t * 9).toFixed(2);
    dots += `<circle cx="${x}" cy="${y}" r="${r}"/>`;
  }
  return `${base(ctx, 0.05)}<g fill="${ctx.c.primary}" opacity="${op(ctx, 0.16)}">${dots}</g>`;
}

// ── Motif registry + per-category families ────────────────────────────────────

const MOTIFS: Record<string, { label: string; fn: (ctx: Ctx) => string }> = {
  mesh: { label: 'Soft mesh', fn: mesh },
  orbs: { label: 'Soft orbs', fn: orbs },
  livery: { label: 'Livery', fn: livery },
  speedlines: { label: 'Motion', fn: speedlines },
  shine: { label: 'Shine', fn: shine },
  dotgrid: { label: 'Dot grid', fn: dotgrid },
  nodenet: { label: 'Network', fn: nodenet },
  panels: { label: 'Panels', fn: panels },
  cardgrid: { label: 'Card grid', fn: cardgrid },
  confetti: { label: 'Confetti', fn: confetti },
  rings: { label: 'Spotlight', fn: rings },
  blobs: { label: 'Blobs', fn: blobs },
  waves: { label: 'Waves', fn: waves },
  geoblocks: { label: 'Blocks', fn: geoblocks },
  halftone: { label: 'Halftone', fn: halftone },
};

const CATEGORY_MOTIFS: Record<BusinessCategory, string[]> = {
  'local-service': ['livery', 'speedlines', 'shine'],
  'saas-product': ['dotgrid', 'nodenet', 'panels'],
  ecommerce: ['cardgrid', 'confetti', 'orbs'],
  'personal-brand': ['rings', 'blobs', 'mesh'],
  'coach-creator': ['rings', 'waves', 'blobs'],
  agency: ['geoblocks', 'halftone', 'livery'],
  nonprofit: ['waves', 'blobs', 'mesh'],
  other: ['mesh', 'livery', 'orbs'],
};

/**
 * Build `count` brand backgrounds for a business: motifs drawn from its
 * category family, each uniquely varied by the per-business seed and tone.
 */
export function buildBrandBackgrounds(colors: BgColors, opts: BgOptions = {}): BrandBackground[] {
  const category = opts.category ?? 'other';
  const family = CATEGORY_MOTIFS[category] ?? CATEGORY_MOTIFS.other;
  const count = Math.max(1, Math.min(12, opts.count ?? 3));
  const knobs = toneKnobs(opts.tone);
  const seed = hashSeed(opts.seed);
  const dark = luminance(colors.background) < 0.5;
  const pal = colors.palette && colors.palette.length >= 3 ? colors.palette : [colors.primary, colors.secondary, colors.accent];

  const out: BrandBackground[] = [];
  for (let i = 0; i < count; i++) {
    const motifId = family[i % family.length]!;
    const motif = MOTIFS[motifId]!;
    // Each background gets its own rng stream (seed + index) so repeats of the
    // same motif (when count > family size) still look different.
    const rnd = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const ctx: Ctx = { c: colors, bg: colors.background, dark, pal, rnd, ...knobs };
    out.push({
      id: `${category}-${motifId}-${i}`,
      label: count > family.length ? `${motif.label} ${Math.floor(i / family.length) + 1}` : motif.label,
      svg: svgWrap(motif.fn(ctx)),
    });
  }
  return out;
}
