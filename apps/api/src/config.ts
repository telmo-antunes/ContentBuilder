import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the single canonical .env from the repo root (apps/api runs with its
// own cwd, so resolve the path explicitly).
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
loadEnv({ path: resolve(repoRoot, '.env') });

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export const config = {
  repoRoot,
  port: Number(str('API_PORT', '4000')),
  apiUrl: str('API_URL', 'http://localhost:4000'),
  webUrl: str('WEB_URL', 'http://localhost:3000'),
  mongoUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017/contentbuilder'),
  storage: {
    provider: str('STORAGE_PROVIDER', 'disk'),
    dir: resolve(repoRoot, str('STORAGE_DIR', './storage')),
  },
  ai: {
    apiKey: optional('ANTHROPIC_API_KEY'),
    model: optional('ANTHROPIC_MODEL'),
    modelSmall: optional('ANTHROPIC_MODEL_SMALL'),
    /** Stronger model for Free-mode spatial layout; falls back to model/modelSmall. */
    modelLarge: optional('ANTHROPIC_MODEL_FREE'),
  },
};

/** AI is "configured" only when a key AND the relevant model are present. */
export const aiVisionConfigured = (): boolean => Boolean(config.ai.apiKey && config.ai.model);
export const aiDraftConfigured = (): boolean => Boolean(config.ai.apiKey && config.ai.modelSmall);
/** Free-mode generation works on any configured model (prefers the large one). */
export const aiFreeConfigured = (): boolean =>
  Boolean(config.ai.apiKey && (config.ai.modelLarge || config.ai.model || config.ai.modelSmall));

export type AppConfig = typeof config;

/**
 * Validate config at boot: hard-fail on a broken port, warn (don't crash) on
 * missing AI config since the app degrades gracefully, and print a one-line
 * status so a misconfigured environment is obvious immediately.
 */
export function logConfigStatus(): void {
  if (!Number.isFinite(config.port)) {
    throw new Error(`Invalid API_PORT: "${process.env.API_PORT}" — must be a number.`);
  }
  const warn = (m: string) => console.warn(`[config] ⚠ ${m}`);
  if (!config.ai.apiKey) {
    warn('ANTHROPIC_API_KEY is not set — brand vision and AI drafts are disabled.');
  } else {
    if (!config.ai.modelSmall) warn('ANTHROPIC_MODEL_SMALL is not set — Designer/Free drafts are disabled.');
    if (!config.ai.model) warn('ANTHROPIC_MODEL is not set — brand vision falls back to heuristic colors.');
  }
  console.log(
    `[config] storage=${config.storage.provider} · ai: vision=${aiVisionConfigured()} draft=${aiDraftConfigured()} free=${aiFreeConfigured()}`,
  );
}
