import { describe, expect, it } from 'vitest';
import type { ActivityEvent, MyAssistanceResponse } from '../../../shared/contract.js';
import { buildActivity, MAX_ACTIVITY } from '../../src/activity.js';
import { createGrant, errorCode, redeem, saveDraft, submit, uploadPdf, VALID_FORM } from '../support/flows.js';
import type { Browser } from '../support/browser.js';
import { START, type Harness } from '../support/harness.js';

/** Kinds only, oldest first, which reads like the story the test tells. */
function story(activity: ActivityEvent[]): string[] {
  return [...activity].reverse().map((event) => (event.count > 1 ? `${event.kind}×${event.count}` : event.kind));
}

export function activitySuite(h: Harness): void {
  describe('applicant activity log (info.md E05)', () => {
    async function mine(applicant: Browser) {
      return (await applicant.get('/api/my-assistance')).body.data as MyAssistanceResponse;
    }

    it('tells the whole demo story, folding repeats and dropping idempotent retries', async () => {
      const applicant = await h.browser().login('applicant');
      const helper = await h.browser().login('helper');
      const grant = await createGrant(applicant);
      h.clock.advanceMinutes(1);
      const { caseId } = await redeem(helper, grant.token);
      h.clock.advanceMinutes(1);
      await redeem(helper, grant.token); // The same helper scanning again is not a second claim.
      h.clock.advanceMinutes(1);
      let revision = await saveDraft(helper, caseId, 1);
      h.clock.advanceMinutes(1);
      revision = await saveDraft(helper, caseId, revision);
      h.clock.advanceMinutes(1);
      revision = await uploadPdf(helper, caseId, revision);
      h.clock.advanceMinutes(1);
      const key = crypto.randomUUID();
      expect((await submit(helper, caseId, revision, key)).status).toBe(200);
      h.clock.advanceMinutes(1);
      expect((await submit(helper, caseId, revision, key)).status).toBe(200);

      const data = await mine(applicant);
      expect(story(data.activity)).toEqual(['code_issued', 'claimed', 'draft_saved×2', 'attachment_uploaded', 'submitted']);
      expect(data.activity[0]).toEqual({ kind: 'submitted', at: '2026-11-07T06:06:00.000Z', count: 1 });
      expect(data.activity.at(-1)).toEqual({ kind: 'code_issued', at: START, count: 1 });
      // Folded entries carry the time of the latest one.
      expect(data.activity.find((event) => event.kind === 'draft_saved')?.at).toBe('2026-11-07T06:04:00.000Z');
    });

    it('shows a stop, and helper attempts after it as blocked', async () => {
      const applicant = await h.browser().login('applicant');
      const helper = await h.browser().login('helper');
      const grant = await createGrant(applicant);
      const { caseId } = await redeem(helper, grant.token);
      h.clock.advanceMinutes(1);
      expect((await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {})).status).toBe(200);
      h.clock.advanceMinutes(1);
      const save = await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: VALID_FORM });
      expect(errorCode(save)).toBe('ASSISTANCE_REVOKED');
      h.clock.advanceMinutes(1);
      expect(errorCode(await submit(helper, caseId, 1))).toBe('ASSISTANCE_REVOKED');
      h.clock.advanceMinutes(1);
      expect(errorCode(await helper.post('/api/assistance-grants/redeem', { token: grant.token }))).toBe(
        'ASSISTANCE_REVOKED',
      );

      expect(story((await mine(applicant)).activity)).toEqual(['code_issued', 'claimed', 'stopped', 'blocked×3']);
    });

    it('leaves out refusals that are not about this helper being shut out', async () => {
      const applicant = await h.browser().login('applicant');
      const helper = await h.browser().login('helper');
      const stranger = await h.browser().login('helper');
      const grant = await createGrant(applicant);
      const { caseId } = await redeem(helper, grant.token);
      // Someone else's scan reveals nothing, so it must not show up either (§4.2).
      expect(errorCode(await stranger.post('/api/assistance-grants/redeem', { token: grant.token }))).toBe(
        'ALREADY_CLAIMED',
      );
      expect((await stranger.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 1, formData: VALID_FORM })).status).toBe(
        404,
      );
      // A stale revision is an ordinary conflict, not a blocked attempt.
      expect((await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision: 9, formData: VALID_FORM })).status).toBe(
        409,
      );

      expect(story((await mine(applicant)).activity)).toEqual(['code_issued', 'claimed']);
    });

    it('starts afresh for a new code, and carries no ids or values', async () => {
      const applicant = await h.browser().login('applicant');
      const helper = await h.browser().login('helper');
      const first = await createGrant(applicant);
      h.clock.advanceMinutes(1);
      const second = (await applicant.post(`/api/assistance-grants/${first.grantId}/reissue`, {})).body.data;
      expect((await mine(applicant)).activity).toEqual([{ kind: 'code_issued', at: '2026-11-07T06:01:00.000Z', count: 1 }]);

      const { caseId } = await redeem(helper, second.token);
      await saveDraft(helper, caseId, 1);
      const text = (await applicant.get('/api/my-assistance')).text;
      const activityText = JSON.stringify(JSON.parse(text).data.activity);
      for (const value of [caseId, second.grantId, VALID_FORM.helperPhone, VALID_FORM.helperName]) {
        expect(activityText).not.toContain(value);
      }
      // No actor ids: the applicant's subject id, or any UUID such as the helper's id.
      expect(activityText).not.toContain('applicant-a');
      expect(activityText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    });
  });

  describe('buildActivity', () => {
    it('keeps only the newest entries', () => {
      const rows = Array.from({ length: MAX_ACTIVITY * 2 }, (_, i) => ({
        action: i % 2 === 0 ? 'attachment.upload' : 'attachment.delete',
        result: 'ok',
        at: new Date(Date.parse(START) + (i + 1) * 1000).toISOString(),
      }));
      const activity = buildActivity(START, rows);
      expect(activity).toHaveLength(MAX_ACTIVITY);
      expect(activity[0]?.at).toBe(rows.at(-1)?.at);
    });
  });
}
