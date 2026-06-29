import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { extname } from 'node:path';
import { config, aiVisionConfigured, aiDraftConfigured, aiFreeConfigured } from './config';
import { dbState } from './db';
import { getStorage, MEDIA_ROUTE } from './storage';
import { errorHandler } from './lib/http';
import { businessesRouter } from './routes/businesses';
import { projectsRouter } from './routes/projects';
import { mediaRouter } from './routes/media';
import { businessBrandKitRouter, brandKitRouter } from './routes/brandkits';
import { settingsRouter } from './routes/settings';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
};

export function createApp() {
  const app = express();

  // Internal tool, no auth: allow the configured web origin plus any localhost
  // port (the dev web server may bind an auto-assigned port).
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl / same-origin / server-side
        try {
          const { hostname } = new URL(origin);
          const ok = origin === config.webUrl || hostname === 'localhost' || hostname === '127.0.0.1';
          return cb(null, ok);
        } catch {
          return cb(null, false);
        }
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '5mb' }));

  // Health check — reports DB connectivity and which AI paths are configured.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'contentbuilder-api',
      db: dbState(),
      ai: { vision: aiVisionConfigured(), draft: aiDraftConfigured(), free: aiFreeConfigured() },
      time: new Date().toISOString(),
    });
  });

  app.get('/', (_req: Request, res: Response) => {
    res.json({ service: 'contentbuilder-api', health: '/health', media: MEDIA_ROUTE });
  });

  // ── API routes ────────────────────────────────────────────────────────────
  // More specific business-scoped routers first (extra path segments), so they
  // win over businessesRouter's '/:id'.
  app.use('/businesses/:id/media', mediaRouter);
  app.use('/businesses/:id', businessBrandKitRouter);
  app.use('/businesses', businessesRouter);
  app.use('/brandkits', brandKitRouter);
  app.use('/projects', projectsRouter);
  app.use('/settings', settingsRouter);

  // Serve stored media through the StorageProvider (provider-agnostic).
  app.get(`${MEDIA_ROUTE}/*`, async (req: Request, res: Response) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).json({ error: 'missing media key' });
      return;
    }
    try {
      const storage = getStorage();
      if (!(await storage.exists(key))) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const data = await storage.read(key);
      const ct = CONTENT_TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(data);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'read failed' });
    }
  });

  // Terminal error handler (must be last).
  app.use(errorHandler);

  return app;
}
