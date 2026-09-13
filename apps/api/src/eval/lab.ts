/**
 * SHARED PLUMBING FOR THE PROMPT LAB — the two things every lab script needs:
 * a brand's recipe by name, and a corpus brief by id.
 *
 * Brands resolve to the STORED approved kit when Mongo is reachable (what the
 * product actually composes against), else to the hand-authored reference
 * recipe; the result says which, because the two can differ and a lab result
 * against the wrong one measures nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateRecipe, type BrandRecipe } from '@contentbuilder/shared';
import { REFERENCE_RECIPES } from '../lib/htmlDirector/recipes';
import type { ComposeOptions } from '../lib/htmlDirector/compose';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = resolve(__dirname, 'corpus');
/** Where lab output lands. Gitignored. */
export const AUDIT_OUT = resolve(__dirname, '../../../../audit-out');

export function cliArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}
export const cliHas = (flag: string): boolean => process.argv.includes(flag);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ResolvedBrand {
  recipe: BrandRecipe;
  from: string;
  businessId?: string;
  kitId?: string;
}

/** A brand by name, case-insensitively, stored kit first. */
export async function recipeFor(brand: string, opts?: { reference?: boolean }): Promise<ResolvedBrand> {
  const stored = !(opts?.reference ?? cliHas('--reference'));
  try {
    if (!stored) throw new Error('reference requested');
    const { connectDb } = await import('../db');
    await connectDb(1, 200);
    const { BusinessModel, BrandKitModel } = await import('../models');
    const biz = (await BusinessModel.findOne({ name: new RegExp(`^${escapeRe(brand)}$`, 'i') }).lean()) as any;
    const kit = biz
      ? ((await BrandKitModel.findOne({ businessId: biz._id, status: 'approved' }).sort({ createdAt: -1 }).lean()) as any)
      : null;
    if (kit?.recipe) {
      return { recipe: migrateRecipe(kit.recipe), from: `stored kit ${kit._id}`, businessId: String(biz._id), kitId: String(kit._id) };
    }
  } catch {
    /* no db — fall through to the reference recipe */
  }
  const key = Object.keys(REFERENCE_RECIPES).find((k) => k.toLowerCase() === brand.toLowerCase())
    ?? Object.keys(REFERENCE_RECIPES).find((k) => k.toLowerCase().startsWith(brand.toLowerCase().slice(0, 6)));
  const ref = key ? REFERENCE_RECIPES[key] : undefined;
  if (!ref) throw new Error(`no recipe for brand "${brand}"`);
  let businessId: string | undefined;
  try {
    const { connectDb } = await import('../db');
    await connectDb(1, 200);
    const { BusinessModel } = await import('../models');
    const biz = (await BusinessModel.findOne({ name: new RegExp(`^${escapeRe(brand)}$`, 'i') }).lean()) as any;
    businessId = biz ? String(biz._id) : undefined;
  } catch {
    /* no db */
  }
  return { recipe: ref, from: `reference recipe (${key})`, ...(businessId ? { businessId } : {}) };
}

export interface CorpusBrief {
  id: string;
  title: string;
  brand: string;
  type?: string;
  format?: string;
  settings?: { audience?: string; dmKeyword?: string } | null;
  brief: { idea: string; plan?: string[]; locks?: string[]; sources?: Array<{ url: string; title?: string }> };
  parseUser?: string | null;
  generated: Array<{ id: string; role: string; path?: string; parts: Record<string, unknown>; html?: string }>;
  projectId?: string;
}

export function corpusBriefs(): CorpusBrief[] {
  let files: string[] = [];
  try {
    files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(resolve(CORPUS_DIR, f), 'utf8')) as CorpusBrief);
}

export function corpusBrief(idOrSubstring: string): CorpusBrief {
  const all = corpusBriefs();
  const hit = all.find((b) => b.id === idOrSubstring) ?? all.filter((b) => b.id.includes(idOrSubstring));
  if (Array.isArray(hit)) {
    if (hit.length === 1) return hit[0]!;
    throw new Error(hit.length ? `"${idOrSubstring}" matches ${hit.length} briefs: ${hit.map((b) => b.id).join(', ')}` : `no corpus brief matches "${idOrSubstring}"`);
  }
  return hit;
}

/** The compose options a corpus brief implies — format, plan, locks. */
export function optionsFor(b: CorpusBrief): ComposeOptions {
  return {
    format: b.format ?? '1080x1350',
    ...(b.brief.plan?.length ? { plan: b.brief.plan } : {}),
    ...(b.brief.locks?.length ? { locks: b.brief.locks } : {}),
  };
}
