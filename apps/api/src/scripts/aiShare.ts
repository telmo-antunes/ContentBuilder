/**
 * WHO MAKES THE SLIDE — the AI/code split, counted rather than guessed.
 *
 * The target is a deliberate one (60% model, 40% code), so it needs a number
 * that can be re-measured after a change rather than re-argued. Four axes,
 * each counted over every slide that ever shipped:
 *
 *   WORDS      every visible character, split by who chose it
 *   STRUCTURE  per slide: filled from a code-substituted fragment, or composed
 *              by the model for that slide alone
 *   STYLE      declarations in the stylesheet the browser actually gets
 *   ARBITRATION  the layout decisions taken between parse and paint
 *
 * The honest subtlety this prints rather than hides: a FRAGMENT is authored by
 * the model once per brand and executed by code on every slide after that. It
 * is code at compose time and design at author time, and which one you count
 * moves the answer by a lot — so both are reported.
 *
 *   npm run ai:share --workspace=apps/api
 */
import { connectDb, disconnectDb } from '../db';
import {
  recipeStylesheetFor,
  composeRecipeLayers,
  findBrandMark,
  fragmentVariantsFor,
  type BrandRecipe,
} from '@contentbuilder/shared';

/** Declarations, not lines: `a{b:c;d:e}` is two decisions, not one. */
function countDeclarations(css: string): number {
  return (css.match(/[^;{}]+:[^;{}]+[;}]/g) ?? []).length;
}

/** Tag+class skeleton with every word removed — structure with the copy gone. */
function skeleton(html: string): string[] {
  const out: string[] = [];
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const cls = /class="([^"]*)"/i.exec(m[2] ?? '')?.[1] ?? '';
    out.push(`${(m[1] ?? '').toLowerCase()}.${cls.split(/\s+/).filter(Boolean).sort().join('.')}`);
  }
  return out;
}

