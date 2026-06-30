/**
 * Procedural brand backgrounds: turn a brand palette into a few subtle,
 * depth-giving SVG backgrounds (no photos) the user can drop behind posts and
 * later replace. Pure + dependency-free so both the API (to store them) and the
 * web app (to preview them) can use it. Authored at 1080×1350 and meant to be
 * `cover`-cropped across square / portrait / story.
 */

export interface BgColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text?: string;
  palette?: string[];
}

export interface BrandBackground {
  id: string; // 'mesh' | 'livery' | 'orbs'
  label: string;
  svg: string;
}

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

const SVG_W = 1080;
const SVG_H = 1350;

function svgWrap(id: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMid slice" width="${SVG_W}" height="${SVG_H}">${inner}</svg>`;
}

/** Soft mesh: a gentle gradient base with a few large blurred colour fields. */
function meshBg(c: BgColors): string {
  const bg = c.background;
  const dark = luminance(bg) < 0.5;
  const o = (base: number) => (dark ? base : base * 0.7).toFixed(3);
  const inner = `
    <defs>
      <linearGradient id="mesh-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${mix(bg, c.primary, dark ? 0.14 : 0.07)}"/>
        <stop offset="1" stop-color="${mix(bg, c.secondary, dark ? 0.1 : 0.05)}"/>
      </linearGradient>
      <filter id="mesh-b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="150"/></filter>
    </defs>
    <rect width="${SVG_W}" height="${SVG_H}" fill="url(#mesh-g)"/>
    <g filter="url(#mesh-b)">
      <circle cx="170" cy="250" r="380" fill="${c.primary}" opacity="${o(0.22)}"/>
      <circle cx="980" cy="1150" r="440" fill="${c.accent}" opacity="${o(0.2)}"/>
      <circle cx="930" cy="160" r="260" fill="${c.secondary}" opacity="${o(0.18)}"/>
    </g>`;
  return svgWrap('mesh', inner);
}

/** Geometric livery: concentric arcs anchored top-right + a few thin diagonals. */
function liveryBg(c: BgColors): string {
  const bg = c.background;
  const dark = luminance(bg) < 0.5;
  const arc = (dark ? 0.2 : 0.16).toFixed(3);
  const line = (dark ? 0.13 : 0.1).toFixed(3);
  const rings = [300, 470, 640, 810, 980, 1150]
    .map((r) => `<circle cx="${SVG_W}" cy="0" r="${r}" stroke-width="2.5"/>`)
    .join('');
  const lines = [820, 980, 1140, 1300]
    .map((y) => `<line x1="-100" y1="${y}" x2="700" y2="${y - 520}" stroke-width="2.5"/>`)
    .join('');
  const inner = `
    <rect width="${SVG_W}" height="${SVG_H}" fill="${bg}"/>
    <g stroke="${c.accent}" fill="none" opacity="${arc}">${rings}</g>
    <g stroke="${c.primary}" fill="none" opacity="${line}">${lines}</g>`;
  return svgWrap('livery', inner);
}

/** Soft orbs: scattered large blurred orbs from the palette for quiet depth. */
function orbsBg(c: BgColors): string {
  const bg = c.background;
  const dark = luminance(bg) < 0.5;
  const pal = c.palette && c.palette.length >= 3 ? c.palette : [c.primary, c.secondary, c.accent];
  const o = (base: number) => (dark ? base : base * 0.7).toFixed(3);
  const orbs = [
    { x: 230, y: 300, r: 300, c: pal[2] ?? c.accent, op: 0.2 },
    { x: 880, y: 470, r: 360, c: c.primary, op: 0.18 },
    { x: 540, y: 1080, r: 420, c: c.secondary, op: 0.17 },
    { x: 120, y: 1140, r: 240, c: c.accent, op: 0.16 },
  ]
    .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.c}" opacity="${o(d.op)}"/>`)
    .join('');
  const inner = `
    <defs><filter id="orbs-b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="130"/></filter></defs>
    <rect width="${SVG_W}" height="${SVG_H}" fill="${mix(bg, c.primary, dark ? 0.06 : 0.03)}"/>
    <g filter="url(#orbs-b)">${orbs}</g>`;
  return svgWrap('orbs', inner);
}

/** Build the 3 brand backgrounds for a palette. */
export function buildBrandBackgrounds(colors: BgColors): BrandBackground[] {
  return [
    { id: 'mesh', label: 'Soft mesh', svg: meshBg(colors) },
    { id: 'livery', label: 'Livery', svg: liveryBg(colors) },
    { id: 'orbs', label: 'Soft orbs', svg: orbsBg(colors) },
  ];
}
