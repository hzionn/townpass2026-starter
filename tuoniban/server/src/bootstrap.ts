import type { Express } from 'express';
import { createApp } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig, type AppConfig, type LoadConfigOptions } from './config.js';
import { consoleLogger, type Logger } from './logger.js';
import { openStorage } from './storage/open.js';
import type { Db } from './storage/db.js';
import { migrate } from './storage/schema.js';

export interface Bootstrapped {
  app: Express;
  config: AppConfig;
  db: Db;
  logger: Logger;
}

/** Config, storage, migration and app, in that order. */
export async function bootstrap(
  env: Record<string, string | undefined>,
  options: LoadConfigOptions = {},
): Promise<Bootstrapped> {
  const config = loadConfig(env, options);
  const logger = consoleLogger;
  for (const warning of config.warnings) logger.warn('config_warning', { warning });
  const { db, blobs } = await openStorage(config.storage, logger);
  await migrate(db);
  const app = createApp({ config, db, blobs, clock: systemClock, logger });
  return { app, config, db, logger };
}
