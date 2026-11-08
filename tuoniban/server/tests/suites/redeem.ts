import { describe, expect, it } from 'vitest';
import { createGrant, errorCode, openCase, redeem, submittedCase } from '../support/flows.js';
import type { Harness } from '../support/harness.js';

export function redeemSuite(h: Harness): void {
  describe('claiming a code (AT03, AT04, §10.3)', () => {
    it('binds the helper and creates exactly one draft at revision 1', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      const helper = await h.browser().login('helper');
      const res = await helper.post('/api/assistance-grants/redeem', { token: grant.token });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data).sort()).toEqual(['accessExpiresAt', 'caseId', 'grantId', 'serverNow', 'state']);
      expect(res.body.data).toMatchObject({ grantId: grant.grantId, state: 'active', accessExpiresAt: grant.accessExpiresAt });
      expect(await h.count('cases')).toBe(1);

      const caseRes = await helper.get(`/api/cases/${res.body.data.caseId}`);
      expect(caseRes.body.data.revision).toBe(1);
      expect((await applicant.get('/api/my-assistance')).body.data).toMatchObject({
        state: 'active',
        caseId: res.body.data.caseId,
      });
    });

    it('returns the same case when the same helper scans again, even after 10 minutes', async () => {
      const { helper, grant, caseId } = await openCase(h);
      expect((await redeem(helper, grant.token)).caseId).toBe(caseId);
      h.clock.advanceMinutes(45);
      expect((await redeem(helper, grant.token)).caseId).toBe(caseId);
      expect(await h.count('cases')).toBe(1);
    });

    it('refuses another helper with ALREADY_CLAIMED and no case data', async () => {
      const { grant, caseId } = await openCase(h);
      const other = await h.browser().login('helper');
      const res = await other.post('/api/assistance-grants/redeem', { token: grant.token });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ALREADY_CLAIMED');
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.text).not.toContain(caseId);
      expect(res.text).not.toContain(grant.grantId);
      expect(await h.count('cases')).toBe(1);
    });

    it('returns state completed when the same helper scans after submitting', async () => {
      const done = await submittedCase(h);
      const again = await redeem(done.helper, done.grant.token);
      expect(again).toMatchObject({ caseId: done.caseId, state: 'completed' });
    });
  });

  describe('the redeem table in IMPLEMENTATION.md (AT05)', () => {
    async function expectRedeem(token: unknown, status: number, code: string, who?: Awaited<ReturnType<typeof openCase>>['helper']) {
      const helper = who ?? (await h.browser().login('helper'));
      const res = await helper.post('/api/assistance-grants/redeem', { token });
      expect(res.status, res.text).toBe(status);
      expect(errorCode(res)).toBe(code);
    }

    it('not a helper → 403 ACTION_FORBIDDEN, checked before the body', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      const res = await applicant.post('/api/assistance-grants/redeem', { token: grant.token });
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('ACTION_FORBIDDEN');
      expect(errorCode(await applicant.sendRaw('post', '/api/assistance-grants/redeem', '{oops'))).toBe('ACTION_FORBIDDEN');
      expect(errorCode(await h.browser().post('/api/assistance-grants/redeem', { token: grant.token }))).toBe(
        'SESSION_REQUIRED',
      );
    });

    it('malformed or unknown token → 400 INVALID_LINK', async () => {
      for (const token of ['', 'short', 'a'.repeat(44), 'a'.repeat(42) + '!', 123, null, ['x'], 'A'.repeat(43)]) {
        await expectRedeem(token, 400, 'INVALID_LINK');
      }
      expect(await h.count('cases')).toBe(0);
    });

    it('missing or extra body fields → 400 INVALID_JSON', async () => {
      const helper = await h.browser().login('helper');
      expect(errorCode(await helper.post('/api/assistance-grants/redeem', {}))).toBe('INVALID_JSON');
      expect(errorCode(await helper.post('/api/assistance-grants/redeem', { token: 'x', helperId: 'y' }))).toBe('INVALID_JSON');
      expect(errorCode(await helper.sendRaw('post', '/api/assistance-grants/redeem', '{"token":'))).toBe('INVALID_JSON');
    });

    it('unclaimed and revoked → 400 INVALID_LINK', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      await expectRedeem(grant.token, 400, 'INVALID_LINK');
    });

    it('unclaimed and replaced by reissue → 400 INVALID_LINK', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      await applicant.post(`/api/assistance-grants/${grant.grantId}/reissue`, {});
      await expectRedeem(grant.token, 400, 'INVALID_LINK');
    });

    it('unclaimed and past 10 minutes → 410 INVITATION_EXPIRED, at the exact boundary', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      h.clock.advanceMs(10 * 60_000);
      await expectRedeem(grant.token, 410, 'INVITATION_EXPIRED');
      expect(await h.count('cases')).toBe(0);
    });

    it('one millisecond before the claim limit still works', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      h.clock.advanceMs(10 * 60_000 - 1);
      const helper = await h.browser().login('helper');
      expect((await redeem(helper, grant.token)).state).toBe('active');
    });

    it('claimed by someone else → 409 ALREADY_CLAIMED, whatever the state', async () => {
      const { applicant, grant } = await openCase(h);
      await expectRedeem(grant.token, 409, 'ALREADY_CLAIMED');
      h.clock.advanceMinutes(61);
      await expectRedeem(grant.token, 409, 'ALREADY_CLAIMED');
      await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      await expectRedeem(grant.token, 409, 'ALREADY_CLAIMED');
    });

    it('own claim, applicant stopped → 403 ASSISTANCE_REVOKED', async () => {
      const { applicant, helper, grant } = await openCase(h);
      await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      await expectRedeem(grant.token, 403, 'ASSISTANCE_REVOKED', helper);
    });

    it('own claim, past 60 minutes → 410 ACCESS_EXPIRED, at the exact boundary', async () => {
      const { helper, grant } = await openCase(h);
      h.clock.advanceMs(60 * 60_000 - 1);
      expect((await redeem(helper, grant.token)).state).toBe('active');
      h.clock.advanceMs(1);
      await expectRedeem(grant.token, 410, 'ACCESS_EXPIRED', helper);
    });

    it('own completed claim after the access window → 410 ACCESS_EXPIRED', async () => {
      const done = await submittedCase(h);
      h.clock.advanceMinutes(60);
      await expectRedeem(done.grant.token, 410, 'ACCESS_EXPIRED', done.helper);
    });

    it('own completed claim that was then revoked → 403 ASSISTANCE_REVOKED', async () => {
      const done = await submittedCase(h);
      await done.applicant.post(`/api/assistance-grants/${done.grant.grantId}/revoke`, {});
      await expectRedeem(done.grant.token, 403, 'ASSISTANCE_REVOKED', done.helper);
    });
  });
}
