import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { imageSize } from 'image-size';
import { BusinessModel, MediaAssetModel, BrandKitModel } from '../models';
import { getStorage } from '../storage';
import { z as zStock } from 'zod';
import { ApiError, asyncHandler, parseBody, requireObjectId } from '../lib/http';
import { generateBusinessBackgrounds } from '../lib/backgrounds';
import { generateAiBackground } from '../lib/aiBackground';
import { searchStockPhotos, stockConfigured, storeStockPhoto } from '../lib/stock';
import { sanitizeSvgUpload } from '../lib/svgSanitize';

/** Business-scoped media uploads. Mounted at /businesses/:id/media. */
export const mediaRouter = Router({ mergeParams: true });

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) cb(null, true);
    else cb(new ApiError(400, `Unsupported image type: ${file.mimetype}`));
  },
});

mediaRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const businessId = requireObjectId((req.params as Record<string, string>).id, 'Business');
    const docs = await MediaAssetModel.find({ businessId }).sort({ createdAt: -1 }).limit(500).lean();
    res.json(docs);
  }),
);

// Palette + count validation shared by both background endpoints.
function readColors(req: { body: unknown }): { colors: Record<string, string> & { palette?: string[] }; count: number } {
  const body = req.body as { colors?: Record<string, string> & { palette?: string[] }; count?: number };
  const colors = body?.colors;
  if (!colors?.background || !colors?.primary) throw new ApiError(400, 'Missing brand colors.');
  const count = Math.max(1, Math.min(12, Math.round(Number(body?.count) || 3)));
  return { colors, count };
}
function bgColors(colors: Record<string, string> & { palette?: string[] }) {
  return {
    primary: colors.primary!,
    secondary: colors.secondary ?? colors.primary!,
    accent: colors.accent ?? colors.primary!,
    background: colors.background!,
    text: colors.text,
    palette: colors.palette,
  };
}

// Regenerate the procedural brand backgrounds — unique per business, themed to
// the vertical, business-chosen `count`. Replaces the previous procedural set.
mediaRouter.post(
  '/backgrounds',
  asyncHandler(async (req, res) => {
    const businessId = requireObjectId((req.params as Record<string, string>).id, 'Business');
    const business = await BusinessModel.findById(businessId).lean();
    if (!business) throw new ApiError(404, 'Business not found');
    const { colors, count } = readColors(req);
    const profile = (business as Record<string, any>).profile ?? {};

    // Drop the previous procedural set (label prefix) so count/vertical changes
    // don't leave orphans; AI backgrounds (different label) are untouched.
    const stale = await MediaAssetModel.find({ businessId, type: 'generated', label: { $regex: '^Brand background' } });
    for (const a of stale) {
      try { await getStorage().remove(a.get('key')); } catch { /* best-effort */ }
      await a.deleteOne();
    }

    const assets = await generateBusinessBackgrounds(businessId, bgColors(colors), {
      category: profile.category,
      tone: profile.tone,
      count,
    });
    res.status(201).json(assets);
  }),
);

// Generate ONE AI background (cheap: SVG via the small text model), sanitized and
// stored alongside the procedural ones. Appends — never overwrites existing.
mediaRouter.post(
  '/backgrounds/ai',
  asyncHandler(async (req, res) => {
    const businessId = requireObjectId((req.params as Record<string, string>).id, 'Business');
    const business = await BusinessModel.findById(businessId).lean();
    if (!business) throw new ApiError(404, 'Business not found');
    const { colors } = readColors(req);
    const profile = (business as Record<string, any>).profile ?? {};
    const body = req.body as { styleDescriptor?: string; businessName?: string };

    // The brand aesthetic is the strongest fit signal — prefer what the editor
    // sent, else fall back to the approved kit's descriptor.
    let styleDescriptor = (body.styleDescriptor || '').trim();
    if (!styleDescriptor) {
      const kit = await BrandKitModel.findOne({ businessId, status: 'approved' }).sort({ createdAt: -1 }).lean();
      styleDescriptor = ((kit as Record<string, any>)?.styleDescriptor as string) ?? '';
    }
    // Rotate the composition by how many AI backgrounds already exist, so each
    // new one is deliberately different from the last.
    const variant = await MediaAssetModel.countDocuments({ businessId, type: 'generated', label: 'AI background' });

    const svg = await generateAiBackground(bgColors(colors), {
      category: profile.category,
      tone: profile.tone,
      styleDescriptor,
      businessName: body.businessName || ((business as Record<string, any>).name as string),
      variant,
    });
    if (!svg) {
      throw new ApiError(502, 'AI background generation is unavailable or produced an unusable result. Try again, or use the generated backgrounds.');
    }

    const key = `backgrounds/${businessId}/ai-${randomUUID()}.svg`;
    const stored = await getStorage().save(key, Buffer.from(svg, 'utf8'), { contentType: 'image/svg+xml' });
    const asset = await MediaAssetModel.create({
      businessId,
      type: 'generated',
      label: 'AI background',
      key: stored.key,
      url: stored.url,
      width: 1080,
      height: 1350,
    });
    res.status(201).json(asset.toJSON());
  }),
);

