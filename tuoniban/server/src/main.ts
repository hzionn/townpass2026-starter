import { bootstrap } from './bootstrap.js';
import { ConfigError } from './config.js';
import { safeErrorFields } from './logger.js';

/**
 * Entry point for local runs, Docker and Cloud Run. When running the bundled server
 * (dist-server/main.mjs) it also serves the built web app from dist/web. From source,
 * Vite serves the web app and proxies /api here.
 */
const runningBundle = import.meta.url.endsWith('.mjs');

async function main(): Promise<void> {
  const { app, config, db, logger } = await bootstrap(process.env, {
    defaultStaticDir: runningBundle ? 'dist/web' : null,
  });

  const server = app.listen(config.port, (err?: Error) => {
    if (err) {
      console.error(`Could not listen on port ${config.port}: ${err.message}`);
      process.exit(1);
    }
    logger.info('server_started', {
      port: config.port,
      publicOrigin: config.publicOrigin,
      database: db.describe(),
      servesWebApp: config.staticDir !== null,
    });
  });

  // A stray rejection should be visible, but must not take the demo down.
  process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', safeErrorFields(reason)));

  const shutdown = () => {
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
  } else {
    const { errorName, errorCode } = safeErrorFields(err);
    console.error(`Startup failed: ${errorName}${errorCode ? ` (${errorCode})` : ''}`);
    if (err instanceof Error) console.error(err.message);
  }
  process.exit(1);
});
