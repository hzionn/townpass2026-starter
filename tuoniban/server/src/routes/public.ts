import type { Express } from 'express';
import type { AppDeps } from '../deps.js';
import { buildServiceConfig } from '../service-config.js';

export function registerPublicRoutes(app: Express, { config, clock }: AppDeps): void {
  /** For deployment checks. Says nothing about the database on purpose. */
  app.get('/api/health', (_req, res) => {
    res.json({ data: { ok: true } });
  });

  /** Public: the fixed form definition, with no applicant values (spec §10.2). */
  app.get('/api/services/healthcheck-demo', (_req, res) => {
    res.json({ data: buildServiceConfig(config, clock.now()) });
  });
}
