import type { StorageConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { DatabaseBlobStore, FileBlobStore, type BlobStore } from './blobs.js';
import type { Db } from './db.js';

export interface Storage {
  db: Db;
  blobs: BlobStore;
}

/** Each adapter is imported on demand, so a deployment only loads the driver it uses. */
export async function openStorage(config: StorageConfig, logger: Logger): Promise<Storage> {
  if (config.kind === 'postgres') {
    const { openPostgres } = await import('./postgres.js');
    const db = await openPostgres(config.databaseUrl, logger);
    return { db, blobs: new DatabaseBlobStore(db) };
  }
  const { openSqlite } = await import('./sqlite.js');
  const db = await openSqlite(config.databasePath);
  return { db, blobs: await FileBlobStore.open(config.uploadDir) };
}
