/**
 * Would the unfinished-prose check fire on copy that actually shipped?
 *
 * A check that flags good writing gets switched off, so it is measured against
 * every string in every stored deck before it is trusted. Run it after touching
 * `DANGLING_WORDS` or `unfinishedProse`.
 *
 *   npx tsx src/scripts/validateProseCheck.ts
 */
import { connectDb, disconnectDb } from '../db';
import { unfinishedProse } from '../lib/htmlDirector/compose';

(async () => {
  await connectDb();
  const { default: mongoose } = await import('mongoose');
  const conn = mongoose.connection;
  const dbNames: string[] = (await conn.db!.admin().listDatabases()).databases
    .map((d: { name: string }) => d.name)
    .filter((n: string) => n.startsWith('contentbuilder'));

  const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const grab = (html: string, cls: string) =>
    [...html.matchAll(new RegExp(`<[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/`, 'g'))]
      .map((m) => strip(m[1] ?? ''))
      .filter(Boolean);

  let strings = 0;
  const hits: string[] = [];
  for (const name of dbNames) {
    for (const p of await conn.getClient().db(name).collection('projects').find({}).toArray()) {
      if (String(p.title ?? '').startsWith('__')) continue;
      for (const s of (p.slides ?? []) as Array<{ authored?: { html?: string } }>) {
        const html = s.authored?.html;
        if (!html) continue;
        // Rebuild a parsed slide from what shipped, so the real function judges it.
        const parts = {
          headline: grab(html, 'headline')[0],
          body: grab(html, 'body')[0],
          tagline: grab(html, 'tagline')[0],
          quote: grab(html, 'quote')[0],
          rows: grab(html, 'note').map((note) => ({ text: 'row', note })),
        };
        strings += Object.values(parts).filter((v) => typeof v === 'string' && v).length + parts.rows.length;
        for (const u of unfinishedProse([{ role: 'statement', parts, image: false }] as never)) {
          hits.push(`${u.label.padEnd(14)} ${u.reason.padEnd(26)} ${u.text.slice(0, 62)}`);
        }
      }
    }
  }
  console.log(`checked ${strings} strings from every stored deck`);
  console.log(`the check fires on ${hits.length}:`);
  hits.forEach((h) => console.log(`  ${h}`));
  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