/** Is `a` an ordered subsequence of `b`? A fragment drops absent parts' elements. */
function isSubsequence(a: string[], b: string[]): boolean {
  let i = 0;
  for (const x of b) if (i < a.length && a[i] === x) i += 1;
  return i === a.length;
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  await connectDb();
  const { ProjectModel, BrandKitModel, BusinessModel } = await import('../models');
  const { default: mongoose } = await import('mongoose');

  const scaffolds = new Set(
    (await BusinessModel.find({ name: /^__/ }).select('_id').lean()).map((b) => String(b._id)),
  );
  /**
   * THE LIVE KIT, not just any kit. A business accumulates kits — detailmasters
   * has five, all approved — and compose reads exactly one: newest approved.
   * Measuring against an arbitrary one compares today's slides to a recipe that
   * never composed them, which is how `list` first read as 0% fragment when its
   * fragment substitutes cleanly in every shape a list slide comes in.
   */
  const recipeByBusiness = new Map<string, BrandRecipe>();
  for (const b of await BusinessModel.find({ name: { $not: /^__/ } }).select('_id').lean()) {
    if (scaffolds.has(String(b._id))) continue;
    const kit = (await BrandKitModel.findOne({
      businessId: b._id,
      status: 'approved',
      recipe: { $exists: true },
    })
      .sort({ createdAt: -1 })
      .lean()) as { recipe?: BrandRecipe } | null;
    if (kit?.recipe) recipeByBusiness.set(String(b._id), kit.recipe);
  }
  /**
   * The wordmark is not a stored field — it lives in the markup, and
   * `findBrandMark` is what the renderer itself uses to find it. Its words plus
   * the business name are the copy nobody wrote for this slide.
   */
  const brandWords = new Set<string>();
  for (const b of await BusinessModel.find({ name: { $not: /^__/ } }).select('name').lean())
    String(b.name).split(/\s+/).forEach((t) => brandWords.add(t.toLowerCase()));
  const fallback = [...recipeByBusiness.values()][0];
  if (!fallback) throw new Error('no recipe anywhere');

  // ── STYLE ────────────────────────────────────────────────────────────────
  let cssAuthored = 0;
  let cssCode = 0;
  for (const recipe of recipeByBusiness.values()) {
    const authored = composeRecipeLayers(recipe.layers) || recipe.stylesheet || '';
    const perFormat = Object.values(recipe.formats ?? {})
      .map((f) => (f as { stylesheet?: string }).stylesheet ?? '')
      .join('\n');
    const a = countDeclarations(authored) + countDeclarations(perFormat);
    const total = countDeclarations(recipeStylesheetFor(recipe, '1080x1350'));
    cssAuthored += a;
    cssCode += Math.max(0, total - a);
  }

  // ── WORDS + STRUCTURE ────────────────────────────────────────────────────
  const conn = mongoose.connection;
  const dbNames: string[] = (await conn.db!.admin().listDatabases()).databases
    .map((d: { name: string }) => d.name)
    .filter((n: string) => n.startsWith('contentbuilder'));

  /**
   * Fragments shipped part-way through the corpus, so a whole-corpus number
   * reports the pipeline as it USED to be. `recent` is the cohort composed
   * since — the only one that answers "what builds a slide today".
   */
  interface Slide {
    at: number;
    role: string;
    html: string;
    hasFragment: boolean;
    fromFragment: boolean;
    /** True when the slide SAYS which path made it, rather than being guessed. */
    known: boolean;
    charsAi: number;
    charsBrand: number;
  }
  const all: Slide[] = [];

  for (const name of dbNames) {
    const projects = await conn.getClient().db(name).collection('projects').find({}).toArray();
    for (const p of projects) {
      if (String(p.title ?? '').startsWith('__')) continue;
      const recipe = recipeByBusiness.get(String(p.businessId)) ?? fallback;
      const at = new Date(p.updatedAt ?? p.createdAt ?? 0).getTime();
      for (const s of (p.slides ?? []) as Array<{
        authored?: { html?: string; role?: string; source?: string };
      }>) {
        const html = s.authored?.html;
        if (!html) continue;
        const role = s.authored?.role ?? '?';
        for (const w of (findBrandMark(html)?.inner ?? '').replace(/<[^>]+>/g, ' ').split(/\s+/))
          if (w.trim()) brandWords.add(w.trim().toLowerCase());

        let charsAi = 0;
        let charsBrand = 0;
        for (const word of visibleText(html).split(/\s+/).filter(Boolean)) {
          const bare = word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
          if (bare && brandWords.has(bare)) charsBrand += word.length;
          else charsAi += word.length;
        }

        /**
         * ASK THE SLIDE FIRST. Slides composed since the path became a stored
         * field simply say which one made them. Older ones are guessed from
         * their markup — and the guess is weak in a way worth naming: a
         * fragment fill and a model compose that followed the same recipe order
         * are indistinguishable, `balanceVertical` moves the spacers of both,
         * and repeated rows make the skeletons differ in length in opposite
         * directions. The share of guessed slides is printed so the number is
         * read with the right confidence.
         */
        const variants = fragmentVariantsFor(recipe, role);
        const stored = s.authored?.source;
        all.push({
          at,
          role,
          html,
          hasFragment: variants.length > 0,
          fromFragment: stored
            ? stored === 'fragment'
            : variants.some((f) => isSubsequence(skeleton(html), skeleton(f))),
          known: Boolean(stored),
          charsAi,
          charsBrand,
        });
      }
    }
  }

  /** Composed since fragments existed: the newest third, by project date. */
  const dates = [...new Set(all.map((s) => s.at))].sort((a, b) => a - b);
  const cutoff = dates[Math.floor(dates.length * 0.66)] ?? 0;
  const pct = (a: number, b: number) => `${((a / (a + b || 1)) * 100).toFixed(1)}%`;

  for (const [label, cohort] of [
    ['EVERY SLIDE EVER STORED', all],
    ['COMPOSED MOST RECENTLY', all.filter((s) => s.at >= cutoff)],
  ] as Array<[string, Slide[]]>) {
    const n = cohort.length;
    const ai = cohort.reduce((t, s) => t + s.charsAi, 0);
    const brand = cohort.reduce((t, s) => t + s.charsBrand, 0);
    const frag = cohort.filter((s) => s.fromFragment).length;
    const noFrag = cohort.filter((s) => !s.hasFragment).length;
    console.log(`\n══ ${label} ═══════════ ${n} slides`);
    console.log(`  WORDS      model-written ${ai} chars ${pct(ai, brand)}   brand-constant ${brand} ${pct(brand, ai)}`);
    console.log(`  STRUCTURE  code-substituted fragment ${frag} ${pct(frag, n - frag)}   model-composed ${n - frag} ${pct(n - frag, frag)}`);
    console.log(`             (of the model-composed, ${noFrag} had no fragment for their role to use)`);
    const known = cohort.filter((s) => s.known).length;
    console.log(
      `             ${known}/${n} slides state their path; the other ${n - known} are inferred from markup`,
    );
    const byRole = new Map<string, { n: number; frag: number }>();
    for (const s of cohort) {
      const v = byRole.get(s.role) ?? { n: 0, frag: 0 };
      v.n += 1;
      if (s.fromFragment) v.frag += 1;
      byRole.set(s.role, v);
    }
    for (const [role, v] of [...byRole.entries()].sort((a, b) => b[1].n - a[1].n))
      console.log(`      ${role.padEnd(10)} n=${String(v.n).padStart(3)}  fragment ${((v.frag / v.n) * 100).toFixed(0)}%`);
  }

  console.log(`\n══ STYLE ═══════════════ ${cssAuthored + cssCode} declarations across ${recipeByBusiness.size} brands`);
  console.log(`  authored by the model  ${cssAuthored}  ${pct(cssAuthored, cssCode)}`);
  console.log(`  generated by code      ${cssCode}  ${pct(cssCode, cssAuthored)}`);

  await disconnectDb();
})();
