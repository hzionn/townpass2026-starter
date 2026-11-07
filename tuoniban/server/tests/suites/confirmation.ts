import { describe, expect, it } from 'vitest';
import type { MyAssistanceResponse } from '../../../shared/contract.js';
import { PROTECTED_SEED } from '../../src/seed.js';
import type { Browser } from '../support/browser.js';
import { errorCode, filledCase, saveDraft, submittedCase, VALID_FORM } from '../support/flows.js';
import type { Harness } from '../support/harness.js';

const ask = (helper: Browser, caseId: string, expectedRevision: number) =>
  helper.post(`/api/cases/${caseId}/request-confirmation`, { expectedRevision });
const confirm = (applicant: Browser, caseId: string, expectedRevision: number) =>
  applicant.post(`/api/cases/${caseId}/confirm`, { expectedRevision });
const sendBack = (applicant: Browser, caseId: string, expectedRevision: number) =>
  applicant.post(`/api/cases/${caseId}/return`, { expectedRevision });

async function mine(applicant: Browser): Promise<MyAssistanceResponse> {
  return (await applicant.get('/api/my-assistance')).body.data as MyAssistanceResponse;
}

export function confirmationSuite(h: Harness): void {
  describe('applicant confirmation before submit (info.md F09, E03)', () => {
    it('shows the applicant what to confirm, and only while it is pending or confirmed', async () => {
      const { applicant, helper, caseId, revision } = await filledCase(h);
      expect(await mine(applicant)).toMatchObject({ confirmation: 'none', review: null });

      expect((await ask(helper, caseId, revision)).status).toBe(200);
      const pending = await mine(applicant);
      expect(pending.confirmation).toBe('pending');
      expect(pending.review).toEqual({ revision, formData: VALID_FORM, attachmentReady: true });
      const text = JSON.stringify(pending);
      for (const value of Object.values(PROTECTED_SEED)) expect(text).not.toContain(value);

      expect((await confirm(applicant, caseId, revision)).status).toBe(200);
      expect(await mine(applicant)).toMatchObject({ confirmation: 'confirmed', review: { revision } });
      expect((await helper.get(`/api/cases/${caseId}`)).body.data.confirmation).toBe('confirmed');
    });

    it('lets the applicant send it back, and the helper ask again', async () => {
      const { applicant, helper, caseId, revision } = await filledCase(h);
      await ask(helper, caseId, revision);
      const back = await sendBack(applicant, caseId, revision);
      expect(back.status).toBe(200);
      expect(back.body.data).toMatchObject({ confirmation: 'returned', revision });
      expect(await mine(applicant)).toMatchObject({ confirmation: 'returned', review: null });
      expect((await helper.get(`/api/cases/${caseId}`)).body.data.confirmation).toBe('returned');
      // A returned revision cannot be confirmed afterwards: the helper has to ask again.
      expect(errorCode(await confirm(applicant, caseId, revision))).toBe('VERSION_CONFLICT');

      const changed = await saveDraft(helper, caseId, revision, { ...VALID_FORM, notes: '改成下午也可以' });
      expect((await ask(helper, caseId, changed)).body.data.confirmation).toBe('pending');
      expect((await confirm(applicant, caseId, changed)).status).toBe(200);
    });

    it('refuses a decision on a stale or never-requested revision, and repeats the same answer', async () => {
      const { applicant, helper, caseId, revision } = await filledCase(h);
      expect(errorCode(await confirm(applicant, caseId, revision))).toBe('VERSION_CONFLICT');

      await ask(helper, caseId, revision);
      // The helper edits while the applicant is reading: the old page must not confirm the new draft.
      const changed = await saveDraft(helper, caseId, revision, { ...VALID_FORM, notes: '偷改' });
      expect(errorCode(await confirm(applicant, caseId, revision))).toBe('VERSION_CONFLICT');
      expect(errorCode(await confirm(applicant, caseId, changed))).toBe('VERSION_CONFLICT');

      await ask(helper, caseId, changed);
      expect((await confirm(applicant, caseId, changed)).status).toBe(200);
      // Pressing again, e.g. after a lost response, gives the same answer.
      expect((await confirm(applicant, caseId, changed)).status).toBe(200);
      expect(errorCode(await sendBack(applicant, caseId, changed))).toBe('VERSION_CONFLICT');
    });

    it('keeps each side to its own action', async () => {
      const { applicant, helper, caseId, revision } = await filledCase(h);
      expect(errorCode(await ask(applicant, caseId, revision))).toBe('ACTION_FORBIDDEN');
      await ask(helper, caseId, revision);
      expect(errorCode(await confirm(helper, caseId, revision))).toBe('ACTION_FORBIDDEN');
      expect(errorCode(await sendBack(helper, caseId, revision))).toBe('ACTION_FORBIDDEN');
      expect((await h.browser().post(`/api/cases/${caseId}/confirm`, { expectedRevision: revision })).status).toBe(401);
      expect(errorCode(await confirm(applicant, crypto.randomUUID(), revision))).toBe('NOT_FOUND');
      // Structure is checked like every other body: no extra keys.
      const extra = await applicant.post(`/api/cases/${caseId}/confirm`, { expectedRevision: revision, state: 'x' });
      expect(errorCode(extra)).toBe('INVALID_JSON');
    });

    it('stops once the applicant stops assistance or it expires', async () => {
      const stopped = await filledCase(h);
      await ask(stopped.helper, stopped.caseId, stopped.revision);
      await stopped.applicant.post(`/api/assistance-grants/${stopped.grant.grantId}/revoke`, {});
      expect(errorCode(await confirm(stopped.applicant, stopped.caseId, stopped.revision))).toBe('ASSISTANCE_REVOKED');
      expect(errorCode(await ask(stopped.helper, stopped.caseId, stopped.revision))).toBe('ASSISTANCE_REVOKED');

      h.clock.advanceMinutes(5);
      const expiring = await filledCase(h);
      await ask(expiring.helper, expiring.caseId, expiring.revision);
      h.clock.advanceMinutes(61);
      expect(errorCode(await confirm(expiring.applicant, expiring.caseId, expiring.revision))).toBe('ACCESS_EXPIRED');
    });

    it('is closed after submit', async () => {
      const done = await submittedCase(h);
      expect(errorCode(await ask(done.helper, done.caseId, done.result.revision))).toBe('ALREADY_SUBMITTED');
      expect(errorCode(await confirm(done.applicant, done.caseId, done.result.revision))).toBe('ALREADY_SUBMITTED');
      expect(await mine(done.applicant)).toMatchObject({ state: 'completed', confirmation: 'none', review: null });
    });
  });
}
