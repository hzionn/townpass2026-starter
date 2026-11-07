import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  CONSENT_VERSION,
  SERVICE_ID,
  type CaseFormData,
  type GrantCreatedResponse,
  type RedeemResponse,
  type SubmitResponse,
} from '../../../shared/contract.js';
import { HEALTHCHECK_SITES } from '../../src/data/healthcheckSites.js';
import type { Browser } from './browser.js';
import type { Harness } from './harness.js';

export const SITE_ID = HEALTHCHECK_SITES[0]!.id;

/** Complete and valid relative to START (tomorrow in Taipei is 2026-11-08). */
export const VALID_FORM: CaseFormData = {
  locationPreference: SITE_ID,
  preferredDate: '2026-11-08',
  preferredPeriod: 'morning',
  companionRequired: false,
  helperName: '小王',
  helperPhone: '0912345678',
  notes: '需要輪椅',
};

export const GRANT_BODY = { serviceId: SERVICE_ID, consentVersion: CONSENT_VERSION };

export async function createGrant(applicant: Browser): Promise<GrantCreatedResponse> {
  const res = await applicant.post('/api/assistance-grants', GRANT_BODY);
  expect(res.status, res.text).toBe(201);
  return res.body.data as GrantCreatedResponse;
}

export async function redeem(helper: Browser, token: string): Promise<RedeemResponse> {
  const res = await helper.post('/api/assistance-grants/redeem', { token });
  expect(res.status, res.text).toBe(200);
  return res.body.data as RedeemResponse;
}

export async function saveDraft(helper: Browser, caseId: string, expectedRevision: number, formData: CaseFormData = VALID_FORM) {
  const res = await helper.patch(`/api/cases/${caseId}/draft`, { expectedRevision, formData });
  expect(res.status, res.text).toBe(200);
  return res.body.data.revision as number;
}

export async function uploadPdf(helper: Browser, caseId: string, expectedRevision: number): Promise<number> {
  const res = await helper.upload(caseId, { expectedRevision });
  expect(res.status, res.text).toBe(201);
  return res.body.data.revision as number;
}

export async function submit(helper: Browser, caseId: string, expectedRevision: number, key: string = randomUUID()) {
  return helper.post(`/api/cases/${caseId}/submit`, { expectedRevision, idempotencyKey: key });
}

/** An applicant, a helper, and a case the helper has just claimed (revision 1). */
export async function openCase(h: Harness) {
  const applicant = await h.browser().login('applicant');
  const helper = await h.browser().login('helper');
  const grant = await createGrant(applicant);
  const claim = await redeem(helper, grant.token);
  return { applicant, helper, grant, caseId: claim.caseId };
}

/** A case with a valid form and attachment, ready to submit. */
export async function readyCase(h: Harness) {
  const opened = await openCase(h);
  let revision = await saveDraft(opened.helper, opened.caseId, 1);
  revision = await uploadPdf(opened.helper, opened.caseId, revision);
  return { ...opened, revision };
}

/** A submitted case. */
export async function submittedCase(h: Harness) {
  const ready = await readyCase(h);
  const key = randomUUID();
  const res = await submit(ready.helper, ready.caseId, ready.revision, key);
  expect(res.status, res.text).toBe(200);
  return { ...ready, key, result: res.body.data as SubmitResponse };
}

export function errorCode(res: { body: { error?: { code?: string } } }): string | undefined {
  return res.body.error?.code;
}
