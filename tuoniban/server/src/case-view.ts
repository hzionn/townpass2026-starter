import {
  REQUIREMENT_ID,
  SCHEMA_VERSION,
  SERVICE_ID,
  type ApplicantCaseResponse,
  type AttachmentInfo,
  type CaseFormData,
  type ApplicantReview,
  type CaseState,
  type ConfirmationStatus,
  type FieldErrors,
  type GrantState,
  type HelperCaseResponse,
  type Receipt,
} from '../../shared/contract.js';
import { validateForSubmit } from '../../shared/form.js';
import type { AuditContext } from './audit.js';
import { ATTACHMENT_DISPLAY_NAME, RECEIPT_MESSAGE, SERVICE_NAME } from './constants.js';
import { apiError } from './errors.js';
import { assertHelperGrantOpen } from './grant-rules.js';
import { FORM_RULES } from './service-config.js';
import { requirePersona, type SessionRow } from './session.js';
import type { Sql } from './storage/db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every id we issue is a UUID, so anything else cannot exist. Checking this before the
 * query also keeps odd input, such as a NUL byte in the URL, away from the database.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** A case with everything needed to decide access and build a response. */
export interface CaseRow {
  case_id: string;
  case_state: CaseState;
  revision: number;
  schema_version: number;
  form_data: string;
  grant_id: string;
  subject_id: string;
  claimed_helper_id: string | null;
  state: GrantState;
  claim_expires_at: string;
  access_expires_at: string;
  applicant_label: string;
  attachment_id: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_storage_key: string | null;
  receipt_no: string | null;
  submitted_at: string | null;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  snapshot: string | null;
  confirmation_revision: number | null;
  confirmation_decision: 'pending' | 'confirmed' | 'returned' | null;
}

/** Fixed at submit time. Later reads show this, not the case row (spec §10.4). */
export interface SubmissionSnapshot {
  schemaVersion: number;
  formData: CaseFormData;
  attachment: AttachmentInfo;
}

/** One statement, so it is one consistent view of the case on both databases. */
export function loadCaseRow(q: Sql, caseId: string): Promise<CaseRow | undefined> {
  return q.get<CaseRow>(
    `SELECT c.id AS case_id, c.state AS case_state, c.revision, c.schema_version, c.form_data,
            g.id AS grant_id, g.subject_id, g.claimed_helper_id, g.state,
            g.claim_expires_at, g.access_expires_at,
            su.public_label AS applicant_label,
            a.id AS attachment_id, a.mime AS attachment_mime, a.size AS attachment_size,
            a.storage_key AS attachment_storage_key,
            s.receipt_no, s.submitted_at, s.idempotency_key, s.request_fingerprint, s.snapshot,
            cc.revision AS confirmation_revision, cc.decision AS confirmation_decision
       FROM cases c
       JOIN assistance_grants g ON g.id = c.grant_id
       JOIN demo_subjects su ON su.id = g.subject_id
       LEFT JOIN attachments a ON a.case_id = c.id
       LEFT JOIN submissions s ON s.case_id = c.id
       LEFT JOIN case_confirmations cc ON cc.case_id = c.id
      WHERE c.id = ?`,
    [caseId],
  );
}

/**
 * The common check order for helper requests (IMPLEMENTATION.md): persona, then "exists and
 * is yours", then revoked, then expired. Unknown and not-yours get the same 404, so nobody
 * can tell whether a case exists.
 *
 * With `audit`, the case and grant ids are filled in once the case is known to be this
 * helper's, before the revoked and expired checks, so the applicant's activity log can show
 * an attempt after stopping as blocked.
 */
export async function requireHelperCase(
  q: Sql,
  session: SessionRow,
  caseId: string,
  now: Date,
  audit?: AuditContext,
): Promise<CaseRow> {
  requirePersona(session, 'helper');
  const row = isUuid(caseId) ? await loadCaseRow(q, caseId) : undefined;
  if (!row || row.claimed_helper_id === null || row.claimed_helper_id !== session.helper_id) {
    throw apiError('NOT_FOUND');
  }
  if (audit) {
    audit.caseId = row.case_id;
    audit.grantId = row.grant_id;
  }
  assertHelperGrantOpen(row, now);
  return row;
}

export function requireDraft(row: CaseRow): void {
  if (row.case_state === 'submitted') throw apiError('ALREADY_SUBMITTED');
}

export function requireRevision(row: CaseRow, expectedRevision: number): void {
  if (row.revision !== expectedRevision) throw apiError('VERSION_CONFLICT');
}

/**
 * The full submit rules, re-run now: a date that was fine when saved may be today by now.
 * Used before asking the applicant to confirm and again at submit.
 */
export function readinessErrors(row: CaseRow, now: Date): FieldErrors {
  const fieldErrors = validateForSubmit(JSON.parse(row.form_data) as CaseFormData, now, FORM_RULES);
  if (!attachmentInfo(row)) fieldErrors[REQUIREMENT_ID] = '請上傳一份練習附件。';
  return fieldErrors;
}

/** The decision counts only for the revision it was made on; any later change resets it. */
export function confirmationOf(row: CaseRow): ConfirmationStatus {
  if (row.case_state === 'submitted') return 'none';
  return row.confirmation_revision === row.revision && row.confirmation_decision !== null
    ? row.confirmation_decision
    : 'none';
}

/** What the applicant reads before deciding, while there is something to decide or keep. */
export function applicantReviewOf(row: CaseRow): ApplicantReview | null {
  const status = confirmationOf(row);
  if (status !== 'pending' && status !== 'confirmed') return null;
  return {
    revision: row.revision,
    formData: JSON.parse(row.form_data) as CaseFormData,
    attachmentReady: row.attachment_id !== null,
  };
}

export function attachmentInfo(row: CaseRow): AttachmentInfo | null {
  if (row.attachment_id === null || row.attachment_mime === null || row.attachment_size === null) return null;
  return {
    id: row.attachment_id,
    displayName: ATTACHMENT_DISPLAY_NAME,
    mime: row.attachment_mime,
    size: row.attachment_size,
  };
}

export function receiptOf(row: CaseRow): Receipt | null {
  if (row.receipt_no === null || row.submitted_at === null) return null;
  return { receiptNo: row.receipt_no, submittedAt: row.submitted_at, isDemo: true, message: RECEIPT_MESSAGE };
}

/** Built field by field on purpose, so a column can never reach the response by accident. */
export function toHelperCaseResponse(row: CaseRow, now: Date): HelperCaseResponse {
  const snapshot = row.snapshot === null ? null : (JSON.parse(row.snapshot) as SubmissionSnapshot);
  return {
    caseId: row.case_id,
    serviceId: SERVICE_ID,
    schemaVersion: SCHEMA_VERSION,
    state: row.case_state,
    canEdit: row.case_state === 'draft',
    revision: row.revision,
    applicantLabel: row.applicant_label,
    protectedDataStatus: 'ready',
    formData: snapshot ? snapshot.formData : (JSON.parse(row.form_data) as CaseFormData),
    attachment: snapshot ? snapshot.attachment : attachmentInfo(row),
    receipt: receiptOf(row),
    confirmation: confirmationOf(row),
    accessExpiresAt: row.access_expires_at,
    serverNow: now.toISOString(),
  };
}

/** Deliberately not the helper's shape: the applicant sees status, not the form (spec §10.4). */
export function toApplicantCaseResponse(row: CaseRow): ApplicantCaseResponse {
  return {
    caseId: row.case_id,
    state: row.case_state,
    serviceName: SERVICE_NAME,
    receipt: receiptOf(row),
  };
}
