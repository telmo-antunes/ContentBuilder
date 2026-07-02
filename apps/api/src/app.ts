import { timingSafeEqual } from 'node:crypto';
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
import { businessCampaignRouter, campaignRouter } from './routes/campaigns';
import { settingsRouter } from './routes/settings';
import { usageRouter } from './routes/usage';

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

  // ── Opt-in auth (deployment) ───────────────────────────────────────────────
  // When APP_PASSWORD is set, every route except /health and media reads
  // requires the same Basic credentials the web UI uses. The browser reaches
  // this API through the web app's same-origin /api proxy, so the credentials
  // it already entered for the UI cover API calls too. Unset → open (local dev).
  if (config.appPassword) {
    const expected = config.appPassword;
    app.use((req: Request, res: Response, next) => {
      if (req.method === 'OPTIONS' || req.path === '/health' || req.path.startsWith(`${MEDIA_ROUTE}/`)) {
        return next();
      }
      const header = req.headers.authorization ?? '';
      if (header.startsWith('Basic ')) {
        try {
          const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
          const password = decoded.slice(decoded.indexOf(':') + 1);
          if (
            password.length === expected.length &&
            timingSafeEqual(Buffer.from(password), Buffer.from(expected))
          ) {
            return next();
          }
        } catch {
          /* fall through to 401 */
        }
      }
      res.setHeader('WWW-Authenticate', 'Basic realm="ContentBuilder API", charset="UTF-8"');
      res.status(401).json({ error: 'Authentication required' });
    });
  }

  // ── Rate limiting on expensive routes (AI + Puppeteer) ────────────────────
  // Tiny in-memory sliding window; enough to stop a runaway script or a
  // drive-by burning the AI budget. 30 expensive POSTs / 5 min / IP.
  {
    const WINDOW_MS = 5 * 60 * 1000;
    const MAX = 30;
    const hits = new Map<string, number[]>();
    const EXPENSIVE = /(\/analyze|\/draft|\/critique|\/caption|\/export|\/backgrounds(\/ai)?|\/campaigns)$/;
    app.use((req: Request, res: Response, next) => {
      if (req.method !== 'POST' || !EXPENSIVE.test(req.path)) return next();
      const now = Date.now();
      const key = req.ip ?? 'unknown';
      const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
      if (recent.length >= MAX) {
        res.status(429).json({ error: 'Too many generation requests — wait a few minutes and try again.' });
        return;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 1000) {
        for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
      }
      next();
    });
  }

  // ── API routes ────────────────────────────────────────────────────────────
  // More specific business-scoped routers first (extra path segments), so they
  // win over businessesRouter's '/:id'.
  app.use('/businesses/:id/media', mediaRouter);
  app.use('/businesses/:id/campaigns', businessCampaignRouter);
  app.use('/businesses/:id', businessBrandKitRouter);
  app.use('/businesses', businessesRouter);
  app.use('/brandkits', brandKitRouter);
  app.use('/campaigns', campaignRouter);
  app.use('/projects', projectsRouter);
  app.use('/settings', settingsRouter);
  app.use('/usage', usageRouter);

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
