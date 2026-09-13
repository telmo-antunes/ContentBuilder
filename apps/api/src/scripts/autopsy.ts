/**
 * DECK AUTOPSY — one stored project, every decision that shaped every slide,
 * next to the pixels it produced.
 *
 *   npx tsx src/scripts/autopsy.ts <projectId> [--out <dir>] [--no-shoot]
 *
 * Writes <dir>/<projectId>.md (the table) and <dir>/<projectId>.png (the
 * contact sheet at feed scale, photos attached, straight off the live /render
 * route). Default dir: <repo>/audit-out (gitignored).
 *
 * WHY. The product records a great deal about how a deck came to be — which
 * path composed each slide, which archetype and surface it was laid out under,
 * the copywriter's one-line rationale, every call the code made
 * (`composeNotes`), the copy faults that survived repair, the art-director
 * critique, and what the post cost — and shows it in six different places.
 * Read together, "this deck is bad" becomes a named cause per slide, which is
 * the only form of the complaint anyone can act on.
 *
 * Needs the API's Mongo and, for the sheet, the web server at WEB_URL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { connectDb, disconnectDb } from '../db';
import { closeBrowser } from '../lib/browser';
import { buildContactSheet } from '../lib/contactSheet';
import { shootLiveDeck } from '../lib/htmlDirector/renderCheck';
import { isFormat, type Format } from '@contentbuilder/shared';

const asFormat = (f: string): Format => (isFormat(f) ? f : '1080x1350');

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cell = (s: unknown): string => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

(async () => {
  const id = process.argv[2];
  if (!id || id.startsWith('--')) throw new Error('usage: autopsy.ts <projectId> [--out <dir>] [--no-shoot]');
  const outDir = resolve(arg('--out') ?? resolve(__dirname, '../../../../audit-out'));
  const shoot = !process.argv.includes('--no-shoot');
  mkdirSync(outDir, { recursive: true });

  await connectDb();
  const { ProjectModel, GenerationModel, BusinessModel, BrandKitModel } = await import('../models');
  const p = (await ProjectModel.findById(id).lean()) as any;
  if (!p) throw new Error(`no project ${id}`);
  const business = (await BusinessModel.findById(p.businessId).lean()) as any;
  const gen = (await GenerationModel.findOne({ projectId: p._id, kind: 'deck' }).sort({ createdAt: -1 }).lean()) as any;
  const kit = p.recipeSnapshot
    ? { recipe: p.recipeSnapshot, pinned: true }
    : { recipe: ((await BrandKitModel.findOne({ businessId: p.businessId, status: 'approved' }).sort({ createdAt: -1 }).lean()) as any)?.recipe, pinned: false };

  const slides: any[] = p.slides ?? [];
  const notesFor = (i: number) => (p.composeNotes ?? []).filter((n: any) => n.slide === i + 1 || n.slide === i).map((n: any) => n.note);
  const deckNotes = (p.composeNotes ?? []).filter((n: any) => n.slide === undefined || n.slide === null).map((n: any) => n.note);
  const faultsFor = (i: number) =>
    (Array.isArray(p.copyFaults) ? p.copyFaults : []).filter((f: any) => f.slide === i + 1 || f.slide === i);
  const critique = p.critique ?? {};
  const findings: any[] = Array.isArray(critique.findings) ? critique.findings : [];
  const critFor = (i: number) => findings.filter((f) => f.slide === i + 1);
  const genSlide = (sid: string) => (gen?.slides ?? []).find((s: any) => s.id === sid);

  const lines: string[] = [];
  lines.push(`# Autopsy — ${p.title ?? p._id}`);
  lines.push('');
  lines.push(`- **project** ${p._id} · **brand** ${business?.name ?? p.businessId} · **type** ${p.type} ${p.format} · **stage** ${p.stage ?? '-'} · **updated** ${p.updatedAt?.toISOString?.().slice(0, 10) ?? '-'}`);
  lines.push(`- **recipe** ${kit.pinned ? 'pinned snapshot' : 'live kit'}${kit.recipe?.promptVersion ? ` (prompt versions ${JSON.stringify(kit.recipe.promptVersion)})` : ''} · fragments for: ${Object.keys(kit.recipe?.fragments ?? {}).join(', ') || 'none'}`);
  lines.push(`- **models** parse ${gen?.models?.parse ?? '?'} · compose ${gen?.models?.compose ?? '?'} · prompt versions ${JSON.stringify(gen?.promptVersions ?? p.slides?.[0]?.authored?.pv ?? {})}`);
  if (p.spend) {
    const by = Object.entries(p.spend.byFeature ?? {}).map(([k, v]: any) => `${k} $${Number(v).toFixed(3)}`).join(', ');
    lines.push(`- **spend** $${Number(p.spend.totalUsd ?? p.spend.spentUsd ?? 0).toFixed(3)} of $${p.spend.ceilingUsd ?? '?'}${by ? ` — ${by}` : ''}${(p.spend.skipped ?? []).length ? ` · skipped: ${p.spend.skipped.join('; ')}` : ''}`);
  }
  lines.push(`- **settings** audience ${p.settings?.audience ?? '-'} · dm keyword ${p.settings?.dmKeyword ?? '-'} · caption ${p.caption?.text ? `${p.caption.text.length} chars` : 'none'}`);
  lines.push(`- **critique** ${critique.status ?? 'absent'}${critique.reason ? ` (${critique.reason})` : ''}${critique.verdict ? ` — ${cell(critique.verdict)}` : ''}${critique.summary ? ` — ${cell(critique.summary)}` : ''}`);
  if (deckNotes.length) lines.push(`- **deck notes** ${deckNotes.map(cell).join(' · ')}`);
  lines.push('');
  lines.push('## Brief');
  lines.push('');
  lines.push('```');
  lines.push(String(gen?.brief?.idea ?? p.idea ?? '(not recorded)').slice(0, 2400));
  lines.push('```');
  if (gen?.brief?.plan?.length) lines.push(`Plan: ${gen.brief.plan.map((s: string, i: number) => `${i + 1}. ${s}`).join(' ')}`);
  if (gen?.brief?.sources?.length) lines.push(`Sources: ${gen.brief.sources.map((s: any) => s.url).join(', ')}`);
  lines.push('');
  lines.push('## Slides');
  lines.push('');
  lines.push('| # | role | path | archetype | surface | align | photos | text (as shipped) | copy parts (as generated) | code decisions | copy faults | critique | AI rationale |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [i, s] of slides.entries()) {
    const a = s.authored ?? {};
    const g = genSlide(s.id);
    const photos = (s.photos ?? []).map((ph: any) => `${ph.placement}${ph.slot ? `:${ph.slot}` : ''}`).join(' ');
    const parts = g?.parts ? Object.entries(g.parts).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : '';
    const edited = g?.html && g.html !== a.html ? ' (hand-edited since)' : '';
    lines.push(
      `| ${i + 1} | ${cell(a.role)} | ${cell(a.source ?? g?.path ?? '?')}${edited} | ${cell(a.archetype)} | ${cell(a.surface ?? a.bg ?? 'base')} | ${cell(a.align ?? '')} | ${cell(photos)} | ${cell(textOf(a.html ?? '').slice(0, 220))} | ${cell(parts.slice(0, 260))} | ${cell(notesFor(i).join(' · '))} | ${cell(faultsFor(i).map((f: any) => `${f.label ?? ''}: ${f.reason ?? f.text ?? ''}`).join(' · '))} | ${cell(critFor(i).map((f) => `[${f.severity ?? ''}] ${f.finding ?? f.text ?? JSON.stringify(f)}`).join(' · '))} | ${cell(s.rationale ?? '')} |`,
    );
  }
  lines.push('');
  const bySource = slides.reduce((m: Record<string, number>, s: any) => {
    const k = s.authored?.source ?? 'unknown';
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  const byArch = slides.reduce((m: Record<string, number>, s: any) => {
    const k = s.authored?.archetype ?? 'none';
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  lines.push(`**Path:** ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')} · **Archetypes:** ${Object.entries(byArch).map(([k, v]) => `${k} ${v}`).join(', ')} · **Slides with a picture:** ${slides.filter((s) => (s.photos ?? []).length).length}/${slides.length}`);
  if (findings.length && findings.some((f) => !f.slide)) {
    lines.push('');
    lines.push('**Deck-level critique:** ' + findings.filter((f) => !f.slide).map((f) => `[${f.severity ?? ''}] ${cell(f.finding ?? f.text ?? JSON.stringify(f))}`).join(' · '));
  }

  let sheetNote = '';
  if (shoot && slides.length) {
    const shots = await shootLiveDeck(String(p._id), slides.map((s) => s.id), p.format);
    const ok = shots.filter(Boolean).length;
    if (ok) {
      const sheet = await buildContactSheet(
        shots.map((b64, i) => ({
          buffer: b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0),
          flags: [
            ...(faultsFor(i).length ? ['copy fault'] : []),
            ...(critFor(i).some((f) => f.severity === 'blocking') ? ['critique: blocking'] : []),
          ],
        })).filter((s) => s.buffer.length),
        asFormat(p.format),
      );
      writeFileSync(resolve(outDir, `${p._id}.png`), sheet);
      sheetNote = `Contact sheet: ${p._id}.png (${ok}/${shots.length} slides photographed)`;
    } else sheetNote = 'Contact sheet: no slide would photograph (is the web server up?)';
    lines.push('');
    lines.push(sheetNote);
  }
  writeFileSync(resolve(outDir, `${p._id}.md`), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\nwrote ${resolve(outDir, `${p._id}.md`)}`);
  await disconnectDb();
  await closeBrowser().catch(() => {});
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
