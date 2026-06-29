import { config, logConfigStatus } from './config';
import { connectDb, disconnectDb } from './db';
import { createApp } from './app';
import { closeBrowser } from './lib/browser';

async function main() {
  logConfigStatus();
  await connectDb();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[api] listening on ${config.apiUrl} (port ${config.port})`);
    console.log(`[api] health: ${config.apiUrl}/health`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[api] ${signal} received, shutting down…`);
    server.close();
    await closeBrowser();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] fatal startup error:', err);
  process.exit(1);
});
