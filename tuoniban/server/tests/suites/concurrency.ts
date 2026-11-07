import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGrant, errorCode, GRANT_BODY, openCase, readyCase, submit, VALID_FORM } from '../support/flows.js';
import type { Harness } from '../support/harness.js';

/** Real parallel HTTP requests against one app and one database (spec §10.7). */
export function concurrencySuite(h: Harness): void {
  describe('concurrency (§10.7)', () => {
    it('lets exactly one of several helpers claim a code at once', async () => {
      for (let round = 0; round < 3; round += 1) {
        const applicant = await h.browser().login('applicant');
        const mine = (await applicant.get('/api/my-assistance')).body.data;
        if (mine) await applicant.post(`/api/assistance-grants/${mine.grantId}/revoke`, {});
        const grant = await createGrant(applicant);
        const helpers = await Promise.all(Array.from({ length: 5 }, () => h.browser().login('helper')));
        const results = await Promise.all(
          helpers.map((helper) => helper.post('/api/assistance-grants/redeem', { token: grant.token })),
        );
        expect(results.filter((res) => res.status === 200)).toHaveLength(1);
        expect(results.filter((res) => errorCode(res) === 'ALREADY_CLAIMED')).toHaveLength(4);
        expect(await h.count('cases', 'grant_id = ?', [grant.grantId])).toBe(1);
      }
    });

    it('gives the same helper scanning twice at once one case', async () => {
      const applicant = await h.browser().login('applicant');
      const grant = await createGrant(applicant);
      const helper = await h.browser().login('helper');
      const results = await Promise.all(
        [0, 1, 2].map(() => helper.post('/api/assistance-grants/redeem', { token: grant.token })),
      );
      expect(results.every((res) => res.status === 200)).toBe(true);
      expect(new Set(results.map((res) => res.body.data.caseId)).size).toBe(1);
      expect(await h.count('cases')).toBe(1);
    });

    it('creates one receipt for parallel submits with the same key, all with the same answer', async () => {
      const ready = await readyCase(h);
      const key = randomUUID();
      const results = await Promise.all([0, 1, 2, 3].map(() => submit(ready.helper, ready.caseId, ready.revision, key)));
      expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
      expect(new Set(results.map((res) => JSON.stringify(res.body))).size).toBe(1);
      expect(await h.count('submissions')).toBe(1);
    });

    it('creates one receipt for parallel submits with different keys', async () => {
      const ready = await readyCase(h);
      const results = await Promise.all([0, 1, 2, 3].map(() => submit(ready.helper, ready.caseId, ready.revision)));
      expect(results.filter((res) => res.status === 200)).toHaveLength(1);
      expect(results.filter((res) => errorCode(res) === 'ALREADY_SUBMITTED')).toHaveLength(3);
      expect(await h.count('submissions')).toBe(1);
    });

    it('never leaves a half state when submit races revoke', async () => {
      for (let round = 0; round < 8; round += 1) {
        if (round > 0) await h.resetAndStart();
        const ready = await readyCase(h);
        const revokeFirst = round % 2 === 1;
        const revoke = () => ready.applicant.post(`/api/assistance-grants/${ready.grant.grantId}/revoke`, {});
        const send = () => submit(ready.helper, ready.caseId, ready.revision);
        // Alternate which request is sent first, so both orders get exercised.
        const [submitRes, revokeRes] = revokeFirst
          ? await Promise.all([revoke(), send()]).then(([r, s]) => [s, r] as const)
          : await Promise.all([send(), revoke()]);
        expect(revokeRes.status).toBe(200);

        const submissions = await h.count('submissions');
        const row = await h.storage.db.get<{ case_state: string; grant_state: string }>(
          `SELECT c.state AS case_state, g.state AS grant_state
             FROM cases c JOIN assistance_grants g ON g.id = c.grant_id WHERE c.id = ?`,
          [ready.caseId],
        );
        const mine = (await ready.applicant.get('/api/my-assistance')).body.data;
        expect(row?.grant_state).toBe('revoked');
        expect(mine.state).toBe('revoked');
        if (submitRes.status === 200) {
          // Submit won: the receipt stays, revoke only closed access afterwards.
          expect(submissions).toBe(1);
          expect(row?.case_state).toBe('submitted');
          expect(mine.receiptNo).toBe(submitRes.body.data.receipt.receiptNo);
        } else {
          // Revoke won: nothing was submitted.
          expect(submitRes.status).toBe(403);
          expect(errorCode(submitRes)).toBe('ASSISTANCE_REVOKED');
          expect(submissions).toBe(0);
          expect(row?.case_state).toBe('draft');
          expect(mine.receiptNo).toBeNull();
        }
        expect(errorCode(await ready.helper.get(`/api/cases/${ready.caseId}`))).toBe('ASSISTANCE_REVOKED');
      }
    });

    it('accepts one of two saves made from the same revision', async () => {
      const { helper, caseId } = await openCase(h);
      const results = await Promise.all(
        ['甲', '乙', '丙'].map((name) =>
          helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: { ...VALID_FORM, helperName: name } }),
        ),
      );
      expect(results.filter((res) => res.status === 200)).toHaveLength(1);
      expect(results.filter((res) => errorCode(res) === 'VERSION_CONFLICT')).toHaveLength(2);
      expect((await helper.get(`/api/cases/${caseId}`)).body.data.revision).toBe(2);
    });

    it('stores one attachment and one blob for parallel uploads', async () => {
      const { helper, caseId } = await openCase(h);
      const results = await Promise.all([0, 1, 2, 3].map(() => helper.upload(caseId, { expectedRevision: 1 })));
      expect(results.filter((res) => res.status === 201)).toHaveLength(1);
      expect(results.filter((res) => errorCode(res) === 'ATTACHMENT_EXISTS')).toHaveLength(3);
      expect(await h.count('attachments')).toBe(1);
      expect(await h.countBlobs()).toBe(1);
    });

    it('creates one grant for parallel creates', async () => {
      const applicant = await h.browser().login('applicant');
      const results = await Promise.all([0, 1, 2, 3].map(() => applicant.post('/api/assistance-grants', GRANT_BODY)));
      expect(results.filter((res) => res.status === 201)).toHaveLength(1);
      expect(results.filter((res) => errorCode(res) === 'ACTIVE_ASSISTANCE_EXISTS')).toHaveLength(3);
      expect(await h.count('assistance_grants')).toBe(1);
    });
  });
}
