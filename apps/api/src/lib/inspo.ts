/**
 * THE BAR, AS PICTURES. `inspo/` at the repo root holds the reference posts
 * captured from the swipe-file accounts, one contact strip per post, indexed
 * by the forms each demonstrates (inspo/tools/annotations.json). The deck
 * critique can be shown one or two of those strips beside the deck it is
 * judging, so "sameness" and "the number at poster size" are judged against
 * pixels rather than against a sentence in the prompt.
 *
 * Optional by construction: the folder is gitignored and absent on a fresh
 * clone or in CI, and everything here degrades to "no references".
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const INSPO_DIR = process.env.INSPO_DIR ?? resolve(__dirname, '../../../../inspo');

export interface ReferenceSheet {
  /** "@account — title (forms)" */
  label: string;
  buffer: Buffer;
  account: string;
  code: string;
  forms: string[];
}

interface Annotated {
  account: string;
  code: string;
  title: string;
  forms: string[];
  why: string;
}

let cache: Annotated[] | null | undefined;

function annotated(): Annotated[] {
  if (cache !== undefined) return cache ?? [];
  try {
    const raw = JSON.parse(readFileSync(resolve(INSPO_DIR, 'tools/annotations.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    const out: Annotated[] = [];
    for (const [account, posts] of Object.entries(raw)) {
      for (const [code, v] of Object.entries(posts)) {
        if (code.startsWith('_') || !Array.isArray(v)) continue;
        const [title, forms, why] = v as [string, string, string];
        out.push({ account, code, title, forms: String(forms).split('·').map((f) => f.trim().toLowerCase()).filter(Boolean), why });
      }
    }
    cache = out;
  } catch {
    cache = null;
  }
  return cache ?? [];
}

export const inspoAvailable = (): boolean => existsSync(resolve(INSPO_DIR, 'tools/annotations.json'));

/**
 * The forms a deck is made of, from its slides' roles and pictures — in the
 * vocabulary the annotations use.
 */
export function deckForms(slides: ReadonlyArray<{ role?: string; hasPhoto?: boolean; html?: string }>): string[] {
  const forms = new Set<string>();
  for (const s of slides) {
    switch (s.role) {
      case 'cover': forms.add(s.hasPhoto ? 'picture owns the frame' : 'one-liner'); break;
      case 'statement': forms.add('one-liner'); break;
      case 'stat': forms.add('number'); break;
      case 'list':
        forms.add(/class="(figures|ledger)"/.test(s.html ?? '') ? 'exhibit' : /\bnumbered\b|class="steps"/.test(s.html ?? '') ? 'numbered teaching poster' : 'list');
        if (/class="compare"/.test(s.html ?? '')) forms.add('comparison');
        break;
      case 'feature': forms.add(s.hasPhoto ? 'product proof' : 'numbered teaching poster'); break;
      case 'quote': forms.add('quote'); break;
      case 'cta': forms.add('close as an arrival'); break;
      default: break;
    }
  }
  return [...forms];
}

/**
 * One or two reference strips that share the most forms with the deck, from
 * different accounts, carousels first (a sequence is judged against a
 * sequence). Downscaled so two of them cost about a cent of vision input.
 */
export async function referenceSheetsFor(forms: readonly string[], max = 2): Promise<ReferenceSheet[]> {
  if (!forms.length || !inspoAvailable()) return [];
  const want = new Set(forms.map((f) => f.toLowerCase()));
  const ranked = annotated()
    .map((a) => {
      const path = resolve(INSPO_DIR, a.account, a.code, 'sheet.jpg');
      const slides = existsSync(resolve(INSPO_DIR, a.account, a.code, '03.jpg')) ? 3 : existsSync(resolve(INSPO_DIR, a.account, a.code, '02.jpg')) ? 2 : 1;
      const overlap = a.forms.filter((f) => want.has(f)).length;
      return { a, path, score: overlap * 2 + (slides >= 3 ? 1 : 0), ok: overlap > 0 && existsSync(path) };
    })
    .filter((x) => x.ok)
    .sort((x, y) => y.score - x.score);
  const out: ReferenceSheet[] = [];
  const accounts = new Set<string>();
  for (const x of ranked) {
    if (out.length >= max) break;
    if (accounts.has(x.a.account)) continue;
    try {
      const buffer = await sharp(x.path).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      out.push({ label: `@${x.a.account} — ${x.a.title} (${x.a.forms.join(' · ')})`, buffer, account: x.a.account, code: x.a.code, forms: x.a.forms });
      accounts.add(x.a.account);
    } catch {
      /* a strip that will not decode is skipped */
    }
  }
  return out;
}
