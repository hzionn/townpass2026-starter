import express, { type Express } from 'express';
import type { AppDeps } from './deps.js';
import { apiError, errorHandler, routeLabel } from './errors.js';
import { deferredJsonBody } from './http/json-body.js';
import { noStore, originCheck, securityHeaders } from './http/security.js';
import { staticSite } from './http/static-site.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import { registerCaseRoutes } from './routes/cases.js';
import { registerConfirmationRoutes } from './routes/confirmation.js';
import { registerGrantRoutes } from './routes/grants.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerSubmitRoutes } from './routes/submit.js';

/**
 * Builds the Express app without listening, so main.ts and the tests run exactly the same code.
 */
export function createApp(deps: AppDeps): Express {
  const { config, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  // API responses are never cached, so ETags would only invite a confusing 304 to a poller.
  app.set('etag', false);
  app.set('trust proxy', config.trustProxy);

  // Method, route pattern, status and duration only (spec §7.3).
  app.use((req, res, next) => {
    const startedAt = performance.now();
    res.once('finish', () => {
      logger.info('request', {
        method: req.method,
        route: routeLabel(req),
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  });
  app.use(securityHeaders);
  app.use('/api', noStore, originCheck(config.publicOrigin, logger), deferredJsonBody);

  registerPublicRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerGrantRoutes(app, deps);
  registerCaseRoutes(app, deps);
  registerAttachmentRoutes(app, deps);
  registerConfirmationRoutes(app, deps);
  registerSubmitRoutes(app, deps);

  app.use('/api', (_req, _res, next) => next(apiError('NOT_FOUND')));
  if (config.staticDir) app.use(staticSite(config.staticDir));
  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use(errorHandler(logger, config.debugErrors));
  return app;
}
