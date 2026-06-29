import mongoose from 'mongoose';
import { config } from './config';

mongoose.set('strictQuery', true);

/**
 * Connect to MongoDB with a short retry loop — in dev the bundled mongod
 * (npm run db) may still be starting when the API boots under `concurrently`.
 */
export async function connectDb(retries = 20, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
      console.log(`[db] connected to ${redact(config.mongoUri)}`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === retries) {
        console.error(`[db] failed to connect after ${retries} attempts: ${msg}`);
        throw err;
      }
      console.warn(`[db] connect attempt ${attempt}/${retries} failed (${msg}); retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function dbState(): string {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown';
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}
