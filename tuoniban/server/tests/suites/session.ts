import { describe, expect, it } from 'vitest';
import { FIELD_IDS, type ServiceConfigResponse } from '../../../shared/contract.js';
import { HEALTHCHECK_SITES } from '../../src/data/healthcheckSites.js';
import { PROTECTED_SEED } from '../../src/seed.js';
import { errorCode, openCase } from '../support/flows.js';
import { START, TEST_ORIGIN, type Harness } from '../support/harness.js';

export function sessionSuite(h: Harness): void {
  describe('demo session (AT01, §10.2)', () => {
    it('creates an applicant session with an HttpOnly, SameSite=Lax cookie', async () => {
      const res = await h.browser().post('/api/demo/session', { persona: 'applicant' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { persona: 'applicant', publicLabel: '申請者 A', serverNow: START } });
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^tuoniban_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Max-Age=28800');
      // PUBLIC_ORIGIN in tests is http, so the cookie must not be Secure.
      expect(cookie).not.toContain('Secure');
    });

    it('reports the current session and returns 401 without one', async () => {
      const anonymous = await h.browser().get('/api/session');
      expect(anonymous.status).toBe(401);
      expect(errorCode(anonymous)).toBe('SESSION_REQUIRED');

      const helper = await h.browser().login('helper');
      const res = await helper.get('/api/session');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ persona: 'helper', publicLabel: '代辦者', recentCaseId: null, serverNow: START });
    });

    it('ignores a cookie whose signature does not match', async () => {
      const helper = await h.browser().login('helper');
      const forged = await h.browser().agent.get('/api/session').set('Cookie', 'tuoniban_session=abc.def');
      expect(forged.status).toBe(401);
      const tampered = String(
        (await helper.post('/api/demo/session', { persona: 'helper' })).headers['set-cookie'],
      ).replace(/^tuoniban_session=([^.]+)\.[^;]+;.*/, 'tuoniban_session=$1.AAAA');
      const res = await h.browser().agent.get('/api/session').set('Cookie', tampered);
      expect(res.status).toBe(401);
    });

    it('keeps the helper identity across persona switches in the same browser', async () => {
      const { helper, caseId } = await openCase(h);
      await helper.login('applicant');
      const asApplicant = await helper.get('/api/session');
      expect(asApplicant.body.data.persona).toBe('applicant');
      // recentCaseId follows the browser's helper identity, not the current persona.
      expect(asApplicant.body.data.recentCaseId).toBe(caseId);

      await helper.login('helper');
      const asHelper = await helper.get(`/api/cases/${caseId}`);
      expect(asHelper.status).toBe(200);
      expect(asHelper.body.data.canEdit).toBe(true);
    });

    it('gives a different browser a different helper identity', async () => {
      const { caseId } = await openCase(h);
      const stranger = await h.browser().login('helper');
      expect((await stranger.get('/api/session')).body.data.recentCaseId).toBeNull();
      expect((await stranger.get(`/api/cases/${caseId}`)).status).toBe(404);
    });

    it('drops recentCaseId once the access window closes or the applicant stops', async () => {
      const { helper, applicant, grant } = await openCase(h);
      h.clock.advanceMinutes(59);
      expect((await helper.get('/api/session')).body.data.recentCaseId).not.toBeNull();
      await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      expect((await helper.get('/api/session')).body.data.recentCaseId).toBeNull();
    });

    it('expires a session exactly 8 hours after it was last created (AT13)', async () => {
      const helper = await h.browser().login('helper');
      h.clock.advanceMs(8 * 60 * 60_000 - 1);
      expect((await helper.get('/api/session')).status).toBe(200);
      h.clock.advanceMs(1);
      const expired = await helper.get('/api/session');
      expect(expired.status).toBe(401);
      expect(errorCode(expired)).toBe('SESSION_REQUIRED');
    });

    it('extends the session when it is created again', async () => {
      const helper = await h.browser().login('helper');
      h.clock.advanceMinutes(7 * 60);
      await helper.login('helper');
      h.clock.advanceMinutes(2 * 60);
      expect((await helper.get('/api/session')).status).toBe(200);
    });

    it('starts a fresh helper identity after the old session expired', async () => {
      const { helper, caseId } = await openCase(h);
      h.clock.advanceMinutes(8 * 60);
      await helper.login('helper');
      expect((await helper.get(`/api/cases/${caseId}`)).status).toBe(404);
    });

    it('rejects an unknown persona or extra fields', async () => {
      const b = h.browser();
      expect(errorCode(await b.post('/api/demo/session', { persona: 'government' }))).toBe('INVALID_JSON');
      expect(errorCode(await b.post('/api/demo/session', { persona: 'helper', helperId: 'x' }))).toBe('INVALID_JSON');
      expect(errorCode(await b.post('/api/demo/session', {}))).toBe('INVALID_JSON');
      expect(errorCode(await b.sendRaw('post', '/api/demo/session', '{"persona":'))).toBe('INVALID_JSON');
    });
  });

  describe('service config (AT01, §6, §10.2)', () => {
    it('is public and matches the fixed form', async () => {
      const res = await h.browser().get('/api/services/healthcheck-demo');
      expect(res.status).toBe(200);
      const config = res.body.data as ServiceConfigResponse;
      expect(config).toMatchObject({
        id: 'healthcheck-demo',
        name: '長者健檢預約需求（模擬）',
        schemaVersion: 1,
        isDemo: true,
        mode: 'preference-request',
        consentVersion: 'demo-consent-v1',
        consentText: '產生後，可讓持碼的人協助填寫本次需求、上傳練習附件並模擬送出。不會提供你的身分原值。',
        dataSource: 'demo_seed',
        publicOrigin: TEST_ORIGIN,
        limits: { claimMinutes: 10, accessMinutes: 60, sessionHours: 8 },
        dateRange: { min: '2026-11-08', max: '2026-12-07' },
        serverNow: START,
      });
      expect(config.fields.map((field) => field.id)).toEqual([...FIELD_IDS]);
      expect(config.fields.find((field) => field.id === 'notes')).toEqual({
        id: 'notes',
        label: '其他需求',
        type: 'textarea',
        required: false,
        placeholder: '請勿填入證號或病歷',
        hint: '請勿填入證號或病歷。',
        maxLength: 300,
      });
      expect(config.fields.find((field) => field.id === 'companionRequired')).toEqual({
        id: 'companionRequired',
        label: '需要陪同嗎？',
        type: 'boolean',
        required: true,
      });
      const location = config.fields[0]!;
      expect(location.options).toHaveLength(HEALTHCHECK_SITES.length);
      const site = HEALTHCHECK_SITES[0]!;
      expect(location.options?.[0]).toEqual({
        value: site.id,
        label: site.name,
        group: site.district,
        detail: site.address,
      });
      expect(config.fields[2]?.options).toEqual([
        { value: 'morning', label: '上午' },
        { value: 'afternoon', label: '下午' },
      ]);
      expect(config.attachment).toEqual({
        requirementId: 'practice-document',
        label: '合成練習附件',
        required: true,
        acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
        acceptAttribute: '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        hint: 'PDF / PNG / JPEG，最多 5 MiB。',
        warning: '僅上傳合成練習文件，請勿使用真實證件。',
      });
      expect(config.openDataSources).toEqual([
        {
          datasetName: '臺北市老人健康檢查特約醫事機構',
          provider: '臺北市政府衛生局',
          landingPage: 'https://data.taipei/dataset/detail?id=9a1aefde-2e4a-467c-9ec4-256e33ad6df0',
          licence: '依政府資料開放授權條款-第1版',
          lastChanged: '2026-07-13',
          usage: '偏好地點的選項來自這份公開資料。預約本身是模擬，不會送出真實預約。',
        },
      ]);
      for (const value of Object.values(PROTECTED_SEED)) expect(res.text).not.toContain(value);
    });

    it('reports the effective upload limit in its hint', async () => {
      await h.startApp({ config: { maxUploadBytes: 4 * 1024 * 1024 } });
      const config = (await h.browser().get('/api/services/healthcheck-demo')).body.data as ServiceConfigResponse;
      expect(config.attachment.maxBytes).toBe(4 * 1024 * 1024);
      expect(config.attachment.hint).toBe('PDF / PNG / JPEG，最多 4 MiB。');
    });

    it('moves the date range at Taipei midnight, not UTC midnight', async () => {
      h.clock.set('2026-11-07T15:59:59.999Z');
      expect((await h.browser().get('/api/services/healthcheck-demo')).body.data.dateRange.min).toBe('2026-11-08');
      h.clock.set('2026-11-07T16:00:00.000Z');
      expect((await h.browser().get('/api/services/healthcheck-demo')).body.data.dateRange.min).toBe('2026-11-09');
    });
  });
}
