/**
 * WHAT THE DESIGNER SEES OF A BRAND'S LIBRARY — the pool, as the designer is
 * briefed with it: kind, tone, caption, subjects, size. The first thing to
 * read when a designed deck came back all type: was there a picture to use?
 *
 *   npx tsx src/scripts/poolPeek.ts "<brand name>" [words the deck is about…]
 * With words, the pool is the designer's relevance-ranked one; without, the composer's newest-first.
 */
import { connectDb } from '../db';
import { BusinessModel } from '../models';
import { brandPhotoPool, designerPhotoPool, poolIsTagged } from '../lib/photoPool';

const name = process.argv[2];
if (!name) {
  console.error('usage: poolPeek.ts "<brand name>"');
  process.exit(1);
}
await connectDb(1, 200);
const biz = (await BusinessModel.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean()) as { _id: unknown } | null;
if (!biz) {
  console.error(`no business named "${name}"`);
  process.exit(1);
}
const words = process.argv.slice(3);
const pool = words.length ? await designerPhotoPool(String(biz._id), words) : await brandPhotoPool(String(biz._id));
console.log(`${pool.length} picture(s) offered · tagged: ${poolIsTagged(pool)}`);
for (const [i, m] of pool.entries()) {
  const t = m.tags;
  console.log(`  p${i + 1} [${t?.kind ?? '?'}${t?.tone ? `, ${t.tone}` : ''}] ${t?.caption ? `"${t.caption}"` : '(untagged)'}${t?.subjects?.length ? ` · ${t.subjects.join(', ')}` : ''} · ${m.width ?? '?'}×${m.height ?? '?'} · ${m.label ?? ''}`);
}
process.exit(0);
