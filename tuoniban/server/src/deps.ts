import type { Clock } from './clock.js';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import type { BlobStore } from './storage/blobs.js';
import type { Db } from './storage/db.js';

/** Everything the app needs from outside, injected so tests can swap the clock and storage. */
export interface AppDeps {
  config: AppConfig;
  db: Db;
  blobs: BlobStore;
  clock: Clock;
  logger: Logger;
}