// Remove a media asset (e.g. dismiss a generated background you don't like).
mediaRouter.delete(
  '/:assetId',
  asyncHandler(async (req, res) => {
    const businessId = requireObjectId((req.params as Record<string, string>).id, 'Business');
    const assetId = requireObjectId((req.params as Record<string, string>).assetId, 'Media asset');
    const asset = await MediaAssetModel.findOne({ _id: assetId, businessId });
    if (!asset) throw new ApiError(404, 'Media asset not found');
    try {
      await getStorage().remove(asset.get('key'));
    } catch {
      /* best-effort: drop the record even if the blob is already gone */
    }
    await asset.deleteOne();
    res.status(204).end();
  }),
);

mediaRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const businessId = requireObjectId((req.params as Record<string, string>).id, 'Business');
    const business = await BusinessModel.findById(businessId).lean();
    if (!business) throw new ApiError(404, 'Business not found');
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw new ApiError(400, 'No file uploaded (field name must be "file")');

    // Content-sniff: verify the bytes are actually a raster image of the declared
    // type (defends against a spoofed Content-Type). SVG is text/XML, so it has no
    // raster header — instead it is SANITIZED (scripts/handlers/external refs
    // stripped) so the stored bytes are safe even if the /media URL is opened
    // directly.
    let width = 0;
    let height = 0;
    let uploadBuffer = file.buffer;
    if (file.mimetype === 'image/svg+xml') {
      const clean = sanitizeSvgUpload(file.buffer.toString('utf8'));
      if (!clean) {
        throw new ApiError(400, 'SVG could not be sanitized — it may be malformed or contain disallowed content.');
      }
      uploadBuffer = Buffer.from(clean, 'utf8');
    } else {
      let dim: ReturnType<typeof imageSize> | null = null;
      try {
        dim = imageSize(file.buffer);
      } catch {
        dim = null;
      }
      if (!dim?.type) {
        throw new ApiError(400, 'File does not appear to be a valid image.');
      }
      const declared = EXT_BY_MIME[file.mimetype]; // png | jpg | webp | gif
      const detected = dim.type === 'jpg' ? 'jpg' : dim.type; // image-size returns 'jpg' for jpeg
      if (declared === 'jpg' ? detected !== 'jpg' : detected !== declared) {
        throw new ApiError(400, `Image content (${dim.type}) does not match its type (${file.mimetype}).`);
      }
      width = dim.width ?? 0;
      height = dim.height ?? 0;
    }

    const ext = EXT_BY_MIME[file.mimetype] ?? 'bin';
    const key = `uploads/${businessId}/${randomUUID()}.${ext}`;
    const stored = await getStorage().save(key, uploadBuffer, { contentType: file.mimetype });

    const asset = await MediaAssetModel.create({
      businessId,
      type: 'upload',
      key: stored.key,
      url: stored.url,
      width,
      height,
    });
    res.status(201).json(asset.toJSON());
  }),
);

// ── Stock photos (Pexels) ─────────────────────────────────────────────────────
// Search candidates for the editor's picker (nothing stored), then store the
// user's pick into the library. Both are no-ops without PEXELS_API_KEY.

mediaRouter.get(
  '/stock/search',
  asyncHandler(async (req, res) => {
    requireObjectId((req.params as Record<string, string>).id, 'Business');
    if (!stockConfigured()) {
      throw new ApiError(400, 'Stock photos need PEXELS_API_KEY in .env (free at pexels.com/api).');
    }
    const query = String(req.query.query ?? '').slice(0, 80);
    const orientation = (['portrait', 'landscape', 'square'] as const).find(
      (o) => o === req.query.orientation,
    ) ?? 'portrait';
    if (!query.trim()) throw new ApiError(400, 'Provide a search query.');
    res.json({ candidates: await searchStockPhotos(query, orientation) });
  }),
);

mediaRouter.post(
  '/stock',
  asyncHandler(async (req, res) => {
    const businessId = requireObjectId((req.params as Record<string, string>).id, 'Business');
    const body = parseBody(
      zStock.object({
        full: zStock.string().url().max(500),
        width: zStock.number().int().positive(),
        height: zStock.number().int().positive(),
      }),
      req.body,
    );
    const asset = await storeStockPhoto(businessId, body);
    if (!asset) throw new ApiError(502, 'Could not download that photo — try another.');
    res.status(201).json(asset);
  }),
);
