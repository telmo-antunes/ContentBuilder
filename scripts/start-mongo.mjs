// Dev-only MongoDB launcher.
//
// Homebrew's mongodb-community has no prebuilt bottle for this macOS version
// and building from source needs a newer Xcode, so for local dev we run a
// prebuilt `mongod` binary via mongodb-memory-server — bound to the standard
// localhost port with a PERSISTENT data dir so it behaves like a normal local
// Mongo (data survives restarts). A real Mongo (Homebrew service, Atlas, etc.)
// drops in with zero code change: just point MONGODB_URI at it and skip this.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/contentbuilder';
let port = 27017;
try {
  const u = new URL(uri);
  if (u.port) port = Number(u.port);
} catch {
  /* keep default */
}

const dbPath = resolve(root, '.mongo-data');
mkdirSync(dbPath, { recursive: true });

console.log(`[mongo] starting persistent dev mongod on port ${port} (data: ${dbPath})`);

const mongod = await MongoMemoryServer.create({
  instance: { port, dbPath, storageEngine: 'wiredTiger' },
});

console.log(`[mongo] ready at ${mongod.getUri()}`);
console.log('[mongo] press Ctrl-C to stop (data is preserved)');

async function shutdown() {
  console.log('\n[mongo] stopping (data preserved)…');
  // doCleanup:false keeps our persistent dbPath on disk.
  await mongod.stop({ doCleanup: false, force: false });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
