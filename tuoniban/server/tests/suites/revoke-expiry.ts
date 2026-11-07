import { describe, expect, it } from 'vitest';
import { errorCode, openCase, readyCase, submit, submittedCase, VALID_FORM } from '../support/flows.js';
import type { Harness } from '../support/harness.js';

export function revokeExpirySuite(h: Harness): void {
  describe('stopping and expiry (AT12, §7.1)', () => {
    it('blocks read, save, upload, delete and submit once the applicant stops', async () => {
      const ready = await readyCase(h);
      const attachmentId = (await ready.helper.get(`/api/cases/${ready.caseId}`)).body.data.attachment.id;
      const stop = await ready.applicant.post(`/api/assistance-grants/${ready.grant.grantId}/revoke`, {});
      expect(stop.status).toBe(200);

      const attempts = [
        await ready.helper.get(`/api/cases/${ready.caseId}`),
        await ready.helper.patch(`/api/cases/${ready.caseId}/draft`, { expectedRevision: ready.revision, formData: VALID_FORM }),
        await ready.helper.upload(ready.caseId, { expectedRevision: ready.revision }),
        await ready.helper.delete(`/api/cases/${ready.caseId}/attachments/${attachmentId}`, { expectedRevision: ready.revision }),
        await submit(ready.helper, ready.caseId, ready.revision),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('ASSISTANCE_REVOKED');
      }
      expect(await h.count('submissions')).toBe(0);
      // The applicant still sees the safe status of their case.
      expect((await ready.applicant.get(`/api/cases/${ready.caseId}`)).status).toBe(200);
    });

    it('does not undo a submission, and closes the helper read', async () => {
      const done = await submittedCase(h);
      await done.applicant.post(`/api/assistance-grants/${done.grant.grantId}/revoke`, {});
      expect(errorCode(await done.helper.get(`/api/cases/${done.caseId}`))).toBe('ASSISTANCE_REVOKED');
      const applicantView = await done.applicant.get(`/api/cases/${done.caseId}`);
      expect(applicantView.body.data).toMatchObject({ state: 'submitted', receipt: done.result.receipt });
      expect((await done.applicant.get('/api/my-assistance')).body.data).toMatchObject({
        state: 'revoked',
        receiptNo: done.result.receipt.receiptNo,
      });
      expect(await h.count('submissions')).toBe(1);
    });

    it('lets the helper read a completed case only until accessExpiresAt', async () => {
      const done = await submittedCase(h);
      h.clock.set('2026-11-07T06:59:59.999Z');
      expect((await done.helper.get(`/api/cases/${done.caseId}`)).status).toBe(200);
      h.clock.set('2026-11-07T07:00:00.000Z');
      const late = await done.helper.get(`/api/cases/${done.caseId}`);
      expect(late.status).toBe(410);
      expect(errorCode(late)).toBe('ACCESS_EXPIRED');
      const applicantView = await done.applicant.get(`/api/cases/${done.caseId}`);
      expect(applicantView.status).toBe(200);
      expect(applicantView.body.data.receipt.receiptNo).toBe(done.result.receipt.receiptNo);
    });

    it('expires an active grant at exactly 60 minutes for every operation', async () => {
      const ready = await readyCase(h);
      h.clock.set('2026-11-07T06:59:59.999Z');
      expect((await ready.helper.get(`/api/cases/${ready.caseId}`)).status).toBe(200);
      h.clock.set('2026-11-07T07:00:00.000Z');
      const attempts = [
        await ready.helper.get(`/api/cases/${ready.caseId}`),
        await ready.helper.patch(`/api/cases/${ready.caseId}/draft`, { expectedRevision: ready.revision, formData: VALID_FORM }),
        await ready.helper.upload(ready.caseId, { expectedRevision: ready.revision }),
        await submit(ready.helper, ready.caseId, ready.revision),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(410);
        expect(errorCode(res)).toBe('ACCESS_EXPIRED');
      }
      expect((await ready.applicant.get('/api/my-assistance')).body.data.state).toBe('expired');
    });

    it('lets a submit at 59:59.999 through', async () => {
      const ready = await readyCase(h);
      h.clock.set('2026-11-07T06:59:59.999Z');
      expect((await submit(ready.helper, ready.caseId, ready.revision)).status).toBe(200);
    });

    it('answers an expired helper session with 401 (AT13)', async () => {
      const { helper, caseId } = await openCase(h);
      h.clock.advanceMinutes(8 * 60);
      const res = await helper.get(`/api/cases/${caseId}`);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('SESSION_REQUIRED');
      expect(errorCode(await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: VALID_FORM }))).toBe(
        'SESSION_REQUIRED',
      );
    });
  });
}
