import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the single canonical .env from the repo root so NEXT_PUBLIC_* vars are
// inlined consistently with the API's config.
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '..', '..', '.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the source-only shared types package.
  transpilePackages: ['@contentbuilder/shared'],
  // Same-origin proxy for the API: the browser calls /api/* on THIS origin and
  // Next forwards to the API server. This is what lets the opt-in APP_PASSWORD
  // Basic auth cover API calls too — the browser automatically re-sends the
  // credentials it entered for the UI, and the rewrite forwards the header.
  async rewrites() {
    const apiUrl = (process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, '');
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
