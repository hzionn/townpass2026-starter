import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROTECTED_SEED } from '../../src/seed.js';
import { confirmRevision, createGrant, errorCode, openCase, redeem, saveDraft, submit, VALID_FORM } from '../support/flows.js';
import type { Harness } from '../support/harness.js';

const SECRET_FILENAME = '王大明-real-national-id-A123456789.pdf';

export function privacySuite(h: Harness): void {
  describe('privacy and access control (AT11, §7.3)', () => {
    it('never puts protected values, storage keys, paths, filenames or tokens in responses or logs', async () => {
      // The whole demo flow, with every response body and logger call recorded.
      const applicant = await h.browser().login('applicant');
      const helper = await h.browser().login('helper');
      const grant = await createGrant(applicant);
      await applicant.get('/api/my-assistance');
      const { caseId } = await redeem(helper, grant.token);
      await helper.get('/api/session');
      await helper.get(`/api/cases/${caseId}`);
      let revision = await saveDraft(helper, caseId, 1);
      const upload = await helper.upload(caseId, { expectedRevision: revision, filename: SECRET_FILENAME });
      revision = upload.body.data.revision;
      await helper.upload(caseId, { expectedRevision: revision, filename: SECRET_FILENAME });
      await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: VALID_FORM });
      await confirmRevision(applicant, helper, caseId, revision);
      await applicant.get('/api/my-assistance');
      const submitted = await submit(helper, caseId, revision, randomUUID());
      expect(submitted.status).toBe(200);
      await helper.get(`/api/cases/${caseId}`);
      await applicant.get(`/api/cases/${caseId}`);
      await applicant.get('/api/my-assistance');
      await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      await helper.get(`/api/cases/${caseId}`);
      const stranger = await h.browser().login('helper');
      await stranger.post('/api/assistance-grants/redeem', { token: grant.token });
      await stranger.get(`/api/cases/${caseId}`);

      const storageKeys = (await h.storage.db.all<{ storage_key: string }>('SELECT storage_key FROM attachments')).map(
        (row) => row.storage_key,
      );
      expect(storageKeys).toHaveLength(1);
      const forbidden = [
        ...Object.values(PROTECTED_SEED),
        ...storageKeys,
        SECRET_FILENAME,
        '王大明',
        h.tempDir,
        '/uploads',
        '.data',
        VALID_FORM.helperPhone,
      ];

      const creationResponse = h.responses.find((text) => text.includes(grant.token));
      const otherResponses = h.responses.filter((text) => text !== creationResponse);
      expect(otherResponses.length).toBeGreaterThan(15);
      for (const text of otherResponses) expect(text).not.toContain(grant.token);

      const logText = JSON.stringify(h.logs);
      expect(h.logs.length).toBeGreaterThan(15);
      for (const value of [...forbidden, grant.token, 'tuoniban_session', 'Cookie']) {
        expect(logText).not.toContain(value);
      }
      for (const record of h.logs.filter((log) => log.event === 'request')) {
        expect(Object.keys(record.fields ?? {}).sort()).toEqual(['durationMs', 'method', 'route', 'status']);
        expect(String(record.fields?.route)).not.toContain(caseId);
      }
      for (const text of h.responses) {
        // The helper's own phone number is shown back to the helper only.
        for (const value of forbidden.filter((v) => v !== VALID_FORM.helperPhone)) expect(text).not.toContain(value);
      }

      const audit = JSON.stringify(await h.storage.db.all('SELECT * FROM audit_events'));
      for (const value of [...forbidden, grant.token]) expect(audit).not.toContain(value);
      expect(audit).toContain('ALREADY_CLAIMED');
    });

    it('returns 404 for other helpers and other cases on every case route', async () => {
      const { caseId } = await openCase(h);
      const stranger = await h.browser().login('helper');
      const attempts = [
        await stranger.get(`/api/cases/${caseId}`),
        await stranger.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: VALID_FORM }),
        await stranger.upload(caseId, { expectedRevision: 1 }),
        await stranger.delete(`/api/cases/${caseId}/attachments/${randomUUID()}`, { expectedRevision: 1 }),
        await submit(stranger, caseId, 1),
        await stranger.get(`/api/cases/${randomUUID()}`),
        await stranger.get('/api/cases/..%2F..%2Fetc%2Fpasswd'),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(404);
        expect(errorCode(res)).toBe('NOT_FOUND');
        expect(res.text).not.toContain(caseId);
      }
      expect(await h.count('attachments')).toBe(0);
    });

    it('rejects state, helperId, ownerId and protectedSeed in a draft with 400', async () => {
      const { helper, caseId } = await openCase(h);
      for (const key of ['state', 'helperId', 'ownerId', 'protectedSeed']) {
        const top = await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: VALID_FORM, [key]: 'x' });
        expect(top.status).toBe(400);
        expect(errorCode(top)).toBe('INVALID_JSON');
        const nested = await helper.patch(`/api/cases/${caseId}/draft`, {
          expectedRevision: 1,
          formData: { ...VALID_FORM, [key]: 'x' },
        });
        expect(nested.status).toBe(400);
      }
      const view = await helper.get(`/api/cases/${caseId}`);
      expect(view.body.data).toMatchObject({ state: 'draft', revision: 1 });
    });

    it('treats a NUL byte or broken encoding in an id as not found', async () => {
      const { helper } = await openCase(h);
      expect((await helper.get('/api/cases/abc%00def')).status).toBe(404);
      expect((await helper.get('/api/cases/%E0%A4%A')).status).toBe(404);
      const applicant = await h.browser().login('applicant');
      expect((await applicant.post('/api/assistance-grants/%00/revoke', {})).status).toBe(404);
    });
  });
}
