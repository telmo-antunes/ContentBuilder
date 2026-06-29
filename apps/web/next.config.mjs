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
};

export default nextConfig;
