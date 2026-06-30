import { buildBrandBackgrounds, type BgColors } from '@contentbuilder/shared';
import { getStorage } from '../storage';
import { MediaAssetModel } from '../models';

/**
 * (Re)generate the 3 procedural brand backgrounds for a business and store them
 * as media assets. Upserts by a deterministic key so regenerating reuses the same
 * asset id + url — slides that already reference a background keep working.
 */
export async function generateBusinessBackgrounds(businessId: string, colors: BgColors) {
  const storage = getStorage();
  const assets = [];
  for (const bg of buildBrandBackgrounds(colors)) {
    const key = `backgrounds/${businessId}/${bg.id}.svg`;
    const stored = await storage.save(key, Buffer.from(bg.svg, 'utf8'), { contentType: 'image/svg+xml' });
    const asset = await MediaAssetModel.findOneAndUpdate(
      { businessId, key: stored.key },
      {
        businessId,
        type: 'generated',
        label: `Brand background — ${bg.label}`,
        key: stored.key,
        url: stored.url,
        width: 1080,
        height: 1350,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    assets.push(asset.toJSON());
  }
  return assets;
}
