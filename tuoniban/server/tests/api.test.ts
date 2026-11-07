import { describe } from 'vitest';
import { ADAPTERS, useHarness } from './support/harness.js';
import { activitySuite } from './suites/activity.js';
import { attachmentSuite } from './suites/attachments.js';
import { concurrencySuite } from './suites/concurrency.js';
import { draftSuite } from './suites/draft.js';
import { grantSuite } from './suites/grants.js';
import { httpSuite } from './suites/http.js';
import { privacySuite } from './suites/privacy.js';
import { redeemSuite } from './suites/redeem.js';
import { revokeExpirySuite } from './suites/revoke-expiry.js';
import { sessionSuite } from './suites/session.js';
import { submitSuite } from './suites/submit.js';

/**
 * The whole API suite, once on SQLite and once on a real Postgres. Both adapters must
 * behave identically, because deployments pick one by whether DATABASE_URL is set.
 */
describe.each(ADAPTERS)('API on %s', (adapter) => {
  const h = useHarness(adapter);
  sessionSuite(h);
  grantSuite(h);
  redeemSuite(h);
  draftSuite(h);
  attachmentSuite(h);
  submitSuite(h);
  privacySuite(h);
  revokeExpirySuite(h);
  concurrencySuite(h);
  httpSuite(h);
  activitySuite(h);
});
