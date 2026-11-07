import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TOKEN_PATTERN } from '../../../shared/assistLink.js';
import type { MyAssistanceResponse } from '../../../shared/contract.js';
import { createGrant, errorCode, GRANT_BODY, openCase, redeem, submittedCase } from '../support/flows.js';
import { START, type Harness } from '../support/harness.js';

export function grantSuite(h: Harness): void {
  describe('issuing codes (AT02, §10.3)', () => {
    it('returns the token once, at creation, with 10 and 60 minute limits', async () => {
      const applicant = await h.browser().login('applicant');
      const res = await applicant.post('/api/assistance-grants', GRANT_BODY);
      expect(res.status).toBe(201);
      const grant = res.body.data;
      expect(Object.keys(grant).sort()).toEqual(
        ['accessExpiresAt', 'claimExpiresAt', 'grantId', 'serverNow', 'state', 'token'].sort(),
      );
      expect(grant).toMatchObject({
        state: 'issued',
        claimExpiresAt: '2026-11-07T06:10:00.000Z',
        accessExpiresAt: '2026-11-07T07:00:00.000Z',
        serverNow: START,
      });
      expect(grant.token).toMatch(TOKEN_PATTERN);

      // Only the hash is stored.
      const stored = await h.storage.db.get<{ token_hash: string; consent_version: string; scopes: string }>(
        'SELECT token_hash, consent_version, scopes FROM assistance_grants WHERE id = ?',
        [grant.grantId],
      );
      expect(stored?.token_hash).toBe(createHash('sha256').update(grant.token).digest('hex'));
      expect(stored?.consent_version).toBe('demo-consent-v1');
      expect(JSON.parse(stored?.scopes ?? '[]')).toContain('demo.submit');

      // No GET ever returns it again.
      const reads = [
        await applicant.get('/api/my-assistance'),
        await applicant.get('/api/session'),
        await applicant.get('/api/services/healthcheck-demo'),
      ];
      for (const read of reads) expect(read.text).not.toContain(grant.token);
      const mine = reads[0]!.body.data as MyAssistanceResponse;
      expect(mine).toEqual({
        grantId: grant.grantId,
        state: 'issued',
        claimExpiresAt: grant.claimExpiresAt,
        accessExpiresAt: grant.accessExpiresAt,
        caseId: null,
        receiptNo: null,
        activity: [{ kind: 'code_issued', at: START, count: 1 }],
        serverNow: START,
      });
    });

    it('is applicant only, and needs a session', async () => {
      expect((await h.browser().post('/api/assistance-grants', GRANT_BODY)).status).toBe(401);
      const helper = await h.browser().login('helper');
      const res = await helper.post('/api/assistance-grants', GRANT_BODY);
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('ACTION_FORBIDDEN');
      expect((await helper.get('/api/my-assistance')).status).toBe(403);
    });

    it('rejects a wrong service, consent version or extra fields', async () => {
      const applicant = await h.browser().login('applicant');
      for (const body of [
        { ...GRANT_BODY, serviceId: 'rehab-bus' },
        { ...GRANT_BODY, consentVersion: 'demo-consent-v0' },
        { ...GRANT_BODY, ownerId: 'applicant-b' },
        { serviceId: GRANT_BODY.serviceId },
      ]) {
        const res = await applicant.post('/api/assistance-grants', body);
        expect(res.status).toBe(400);
        expect(errorCode(res)).toBe('INVALID_JSON');
      }
      expect(await h.count('assistance_grants')).toBe(0);
    });

    it('returns my-assistance null before any grant exists', async () => {
      const applicant = await h.browser().login('applicant');
      const res = await applicant.get('/api/my-assistance');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: null });
    });

    it('refuses a second open grant with ACTIVE_ASSISTANCE_EXISTS', async () => {
      const { applicant } = await openCase(h);
      const whileActive = await applicant.post('/api/assistance-grants', GRANT_BODY);
      expect(whileActive.status).toBe(409);
      expect(errorCode(whileActive)).toBe('ACTIVE_ASSISTANCE_EXISTS');

      const other = await h.browser().login('applicant');
      await other.post(`/api/assistance-grants/${(await other.get('/api/my-assistance')).body.data.grantId}/revoke`, {});
      await createGrant(other);
      const whileIssued = await other.post('/api/assistance-grants', GRANT_BODY);
      expect(errorCode(whileIssued)).toBe('ACTIVE_ASSISTANCE_EXISTS');
    });

    it('allows a new grant once the unclaimed one has expired', async () => {
      const applicant = await h.browser().login('applicant');
      const first = await createGrant(applicant);
      h.clock.advanceMs(10 * 60_000 - 1);
      expect(errorCode(await applicant.post('/api/assistance-grants', GRANT_BODY))).toBe('ACTIVE_ASSISTANCE_EXISTS');
      h.clock.advanceMs(1);
      expect((await applicant.get('/api/my-assistance')).body.data.state).toBe('expired');
      const second = await createGrant(applicant);
      expect(second.grantId).not.toBe(first.grantId);
      const old = await h.storage.db.get<{ state: string }>('SELECT state FROM assistance_grants WHERE id = ?', [
        first.grantId,
      ]);
      expect(old?.state).toBe('expired');
      expect((await applicant.get('/api/my-assistance')).body.data.grantId).toBe(second.grantId);
    });

    it('allows a new grant after the claimed one expires, is revoked, or completes', async () => {
      const opened = await openCase(h);
      h.clock.advanceMinutes(60);
      const afterExpiry = await createGrant(opened.applicant);

      const helper = await h.browser().login('helper');
      await redeem(helper, afterExpiry.token);
      await opened.applicant.post(`/api/assistance-grants/${afterExpiry.grantId}/revoke`, {});
      const afterRevoke = await createGrant(opened.applicant);
      expect(afterRevoke.state).toBe('issued');

      await opened.applicant.post(`/api/assistance-grants/${afterRevoke.grantId}/revoke`, {});
      const done = await submittedCase(h);
      expect((await createGrant(done.applicant)).state).toBe('issued');
    });
  });

  describe('reissue (AT02, AT05, §10.3)', () => {
    it('invalidates the old code and returns a new one', async () => {
      const applicant = await h.browser().login('applicant');
      const old = await createGrant(applicant);
      h.clock.advanceMinutes(3);
      const res = await applicant.post(`/api/assistance-grants/${old.grantId}/reissue`, {});
      expect(res.status).toBe(201);
      const fresh = res.body.data;
      expect(fresh.grantId).not.toBe(old.grantId);
      expect(fresh.token).not.toBe(old.token);
      expect(fresh.token).toMatch(TOKEN_PATTERN);
      expect(fresh.claimExpiresAt).toBe('2026-11-07T06:13:00.000Z');

      const helper = await h.browser().login('helper');
      const withOld = await helper.post('/api/assistance-grants/redeem', { token: old.token });
      expect(withOld.status).toBe(400);
      expect(errorCode(withOld)).toBe('INVALID_LINK');
      expect((await redeem(helper, fresh.token)).grantId).toBe(fresh.grantId);
      expect((await applicant.get('/api/my-assistance')).body.data.grantId).toBe(fresh.grantId);
    });

    it('only works on an issued grant that has not expired', async () => {
      const opened = await openCase(h);
      const active = await opened.applicant.post(`/api/assistance-grants/${opened.grant.grantId}/reissue`, {});
      expect(active.status).toBe(409);
      expect(errorCode(active)).toBe('ACTIVE_ASSISTANCE_EXISTS');

      await opened.applicant.post(`/api/assistance-grants/${opened.grant.grantId}/revoke`, {});
      const revoked = await opened.applicant.post(`/api/assistance-grants/${opened.grant.grantId}/reissue`, {});
      expect(errorCode(revoked)).toBe('ASSISTANCE_REVOKED');

      const unclaimed = await createGrant(opened.applicant);
      h.clock.advanceMinutes(10);
      const expired = await opened.applicant.post(`/api/assistance-grants/${unclaimed.grantId}/reissue`, {});
      expect(expired.status).toBe(410);
      expect(errorCode(expired)).toBe('INVITATION_EXPIRED');
    });

    it('refuses a completed grant, an unknown id and a helper', async () => {
      const done = await submittedCase(h);
      expect(errorCode(await done.applicant.post(`/api/assistance-grants/${done.grant.grantId}/reissue`, {}))).toBe(
        'ALREADY_SUBMITTED',
      );
      expect((await done.applicant.post('/api/assistance-grants/00000000-0000-4000-8000-000000000000/reissue', {})).status).toBe(404);
      expect((await done.applicant.post('/api/assistance-grants/not-a-uuid/reissue', {})).status).toBe(404);
      expect((await done.helper.post(`/api/assistance-grants/${done.grant.grantId}/reissue`, {})).status).toBe(403);
    });
  });

  describe('revoke (§10.3)', () => {
    it('can be repeated and keeps the first revokedAt', async () => {
      const { applicant, grant } = await openCase(h);
      const first = await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({ grantId: grant.grantId, state: 'revoked', serverNow: START });
      h.clock.advanceMinutes(1);
      const again = await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      expect(again.status).toBe(200);
      expect(again.body.data.state).toBe('revoked');
      const row = await h.storage.db.get<{ revoked_at: string }>('SELECT revoked_at FROM assistance_grants WHERE id = ?', [
        grant.grantId,
      ]);
      expect(row?.revoked_at).toBe(START);
      expect((await applicant.get('/api/my-assistance')).body.data.state).toBe('revoked');
    });

    it('works on an expired grant too', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      h.clock.advanceMinutes(30);
      expect((await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {})).status).toBe(200);
      expect((await applicant.get('/api/my-assistance')).body.data.state).toBe('revoked');
    });

    it('is owner only', async () => {
      const { helper, grant } = await openCase(h);
      expect((await helper.post(`/api/assistance-grants/${grant.grantId}/revoke`, {})).status).toBe(403);
      const applicant = await h.browser().login('applicant');
      expect((await applicant.post('/api/assistance-grants/00000000-0000-4000-8000-000000000000/revoke', {})).status).toBe(404);
      expect((await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, { reason: 'x' })).status).toBe(400);
    });
  });

  describe('my-assistance state over time (§7.1)', () => {
    it('derives expiry from the clock at the exact boundary', async () => {
      const applicant = await h.browser().login('applicant');
      await createGrant(applicant);
      h.clock.set('2026-11-07T06:09:59.999Z');
      expect((await applicant.get('/api/my-assistance')).body.data.state).toBe('issued');
      h.clock.set('2026-11-07T06:10:00.000Z');
      expect((await applicant.get('/api/my-assistance')).body.data.state).toBe('expired');
    });

    it('shows active, then expired after 60 minutes, with the case id', async () => {
      const { applicant, caseId } = await openCase(h);
      const active = (await applicant.get('/api/my-assistance')).body.data;
      expect(active).toMatchObject({ state: 'active', caseId, receiptNo: null });
      h.clock.set('2026-11-07T06:59:59.999Z');
      expect((await applicant.get('/api/my-assistance')).body.data.state).toBe('active');
      h.clock.set('2026-11-07T07:00:00.000Z');
      expect((await applicant.get('/api/my-assistance')).body.data.state).toBe('expired');
    });

    it('keeps completed and the receipt number after the access window', async () => {
      const done = await submittedCase(h);
      h.clock.advanceMinutes(120);
      const mine = (await done.applicant.get('/api/my-assistance')).body.data;
      expect(mine).toMatchObject({ state: 'completed', caseId: done.caseId, receiptNo: done.result.receipt.receiptNo });
    });
  });
}
