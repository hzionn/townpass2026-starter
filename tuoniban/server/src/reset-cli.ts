import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadStorageConfig } from './config.js';
import { consoleLogger } from './logger.js';
import { assertSafeUploadDir, resetDemoData } from './reset.js';
import { openStorage } from './storage/open.js';
import { migrate } from './storage/schema.js';

/**
 * `npm run demo:reset`: developer-only, and deliberately not an HTTP endpoint (spec §9).
 * Run it before each demo. It reads the same DATABASE_URL / DATABASE_PATH as the server.
 */
async function main(): Promise<void> {
  const storage = loadStorageConfig(process.env);
  if (storage.kind === 'sqlite') {
    const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
    assertSafeUploadDir(storage.uploadDir, { home: homedir(), projectRoot });
  }
  const { db, blobs } = await openStorage(storage, consoleLogger);
  try {
    console.log(`Resetting demo data in ${db.describe()}`);
    await migrate(db);
    await resetDemoData(db, blobs);
    console.log('Done: all tables cleared, applicant-a seeded, stored attachments removed.');
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Reset failed.');
  process.exit(1);
});
