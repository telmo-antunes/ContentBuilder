import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { imageSize } from 'image-size';
import { BusinessModel, MediaAssetModel } from '../models';
import { getStorage } from '../storage';
import { ApiError, asyncHandler, requireObjectId } from '../lib/http';
import { generateBusinessBackgrounds } from '../lib/backgrounds';

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
    const docs = await MediaAssetModel.find({ businessId }).sort({ createdAt: -1 }).lean();
    res.json(docs);
  }),
);

// Regenerate the procedural brand backgrounds from a palette (on-demand button).
mediaRouter.post(
  '/backgrounds',
  asyncHandler(async (req, res) => {
    const businessId = requireObjectId((req.params as Record<string, string>).id, 'Business');
    const business = await BusinessModel.findById(businessId).lean();
    if (!business) throw new ApiError(404, 'Business not found');
    const colors = (req.body as { colors?: Record<string, string> })?.colors;
    if (!colors?.background || !colors?.primary) {
      throw new ApiError(400, 'Missing brand colors.');
    }
    const assets = await generateBusinessBackgrounds(businessId, {
      primary: colors.primary,
      secondary: colors.secondary ?? colors.primary,
      accent: colors.accent ?? colors.primary,
      background: colors.background,
      text: colors.text,
      palette: (req.body as { colors?: { palette?: string[] } })?.colors?.palette,
    });
    res.status(201).json(assets);
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
    // raster header — skip the check for it.
    let width = 0;
    let height = 0;
    if (file.mimetype !== 'image/svg+xml') {
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
    const stored = await getStorage().save(key, file.buffer, { contentType: file.mimetype });

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
