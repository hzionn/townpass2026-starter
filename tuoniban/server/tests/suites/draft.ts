import { describe, expect, it } from 'vitest';
import { emptyFormData } from '../../../shared/form.js';
import { errorCode, openCase, readyCase, saveDraft, submit, submittedCase, VALID_FORM } from '../support/flows.js';
import { START, type Harness } from '../support/harness.js';

export function draftSuite(h: Harness): void {
  describe('reading a draft (§10.4)', () => {
    it('matches the documented helper shape, with nothing protected in it', async () => {
      const { helper, caseId } = await openCase(h);
      const res = await helper.get(`/api/cases/${caseId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          caseId,
          serviceId: 'healthcheck-demo',
          schemaVersion: 1,
          state: 'draft',
          canEdit: true,
          revision: 1,
          applicantLabel: '申請者 A',
          protectedDataStatus: 'ready',
          formData: emptyFormData(),
          attachment: null,
          receipt: null,
          confirmation: 'none',
          accessExpiresAt: '2026-11-07T07:00:00.000Z',
          serverNow: START,
        },
      });
    });

    it('gives the applicant only the safe summary', async () => {
      const { applicant, caseId } = await openCase(h);
      const res = await applicant.get(`/api/cases/${caseId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: { caseId, state: 'draft', serviceName: '長者健檢預約需求（模擬）', receipt: null },
      });
    });
  });

  describe('saving a draft (AT06, §10.4)', () => {
    it('saves a partial draft, increments the revision and survives a reload', async () => {
      const { helper, caseId } = await openCase(h);
      const partial = { ...emptyFormData(), helperName: '  小王  ', preferredPeriod: 'afternoon' as const };
      const res = await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: partial });
      expect(res.status).toBe(200);
      expect(res.body.data.revision).toBe(2);
      expect(res.body.data.canEdit).toBe(true);
      expect(res.body.data.formData).toEqual({ ...emptyFormData(), helperName: '小王', preferredPeriod: 'afternoon' });

      const reloaded = await helper.get(`/api/cases/${caseId}`);
      expect(reloaded.body.data.formData.helperName).toBe('小王');
      expect(reloaded.body.data.revision).toBe(2);

      const third = await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 2, formData: VALID_FORM });
      expect(third.body.data.revision).toBe(3);
      expect(third.body.data.formData).toEqual(VALID_FORM);
    });

    it('keeps companionRequired null as null, never false (AT07)', async () => {
      const { helper, caseId } = await openCase(h);
      await saveDraft(helper, caseId, 1, { ...VALID_FORM, companionRequired: null });
      const reloaded = await helper.get(`/api/cases/${caseId}`);
      expect(reloaded.body.data.formData.companionRequired).toBeNull();

      await helper.upload(caseId, { expectedRevision: 2 });
      // The full rules run as soon as the helper asks the applicant to confirm.
      const res = await helper.post(`/api/cases/${caseId}/request-confirmation`, { expectedRevision: 3 });
      expect(res.status).toBe(422);
      expect(res.body.error.fieldErrors).toEqual({ companionRequired: '請選擇是否需要陪同。' });
    });

    it('marks bad field content with 422 and never echoes the input', async () => {
      const { helper, caseId } = await openCase(h);
      const bad = {
        locationPreference: 'site-not-real',
        preferredDate: '2026-02-30',
        preferredPeriod: 'evening',
        companionRequired: 'yes',
        helperName: 'x'.repeat(31),
        helperPhone: '0212345678',
        notes: 'bad\u0000value',
      };
      const res = await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: bad });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(
        ['companionRequired', 'helperName', 'helperPhone', 'locationPreference', 'notes', 'preferredDate', 'preferredPeriod'].sort(),
      );
      for (const value of ['site-not-real', '2026-02-30', 'evening', '0212345678']) expect(res.text).not.toContain(value);
      expect((await helper.get(`/api/cases/${caseId}`)).body.data.revision).toBe(1);
    });

    it('accepts boundary lengths counted in characters', async () => {
      const { helper, caseId } = await openCase(h);
      const formData = { ...emptyFormData(), helperName: '王'.repeat(30), notes: '😀'.repeat(300) };
      expect((await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData })).status).toBe(200);
      const tooLong = { ...formData, notes: '😀'.repeat(301) };
      expect((await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 2, formData: tooLong })).status).toBe(422);
    });

    it('treats structure problems as 400 INVALID_JSON', async () => {
      const { helper, caseId } = await openCase(h);
      const { notes: _dropped, ...sixFields } = VALID_FORM;
      const bodies: unknown[] = [
        { expectedRevision: 1, formData: sixFields },
        { expectedRevision: 1, formData: { ...VALID_FORM, extra: 1 } },
        { expectedRevision: 1, formData: VALID_FORM, extra: 1 },
        { expectedRevision: '1', formData: VALID_FORM },
        { expectedRevision: 0, formData: VALID_FORM },
        { expectedRevision: 1.5, formData: VALID_FORM },
        { formData: VALID_FORM },
        { expectedRevision: 1, formData: null },
        { expectedRevision: 1, formData: [] },
      ];
      for (const body of bodies) {
        const res = await helper.patch(`/api/cases/${caseId}/draft`, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(errorCode(res)).toBe('INVALID_JSON');
      }
      expect(errorCode(await helper.sendRaw('patch', `/api/cases/${caseId}/draft`, '{"expectedRevision":1,'))).toBe(
        'INVALID_JSON',
      );
      expect(errorCode(await helper.sendRaw('patch', `/api/cases/${caseId}/draft`, '"just a string"'))).toBe('INVALID_JSON');
    });

    it('rejects a body over 64 KB', async () => {
      const { helper, caseId } = await openCase(h);
      const res = await helper.patch(`/api/cases/${caseId}/draft`, {
        expectedRevision: 1,
        formData: { ...VALID_FORM, notes: 'x'.repeat(70 * 1024) },
      });
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('INVALID_JSON');
    });

    it('checks the revision before field content, and never overwrites on conflict (AT13)', async () => {
      const { helper, caseId } = await openCase(h);
      await saveDraft(helper, caseId, 1, { ...VALID_FORM, helperName: '第一個分頁' });
      const stale = await helper.patch(`/api/cases/${caseId}/draft`, {
        expectedRevision: 1,
        formData: { ...VALID_FORM, helperName: '第二個分頁' },
      });
      expect(stale.status).toBe(409);
      expect(errorCode(stale)).toBe('VERSION_CONFLICT');
      const staleAndInvalid = await helper.patch(`/api/cases/${caseId}/draft`, {
        expectedRevision: 1,
        formData: { ...VALID_FORM, preferredDate: '2020-01-01' },
      });
      expect(errorCode(staleAndInvalid)).toBe('VERSION_CONFLICT');
      const current = await helper.get(`/api/cases/${caseId}`);
      expect(current.body.data.formData.helperName).toBe('第一個分頁');
      expect(current.body.data.revision).toBe(2);
    });

    it('follows the documented order: submitted comes before bad JSON and revision', async () => {
      const { helper, caseId } = await submittedCase(h);
      expect(errorCode(await helper.sendRaw('patch', `/api/cases/${caseId}/draft`, '{oops'))).toBe('ALREADY_SUBMITTED');
      const res = await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: VALID_FORM });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ALREADY_SUBMITTED');
    });

    it('rejects an applicant, a stranger and an unknown case before anything else', async () => {
      const { applicant, caseId } = await openCase(h);
      const body = { expectedRevision: 1, formData: VALID_FORM };
      expect((await applicant.patch(`/api/cases/${caseId}/draft`, body)).status).toBe(403);
      const stranger = await h.browser().login('helper');
      expect((await stranger.patch(`/api/cases/${caseId}/draft`, body)).status).toBe(404);
      expect(errorCode(await stranger.sendRaw('patch', `/api/cases/${caseId}/draft`, '{oops'))).toBe('NOT_FOUND');
      expect((await stranger.patch('/api/cases/00000000-0000-4000-8000-000000000000/draft', body)).status).toBe(404);
      expect((await h.browser().patch(`/api/cases/${caseId}/draft`, body)).status).toBe(401);
    });
  });

  describe('dates on the Taipei calendar (AT07)', () => {
    const cases: [string, string, number][] = [
      ['yesterday', '2026-11-06', 422],
      ['today', '2026-11-07', 422],
      ['tomorrow', '2026-11-08', 200],
      ['30 days from now', '2026-12-07', 200],
      ['31 days from now', '2026-12-08', 422],
    ];
    for (const [label, date, status] of cases) {
      it(`saving ${label} (${date}) → ${status}`, async () => {
        const { helper, caseId } = await openCase(h);
        const res = await helper.patch(`/api/cases/${caseId}/draft`, {
          expectedRevision: 1,
          formData: { ...emptyFormData(), preferredDate: date },
        });
        expect(res.status).toBe(status);
        if (status === 422) expect(Object.keys(res.body.error.fieldErrors)).toEqual(['preferredDate']);
      });
    }

    it('re-checks the date at submit, after midnight in Taipei', async () => {
      // Save at 23:50 Taipei on 11-07 with 11-08 (tomorrow), submit at 00:10 on 11-08 (now today).
      h.clock.set('2026-11-07T15:50:00.000Z');
      const ready = await readyCase(h);
      h.clock.set('2026-11-07T16:10:00.000Z');
      const res = await submit(ready.helper, ready.caseId, ready.revision);
      expect(res.status).toBe(422);
      expect(res.body.error.fieldErrors).toEqual({ preferredDate: '請選擇明日起 30 天內的日期。' });
      expect(await h.count('submissions')).toBe(0);
    });
  });
}
