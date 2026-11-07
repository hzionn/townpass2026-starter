/**
 * Fixed limits from spec §13.1, kept in one place. The web app never hard-codes these:
 * it reads them from GET /api/services/healthcheck-demo.
 */
export const CLAIM_MINUTES = 10;
export const ACCESS_MINUTES = 60;
export const SESSION_HOURS = 8;

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Vercel rejects bodies over 4.5 MB before they reach our code, so stay well under it. */
export const VERCEL_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const VERCEL_BODY_LIMIT_BYTES = 4_500_000;

export const APPLICANT_SUBJECT_ID = 'applicant-a';
export const HELPER_PUBLIC_LABEL = '代辦者';
export const ATTACHMENT_DISPLAY_NAME = '練習附件 1';
export const SERVICE_NAME = '長者健檢預約需求（模擬）';
export const RECEIPT_MESSAGE = '模擬需求已儲存，尚未送交政府或醫院。';

/** What the applicant agrees to when generating a code (spec §7.1). Recorded on each grant. */
export const GRANT_SCOPES = [
  'draft.read',
  'draft.write',
  'attachment.upload',
  'attachment.delete',
  'demo.submit',
  'receipt.read',
] as const;
