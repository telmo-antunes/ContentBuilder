/**
 * Refresh every business's backgrounds WITHOUT the app's AI endpoint:
 *  - regenerate the procedural set (deterministic, vertical-aware), and
 *  - inject 3 hand-designed "AI background" SVGs per brand (authored here, by the
 *    Claude Code agent — tuned to each brand's palette + vertical + aesthetic).
 * Run: npx tsx src/scripts/injectAiBackgrounds.ts
 */
import { connectDb, disconnectDb } from '../db';
import { BusinessModel, BrandKitModel, MediaAssetModel } from '../models';
import { getStorage } from '../storage';
import { generateBusinessBackgrounds } from '../lib/backgrounds';

const W = 1080;
const H = 1350;
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" width="${W}" height="${H}">${inner}</svg>`;
const base = (c: string) => `<rect width="${W}" height="${H}" fill="${c}"/>`;

/** Soft radial glow (cx/cy in %, r in %). */
function glow(cx: number, cy: number, r: number, c: string, o: number, id = 'g'): string {
  return `<defs><radialGradient id="${id}" cx="${cx}%" cy="${cy}%" r="${r}%"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/><stop offset="55%" stop-color="${c}" stop-opacity="${(o * 0.18).toFixed(3)}"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#${id})"/>`;
}
/** Dot grid with a soft corner fade (technical / SaaS). */
function dotGrid(c: string, o: number, gap: number, fx: number, fy: number): string {
  let d = '';
  for (let y = gap; y < H; y += gap) for (let x = gap; x < W; x += gap) d += `<circle cx="${x}" cy="${y}" r="2.6"/>`;
  return `<defs><radialGradient id="dgf" cx="${fx}%" cy="${fy}%" r="85%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0.04"/></radialGradient><mask id="dgm"><rect width="${W}" height="${H}" fill="url(#dgf)"/></mask></defs><g fill="${c}" opacity="${o}" mask="url(#dgm)">${d}</g>`;
}
/** Diagonal motion/speed lines. */
function speed(cols: string[], n: number, o: number): string {
  let l = '';
  for (let i = 0; i < n; i++) {
    const y = 70 + ((H - 140) * i) / (n - 1);
    const len = 360 + ((i * 149) % 460);
    const x = -100 + ((i * 223) % 320);
    const c = cols[i % cols.length];
    l += `<line x1="${x}" y1="${y.toFixed(0)}" x2="${(x + len).toFixed(0)}" y2="${(y - len * 0.26).toFixed(0)}" stroke="${c}" stroke-width="${2 + (i % 3)}" stroke-linecap="round" opacity="${o}"/>`;
  }
  return l;
}
/** Concentric arcs from a corner (livery / automotive). */
function arcs(cx: number, cy: number, c: string, n: number, o: number, sw: number, r0 = 240, step = 160): string {
  let a = '';
  for (let i = 0; i < n; i++) a += `<circle cx="${cx}" cy="${cy}" r="${r0 + i * step}"/>`;
  return `<g stroke="${c}" fill="none" stroke-width="${sw}" opacity="${o}">${a}</g>`;
}
/** Concentric spotlight rings around a point. */
function rings(cx: number, cy: number, c: string, n: number, o: number): string {
  let a = '';
  for (let i = 1; i <= n; i++) a += `<circle cx="${cx}" cy="${cy}" r="${i * 135}"/>`;
  return `<g stroke="${c}" fill="none" stroke-width="2.5" opacity="${o}">${a}</g>`;
}
/** Stacked flowing waves. */
function waves(cols: string[], n: number, o: number): string {
  let w = '';
  for (let i = 0; i < n; i++) {
    const y = (H / (n + 1)) * (i + 1);
    const amp = 60 + (i % 3) * 34;
    const c = cols[i % cols.length];
    w += `<path d="M0 ${y.toFixed(0)} C${(W * 0.3).toFixed(0)} ${(y - amp).toFixed(0)} ${(W * 0.7).toFixed(0)} ${(y + amp).toFixed(0)} ${W} ${y.toFixed(0)}" stroke="${c}" fill="none" stroke-width="${4 + (i % 2) * 2}" opacity="${o}"/>`;
  }
  return w;
}
/** Soft blurred orbs. */
function orbs(items: Array<[number, number, number, string, number]>): string {
  const b = items.map(([x, y, r, c, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`).join('');
  return `<defs><filter id="ob" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="120"/></filter></defs><g filter="url(#ob)">${b}</g>`;
}

/** 3 hand-designed backgrounds per brand, keyed by business name. */
function designsFor(name: string, c: Record<string, string>): Array<{ label: string; svg: string }> {
  const bg = c.background ?? '#000000';
  const p = c.primary ?? '#888888';
  const s = c.secondary ?? '#666666';
  const a = c.accent ?? '#aaaaaa';
  switch (name) {
    case 'detailmasters CRM': // luxe gold on near-black, SaaS
      return [
        { label: 'Gold aurora', svg: svg(base(bg) + glow(82, 12, 78, a, 0.42) + glow(6, 96, 62, s, 0.24, 'g2')) },
        { label: 'Tech grid', svg: svg(base(bg) + glow(74, 18, 72, a, 0.22) + dotGrid(a, 0.3, 60, 74, 20)) },
        { label: 'Sweep', svg: svg(base(bg) + glow(22, 28, 68, a, 0.2) + arcs(-60, H + 60, a, 5, 0.26, 3, 380, 190)) },
      ];
    case 'Apex Auto Detailing': // dark navy + cyan + gold, automotive
      return [
        { label: 'Velocity', svg: svg(base(bg) + glow(85, 10, 65, p, 0.16) + speed([p, a], 9, 0.16)) },
        { label: 'Halo', svg: svg(base(bg) + glow(90, 88, 55, a, 0.14) + arcs(W + 40, 0, p, 6, 0.2, 2.5)) },
        { label: 'Sheen', svg: svg(base(bg) + orbs([[220, 300, 320, p, 0.14], [880, 1050, 380, a, 0.12], [900, 200, 240, p, 0.1]])) },
      ];
    case 'Dynatós Program': // dark + bright gold, bold coaching
      return [
        { label: 'Sunrise', svg: svg(base(bg) + glow(50, 108, 80, p, 0.24) + glow(50, 108, 45, p, 0.14, 'g2')) },
        { label: 'Spotlight', svg: svg(base(bg) + glow(60, 34, 55, p, 0.14) + rings(660, 470, p, 7, 0.13)) },
        { label: 'Momentum', svg: svg(base(bg) + waves([p, p], 5, 0.14)) },
      ];
    case 'Outclass Atelier': // black + white + vibrant green, sleek automotive
      return [
        { label: 'Streak', svg: svg(base(bg) + glow(80, 12, 60, s, 0.18) + speed([s, p, a], 9, 0.2)) },
        { label: 'Arc', svg: svg(base(bg) + glow(15, 88, 60, s, 0.18) + arcs(-40, H + 40, a, 5, 0.24, 2.5, 360, 200)) },
        { label: 'Mesh', svg: svg(base(bg) + orbs([[240, 320, 340, s, 0.2], [860, 1040, 400, a, 0.16], [900, 220, 240, s, 0.14]])) },
      ];
    default:
      return [{ label: 'Aurora', svg: svg(base(bg) + glow(80, 15, 70, a, 0.24)) }];
  }
}

(async () => {
  await connectDb();
  const storage = getStorage();
  const bizs = await BusinessModel.find().lean();
  for (const b of bizs) {
    const id = String(b._id);
    const kit = await BrandKitModel.findOne({ businessId: id, status: 'approved' }).sort({ createdAt: -1 }).lean();
    if (!kit) {
      console.log(`skip ${b.name} (no approved kit)`);
      continue;
    }
    const colors = (kit as Record<string, any>).colors as Record<string, string>;
    const prof = (b as Record<string, any>).profile ?? {};

    // 1) refresh procedural (vertical-aware, deterministic)
    await generateBusinessBackgrounds(id, colors as never, { category: prof.category, tone: prof.tone, count: 3 });

    // 2) replace AI backgrounds with the hand-designed ones
    const oldAi = await MediaAssetModel.find({ businessId: id, type: 'generated', label: 'AI background' });
    for (const o of oldAi) {
      try {
        await storage.remove(o.get('key'));
      } catch {
        /* best-effort */
      }
      await o.deleteOne();
    }
    const designs = designsFor(b.name, colors);
    for (let i = 0; i < designs.length; i++) {
      const d = designs[i]!;
      const key = `backgrounds/${id}/ai-cc-${i + 1}.svg`;
      const stored = await storage.save(key, Buffer.from(d.svg, 'utf8'), { contentType: 'image/svg+xml' });
      await MediaAssetModel.findOneAndUpdate(
        { businessId: id, key: stored.key },
        { businessId: id, type: 'generated', label: 'AI background', key: stored.key, url: stored.url, width: W, height: H },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    console.log(`refreshed ${b.name}: procedural(3) + AI(${designs.length})`);
  }
  await disconnectDb();
  console.log('done');
})();
