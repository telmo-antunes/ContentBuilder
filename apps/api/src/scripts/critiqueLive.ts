/**
 * Review a SAVED deck the way the compose route does after the photos are
 * attached — shot through the live /render route, with the reference strips
 * from inspo/ shown to the critic — without composing anything. A lab
 * instrument for judging a deck that already exists, at the critique's cost
 * (about six cents with two references).
 *
 *   WEB_URL=http://localhost:3000 npx tsx src/scripts/critiqueLive.ts <projectId> [--no-references]
 */
import { migrateRecipe } from '@contentbuilder/shared';
import { connectDb, disconnectDb } from '../db';
import { closeBrowser } from '../lib/browser';
import { shootLiveDeck } from '../lib/htmlDirector/renderCheck';
import { critiqueDeck } from '../lib/htmlDirector/deckCritique';
import { deckForms, referenceSheetsFor } from '../lib/inspo';
import { withSpendLedger } from '../lib/spend';

(async () => {
  const id = process.argv[2];
  if (!id || id.startsWith('--')) throw new Error('usage: critiqueLive.ts <projectId> [--no-references]');
  await connectDb();
  const { ProjectModel, BrandKitModel } = await import('../models');
  const p = (await ProjectModel.findById(id).lean()) as any;
  if (!p) throw new Error(`no project ${id}`);
  const kit = (await BrandKitModel.findOne({ businessId: p.businessId, status: 'approved' }).sort({ createdAt: -1 }).lean()) as any;
  const recipe = migrateRecipe(p.recipeSnapshot ?? kit?.recipe);
  const slides: any[] = p.slides ?? [];
  const forms = deckForms(slides.map((s) => ({ role: s.authored?.role, hasPhoto: (s.photos ?? []).length > 0, html: s.authored?.html })));
  const refs = process.argv.includes('--no-references') ? [] : await referenceSheetsFor(forms);
  console.log(`deck forms: ${forms.join(', ')}`);
  console.log(refs.length ? `references: ${refs.map((r) => `${r.label} (${Math.round(r.buffer.length / 1024)} KB)`).join(' | ')}` : 'references: none');
  const shots = await shootLiveDeck(id, slides.map((s) => s.id), p.format);
  console.log(`shots: ${shots.filter(Boolean).length}/${shots.length}`);
  const { value, ledger } = await withSpendLedger({ projectId: id, ceilingUsd: 0.4 }, () =>
    critiqueDeck(recipe, shots.map((b) => (b ? Buffer.from(b, 'base64') : null)), p.format, { references: refs }),
  );
  console.log(JSON.stringify(value, null, 2));
  console.log(`spent $${ledger.spentUsd.toFixed(3)}${ledger.skipped.length ? ` · skipped: ${ledger.skipped.join(', ')}` : ''}`);
  await disconnectDb();
  await closeBrowser().catch(() => {});
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
