import { randomUUID } from 'node:crypto';
import { MediaAssetModel } from '../models';
import { getStorage } from '../storage';
import { assertPublicHttpUrl } from './urlGuard';

/**
 * Brand image harvesting (G7): download the analyzed site's biggest content
 * photos into the business's media library, so posts can use the brand's REAL
 * imagery instead of placeholders. Candidates are collected during analyze
 * (analyze.ts siteImages); this stores up to MAX of them. Re-analysis replaces
 * the previous harvest (like backgrounds), never user uploads.
 */

const MAX_HARVEST = 4;
const MAX_BYTES = 8 * 1024 * 1024;
export const SITE_PHOTO_LABEL = 'From your website';

const EXT_BY_CT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export async function harvestSiteImages(
  businessId: string,
  candidates: Array<{ src: string; width: number; height: number }>,
): Promise<number> {
  if (!candidates.length) return 0;
  const fresh: Array<Record<string, unknown>> = [];
  for (const c of candidates) {
    if (fresh.length >= MAX_HARVEST) break;
    try {
      // Image URLs come from the analyzed page's DOM — same SSRF rules as logos.
      await assertPublicHttpUrl(c.src, 'Site image URL');
      const res = await fetch(c.src, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      const ext = EXT_BY_CT[ct];
      if (!ext) continue; // photos only — svg/ico/etc. are chrome, not content
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) continue;
      const stored = await getStorage().save(`harvest/${businessId}/${randomUUID()}.${ext}`, buf, {
        contentType: ct,
      });
      fresh.push({
        businessId,
        type: 'upload',
        label: SITE_PHOTO_LABEL,
        key: stored.key,
        url: stored.url,
        width: c.width,
        height: c.height,
      });
    } catch {
      continue; // one bad image never sinks the harvest
    }
  }
  if (fresh.length) {
    // Replace the previous harvest — the site may have changed; uploads untouched.
    await MediaAssetModel.deleteMany({ businessId, label: SITE_PHOTO_LABEL });
    await MediaAssetModel.insertMany(fresh);
  }
  return fresh.length;
}
