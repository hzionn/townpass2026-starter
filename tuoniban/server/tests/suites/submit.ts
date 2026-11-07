import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { emptyFormData } from '../../../shared/form.js';
import { createGrant, errorCode, openCase, readyCase, redeem, saveDraft, submit, submittedCase, uploadPdf, VALID_FORM } from '../support/flows.js';
import { START, type Harness } from '../support/harness.js';

export function submitSuite(h: Harness): void {
  describe('simulated submission (AT09, §10.6)', () => {
    it('produces one receipt and closes editing', async () => {
      const ready = await readyCase(h);
      const res = await submit(ready.helper, ready.caseId, ready.revision);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          caseId: ready.caseId,
          state: 'submitted',
          revision: ready.revision + 1,
          receipt: {
            receiptNo: 'DEMO-20261107-0001',
            submittedAt: START,
            isDemo: true,
            message: '模擬需求已儲存，尚未送交政府或醫院。',
          },
        },
      });
      expect(await h.count('submissions')).toBe(1);

      const helperView = await ready.helper.get(`/api/cases/${ready.caseId}`);
      expect(helperView.body.data).toMatchObject({
        state: 'submitted',
        canEdit: false,
        revision: ready.revision + 1,
        formData: VALID_FORM,
        receipt: res.body.data.receipt,
      });
      expect(helperView.body.data.attachment.displayName).toBe('練習附件 1');

      const applicantView = await ready.applicant.get(`/api/cases/${ready.caseId}`);
      expect(applicantView.body).toEqual({
        data: {
          caseId: ready.caseId,
          state: 'submitted',
          serviceName: '長者健檢預約需求（模擬）',
          receipt: res.body.data.receipt,
        },
      });
      expect((await ready.applicant.get('/api/my-assistance')).body.data).toMatchObject({
        state: 'completed',
        caseId: ready.caseId,
        receiptNo: 'DEMO-20261107-0001',
      });
    });

    it('requires every field and the attachment', async () => {
      const { helper, caseId } = await openCase(h);
      const empty = await submit(helper, caseId, 1);
      expect(empty.status).toBe(422);
      expect(Object.keys(empty.body.error.fieldErrors).sort()).toEqual(
        [
          'companionRequired',
          'helperName',
          'helperPhone',
          'locationPreference',
          'practice-document',
          'preferredDate',
          'preferredPeriod',
        ].sort(),
      );
      const revision = await saveDraft(helper, caseId, 1);
      const noAttachment = await submit(helper, caseId, revision);
      expect(noAttachment.body.error.fieldErrors).toEqual({ 'practice-document': '請上傳一份練習附件。' });
      const withNotesEmpty = await saveDraft(helper, caseId, revision, { ...VALID_FORM, notes: '' });
      const finalRevision = await uploadPdf(helper, caseId, withNotesEmpty);
      expect((await submit(helper, caseId, finalRevision)).status).toBe(200);
    });

    it('checks the revision before validating', async () => {
      const { helper, caseId } = await openCase(h);
      const res = await submit(helper, caseId, 5);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('VERSION_CONFLICT');
      expect(await h.count('submissions')).toBe(0);
    });

    it('rejects a malformed body and a key that is not a UUID', async () => {
      const ready = await readyCase(h);
      const path = `/api/cases/${ready.caseId}/submit`;
      for (const body of [
        { expectedRevision: ready.revision, idempotencyKey: 'not-a-uuid' },
        { expectedRevision: ready.revision },
        { expectedRevision: ready.revision, idempotencyKey: randomUUID(), state: 'submitted' },
      ]) {
        const res = await ready.helper.post(path, body);
        expect(res.status).toBe(400);
        expect(errorCode(res)).toBe('INVALID_JSON');
      }
      expect(await h.count('submissions')).toBe(0);
    });

    it('is helper only', async () => {
      const ready = await readyCase(h);
      expect((await submit(ready.applicant, ready.caseId, ready.revision)).status).toBe(403);
      const stranger = await h.browser().login('helper');
      expect((await submit(stranger, ready.caseId, ready.revision)).status).toBe(404);
    });
  });

  describe('retries and idempotency (AT10, §10.6)', () => {
    it('replays the identical result for the same key', async () => {
      const done = await submittedCase(h);
      h.clock.advanceMinutes(5);
      const replay = await submit(done.helper, done.caseId, done.revision, done.key);
      expect(replay.status).toBe(200);
      expect(replay.body.data).toEqual(done.result);
      expect(await h.count('submissions')).toBe(1);
    });

    it('accepts the key in a different letter case as the same key', async () => {
      const done = await submittedCase(h);
      const replay = await submit(done.helper, done.caseId, done.revision, done.key.toUpperCase());
      expect(replay.body.data).toEqual(done.result);
    });

    it('answers the same key with a different revision with IDEMPOTENCY_CONFLICT', async () => {
      const done = await submittedCase(h);
      const res = await submit(done.helper, done.caseId, done.revision + 1, done.key);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('answers a different key with ALREADY_SUBMITTED', async () => {
      const done = await submittedCase(h);
      const res = await submit(done.helper, done.caseId, done.revision);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ALREADY_SUBMITTED');
      expect(await h.count('submissions')).toBe(1);
    });

    it('still checks access first on a replay', async () => {
      const done = await submittedCase(h);
      h.clock.advanceMinutes(60);
      expect(errorCode(await submit(done.helper, done.caseId, done.revision, done.key))).toBe('ACCESS_EXPIRED');
      await done.applicant.post(`/api/assistance-grants/${done.grant.grantId}/revoke`, {});
      expect(errorCode(await submit(done.helper, done.caseId, done.revision, done.key))).toBe('ASSISTANCE_REVOKED');
    });

    it('shows the snapshot, not later changes to the case row', async () => {
      const done = await submittedCase(h);
      await h.storage.db.run('UPDATE cases SET form_data = ? WHERE id = ?', [
        JSON.stringify({ ...emptyFormData(), helperName: 'changed underneath' }),
        done.caseId,
      ]);
      await h.storage.db.run('DELETE FROM attachments WHERE case_id = ?', [done.caseId]);
      const view = await done.helper.get(`/api/cases/${done.caseId}`);
      expect(view.body.data.formData).toEqual(VALID_FORM);
      expect(view.body.data.attachment).toMatchObject({ displayName: '練習附件 1', mime: 'application/pdf' });
    });

    it('numbers receipts per Taipei day', async () => {
      h.clock.set('2026-11-07T15:00:00.000Z');
      const first = await submittedCase(h);
      expect(first.result.receipt.receiptNo).toBe('DEMO-20261107-0001');

      const second = await createGrant(first.applicant);
      const helper = await h.browser().login('helper');
      const { caseId } = await redeem(helper, second.token);
      let revision = await saveDraft(helper, caseId, 1, { ...VALID_FORM, preferredDate: '2026-11-09' });
      revision = await uploadPdf(helper, caseId, revision);
      const sameDay = await submit(helper, caseId, revision);
      expect(sameDay.body.data.receipt.receiptNo).toBe('DEMO-20261107-0002');

      // 16:00 UTC is midnight in Taipei: the counter starts again for the new day.
      h.clock.set('2026-11-07T16:00:00.000Z');
      const third = await createGrant(first.applicant);
      const helper3 = await h.browser().login('helper');
      const claimed = await redeem(helper3, third.token);
      let rev3 = await saveDraft(helper3, claimed.caseId, 1, { ...VALID_FORM, preferredDate: '2026-11-09' });
      rev3 = await uploadPdf(helper3, claimed.caseId, rev3);
      const nextDay = await submit(helper3, claimed.caseId, rev3);
      expect(nextDay.body.data.receipt.receiptNo).toBe('DEMO-20261108-0001');
    });
  });
}
