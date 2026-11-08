import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/storage/db.js';
import { errorCode, openCase } from '../support/flows.js';
import { TEST_ORIGIN, type Harness } from '../support/harness.js';

export function httpSuite(h: Harness): void {
  describe('HTTP behaviour', () => {
    it('really runs on the adapter named in the suite title', async () => {
      expect(h.storage.db.kind).toBe(h.adapter);
      const version = await h.storage.db.get<{ v: string }>(
        h.adapter === 'postgres' ? 'SELECT version() AS v' : 'SELECT sqlite_version() AS v',
      );
      expect(version?.v).toMatch(h.adapter === 'postgres' ? /^PostgreSQL \d+/ : /^3\.\d+/);
    });

    it('answers the health check without database details', async () => {
      const res = await h.browser().get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { ok: true } });
    });

    it('requires a same-origin request for every write (IMPLEMENTATION.md, CSRF)', async () => {
      const raw = h.browser().agent;
      const body = { persona: 'helper' };
      const missing = await raw.post('/api/demo/session').send(body);
      expect(missing.status).toBe(403);
      expect(errorCode(missing)).toBe('ACTION_FORBIDDEN');
      expect((await raw.post('/api/demo/session').set('Origin', 'https://evil.example').send(body)).status).toBe(403);
      expect((await raw.post('/api/demo/session').set('Origin', 'null').send(body)).status).toBe(403);
      expect((await raw.post('/api/demo/session').set('Origin', `${TEST_ORIGIN}.evil.example`).send(body)).status).toBe(403);
      expect((await raw.post('/api/demo/session').set('Sec-Fetch-Site', 'cross-site').send(body)).status).toBe(403);
      expect((await raw.post('/api/demo/session').set('Sec-Fetch-Site', 'same-origin').send(body)).status).toBe(200);
      expect((await raw.post('/api/demo/session').set('Origin', TEST_ORIGIN).send(body)).status).toBe(200);
      // A wrong Origin wins over a same-origin Sec-Fetch-Site.
      expect(
        (await raw.post('/api/demo/session').set('Origin', 'https://evil.example').set('Sec-Fetch-Site', 'same-origin').send(body))
          .status,
      ).toBe(403);
      // Reads need no Origin.
      expect((await raw.get('/api/services/healthcheck-demo')).status).toBe(200);
    });

    it('checks the origin on PATCH and DELETE too, and before the session', async () => {
      const { helper, caseId } = await openCase(h);
      expect((await helper.agent.patch(`/api/cases/${caseId}/draft`).send({})).status).toBe(403);
      expect((await helper.agent.delete(`/api/cases/${caseId}/attachments/x`).send({})).status).toBe(403);
      expect(errorCode(await h.browser().agent.post('/api/assistance-grants').send({}))).toBe('ACTION_FORBIDDEN');
    });

    it('answers unknown API routes with a JSON 404', async () => {
      for (const res of [
        await h.browser().get('/api/nope'),
        await h.browser().get('/api'),
        await h.browser().post('/api/admin/reset', {}),
        await h.browser().get('/api/services/rehab-bus'),
      ]) {
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: '找不到可存取的資料。' } });
      }
    });

    it('sends no-store and the security headers on every API response, errors included', async () => {
      for (const res of [
        await h.browser().get('/api/health'),
        await h.browser().get('/api/session'),
        await h.browser().get('/api/nope'),
        await h.browser().post('/api/demo/session', { persona: 'x' }),
      ]) {
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['permissions-policy']).toBe('camera=(self), microphone=()');
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers.etag).toBeUndefined();
      }
    });

    it('serves only the API when no web build is configured', async () => {
      const res = await h.browser().get('/assist');
      expect(res.status).toBe(404);
      expect(res.text).toBe('Not found');
    });

    it('rate limits redeem per session, and the window resets', async () => {
      await h.startApp({ config: { rateLimit: { windowMs: 60_000, redeemMax: 3, uploadMax: 100 } } });
      const helper = await h.browser().login('helper');
      const tryRedeem = () => helper.post('/api/assistance-grants/redeem', { token: 'x' });
      for (let i = 0; i < 3; i += 1) expect(errorCode(await tryRedeem())).toBe('INVALID_LINK');
      const limited = await tryRedeem();
      expect(limited.status).toBe(429);
      expect(errorCode(limited)).toBe('RATE_LIMITED');

      // Another phone behind the same venue IP is not affected.
      const other = await h.browser().login('helper');
      expect(errorCode(await other.post('/api/assistance-grants/redeem', { token: 'x' }))).toBe('INVALID_LINK');

      h.clock.advanceMinutes(1);
      expect(errorCode(await tryRedeem())).toBe('INVALID_LINK');
    });

    it('rate limits uploads per session', async () => {
      await h.startApp({ config: { rateLimit: { windowMs: 60_000, redeemMax: 100, uploadMax: 2 } } });
      const { helper, caseId } = await openCase(h);
      expect((await helper.upload(caseId, { expectedRevision: 9 })).status).toBe(409);
      expect((await helper.upload(caseId, { expectedRevision: 9 })).status).toBe(409);
      expect((await helper.upload(caseId, { expectedRevision: 1 })).status).toBe(429);
      expect(await h.countBlobs()).toBe(0);
    });

    it('hides the cause of a 500 from the response and the logs', async () => {
      const leaky = () =>
        Object.assign(new Error('value 0900000001 rejected at /secret/path'), {
          code: '23505',
          detail: 'Key (phone)=(0900000001) already exists.',
        });
      const failing: Db = {
        ...h.storage.db,
        kind: h.storage.db.kind,
        all: async () => {
          throw leaky();
        },
        get: async () => {
          throw leaky();
        },
        run: async () => {
          throw leaky();
        },
        writeTx: async () => {
          throw leaky();
        },
        describe: () => 'failing',
        close: async () => undefined,
      };
      const helper = await h.browser().login('helper');
      await h.startApp({ deps: { db: failing } });

      const failures = [
        await helper.get('/api/session'),
        await helper.post('/api/demo/session', { persona: 'applicant' }),
      ];
      for (const res of failures) {
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: { code: 'TEMPORARY_ERROR', message: '系統暫時無法處理，請再試一次。' } });
        expect(res.text).not.toContain('0900000001');
        expect(res.text).not.toContain('/secret/path');
      }
      // The health check does not touch the database, so it keeps answering.
      expect((await helper.get('/api/health')).status).toBe(200);

      const errors = h.logs.filter((log) => log.event === 'request_failed');
      expect(errors.map((log) => log.fields)).toEqual([
        { method: 'GET', route: '/api/session', errorName: 'Error', errorCode: '23505' },
        { method: 'POST', route: '/api/demo/session', errorName: 'Error', errorCode: '23505' },
      ]);
      const logText = JSON.stringify(h.logs);
      expect(logText).not.toContain('0900000001');
      expect(logText).not.toContain('/secret/path');
    });
  });
}
