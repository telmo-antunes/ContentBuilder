/**
 * TAG THE LIBRARY — one vision call per untagged picture, stored on the asset.
 *
 *   npm run media:tag -- --business "detailmasters CRM"     # this brand's untagged pictures
 *   npm run media:tag -- --all                               # every brand
 *   npm run media:tag -- --business "…" --force              # re-tag everything
 *   npm run media:tag -- --business "…" --dry                # list what would be tagged
 *
 * About half a cent per picture (see MEDIA_TAG_ESTIMATE_USD).
 */
import { connectDb, disconnectDb } from '../db';
import { getStorage } from '../storage';
import { MEDIA_TAG_ESTIMATE_USD, tagImage } from '../lib/mediaTags';

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (flag: string) => process.argv.includes(flag);

(async () => {
  const name = arg('--business');
  const all = has('--all');
  if (!name && !all) throw new Error('usage: tagMedia.ts --business "<name>" | --all [--force] [--dry]');
  await connectDb();
  const { BusinessModel, MediaAssetModel } = await import('../models');
  const filter: Record<string, unknown> = {};
  if (name) {
    const biz = (await BusinessModel.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean()) as any;
    if (!biz) throw new Error(`no business "${name}"`);
    filter.businessId = biz._id;
  }
  if (!has('--force')) filter['tags.taggedAt'] = { $exists: false };
  const assets = (await MediaAssetModel.find(filter).sort({ createdAt: -1 }).lean()) as any[];
  console.log(`${assets.length} picture(s) to tag (~$${(assets.length * MEDIA_TAG_ESTIMATE_USD).toFixed(2)})`);
  if (has('--dry')) {
    for (const a of assets) console.log(`  ${a._id} ${a.width}x${a.height} ${a.label ?? ''} ${a.key}`);
    await disconnectDb();
    return;
  }
  const storage = getStorage();
  let done = 0;
  for (const a of assets) {
    try {
      const buffer = await storage.read(String(a.key));
      const tags = await tagImage(buffer);
      if (!tags) {
        console.warn(`  ${a._id}: no tags (vision unconfigured or unusable reply)`);
        continue;
      }
      await MediaAssetModel.updateOne({ _id: a._id }, { $set: { tags } });
      done += 1;
      console.log(`  ${a._id} ${a.width}x${a.height} → ${tags.kind} · ${tags.tone} · ${tags.subjects.join(', ')} — ${tags.caption}`);
    } catch (err) {
      console.warn(`  ${a._id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`tagged ${done}/${assets.length}`);
  await disconnectDb();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
