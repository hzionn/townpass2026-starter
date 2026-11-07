/**
 * API contract shared by the server and the web app (spec v1.3 §10).
 *
 * Time and size limits deliberately live on the server (spec §13.1): the web app
 * reads them from GET /api/services/healthcheck-demo instead of hard-coding them.
 */

export const SERVICE_ID = 'healthcheck-demo';
export const SCHEMA_VERSION = 1;
export const CONSENT_VERSION = 'demo-consent-v1';
export const REQUIREMENT_ID = 'practice-document';

export type Persona = 'applicant' | 'helper';

/** Stored grant states, plus `expired` which the server may also derive from the clock. */
export type GrantState = 'issued' | 'active' | 'completed' | 'revoked' | 'expired';

/** `review`, `saving`, `submitting` and `result_unknown` are front-end states only (spec §7.2). */
export type CaseState = 'draft' | 'submitted';

/**
 * The applicant's say on the case's current revision (info.md F09, E03). Any change to the
 * draft moves the revision on, so an earlier request or decision falls back to `none`.
 * Only `confirmed` lets the helper submit.
 */
export type ConfirmationStatus = 'none' | 'pending' | 'confirmed' | 'returned';

export const FIELD_IDS = [
  'locationPreference',
  'preferredDate',
  'preferredPeriod',
  'companionRequired',
  'helperName',
  'helperPhone',
  'notes',
] as const;
export type FieldId = (typeof FIELD_IDS)[number];

export const PERIOD_VALUES = ['morning', 'afternoon'] as const;
export type PreferredPeriod = (typeof PERIOD_VALUES)[number];

export interface CaseFormData {
  /** An option id from the service config. Sites come from open data, so this is not a fixed enum. */
  locationPreference: string | null;
  /** YYYY-MM-DD, compared as a Taipei calendar date. */
  preferredDate: string | null;
  preferredPeriod: PreferredPeriod | null;
  /** null means "not answered yet"; it must never be read as false (spec §6.2, AT07). */
  companionRequired: boolean | null;
  helperName: string;
  helperPhone: string;
  notes: string;
}

/** Keys are §6 field ids, or the attachment requirement id. Values never echo user input. */
export type FieldErrorKey = FieldId | typeof REQUIREMENT_ID;
export type FieldErrors = Partial<Record<FieldErrorKey, string>>;

export const API_ERROR_CODES = [
  'INVALID_LINK',
  'INVALID_JSON',
  'SESSION_REQUIRED',
  'ASSISTANCE_REVOKED',
  'ACTION_FORBIDDEN',
  'NOT_FOUND',
  'ALREADY_CLAIMED',
  'VERSION_CONFLICT',
  'ALREADY_SUBMITTED',
  'ATTACHMENT_EXISTS',
  'IDEMPOTENCY_CONFLICT',
  'CONFIRMATION_REQUIRED',
  'ACTIVE_ASSISTANCE_EXISTS',
  'INVITATION_EXPIRED',
  'ACCESS_EXPIRED',
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'TEMPORARY_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fieldErrors?: FieldErrors;
  };
}

// ---- §10.2 session and fixed service ----------------------------------------

/** POST /api/demo/session */
export interface DemoSessionResponse {
  persona: Persona;
  publicLabel: string;
  serverNow: string;
}

/** GET /api/session */
export interface SessionResponse extends DemoSessionResponse {
  /** The helper identity's latest case still inside its access window; null if none. */
  recentCaseId: string | null;
}

export type ServiceFieldType = 'select' | 'date' | 'boolean' | 'text' | 'tel' | 'textarea';

export interface ServiceFieldOption {
  value: string;
  label: string;
  /** Renders as an <optgroup> heading. Used to group sites by district. */
  group?: string;
  /** Extra detail, such as a site's address, shown once the option is selected. */
  detail?: string;
}

/** Where a piece of real data came from. The competition requires this to be stated. */
export interface OpenDataSource {
  datasetName: string;
  provider: string;
  landingPage: string;
  licence: string;
  lastChanged: string;
  /** What the product uses it for, written for end users. */
  usage: string;
}

export interface ServiceField {
  id: FieldId;
  label: string;
  type: ServiceFieldType;
  required: boolean;
  placeholder?: string;
  /** Persistent helper text. Placeholders alone are not accessible. */
  hint?: string;
  maxLength?: number;
  options?: ServiceFieldOption[];
}

export interface AttachmentRequirement {
  requirementId: typeof REQUIREMENT_ID;
  label: string;
  required: boolean;
  acceptedMimeTypes: string[];
  /** Value for <input type="file" accept>, e.g. ".pdf,.png,.jpg,.jpeg". */
  acceptAttribute: string;
  /** Effective upload limit. May be lower than 5 MiB on hosts with a smaller body cap. */
  maxBytes: number;
  /** Human-readable hint built from maxBytes, e.g. "PDF / PNG / JPEG，最多 5 MiB。" */
  hint: string;
  warning: string;
}

/** GET /api/services/healthcheck-demo. Public; contains no applicant values. */
export interface ServiceConfigResponse {
  id: typeof SERVICE_ID;
  name: string;
  schemaVersion: number;
  isDemo: true;
  mode: 'preference-request';
  consentVersion: string;
  consentText: string;
  /** Where applicant data comes from: fictional seed, not MyData (spec §6.1). */
  dataSource: 'demo_seed';
  /** Open datasets behind the form's options. Shown on S04 and S05. */
  openDataSources: OpenDataSource[];
  /** The only origin QR codes and pasted links may point at (spec §13.1). */
  publicOrigin: string;
  fields: ServiceField[];
  attachment: AttachmentRequirement;
  limits: {
    claimMinutes: number;
    accessMinutes: number;
    sessionHours: number;
  };
  /** Inclusive Taipei-date range accepted right now for preferredDate. */
  dateRange: { min: string; max: string };
  serverNow: string;
}

// ---- §10.3 grants -----------------------------------------------------------

/** POST /api/assistance-grants and POST /api/assistance-grants/:id/reissue. */
export interface GrantCreatedResponse {
  grantId: string;
  state: 'issued';
  /** Returned only at creation time. Never available from any GET. */
  token: string;
  claimExpiresAt: string;
  accessExpiresAt: string;
  serverNow: string;
}

/**
 * What happened during the applicant's latest grant, in words the applicant can check
 * (info.md E05). Built from audit events, so it never carries ids, form values or files.
 * `blocked` is a helper action refused because the applicant stopped it or it expired.
 */
export const ACTIVITY_KINDS = [
  'code_issued',
  'claimed',
  'draft_saved',
  'attachment_uploaded',
  'attachment_removed',
  'confirmation_requested',
  'confirmed',
  'returned',
  'submitted',
  'stopped',
  'blocked',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
  kind: ActivityKind;
  /** The latest time in the run when `count` > 1. */
  at: string;
  /** Repeats in a row are folded into one entry, e.g. five draft saves. */
  count: number;
}

/**
 * What the applicant is asked to confirm. Their own case, so the helper's name and phone are
 * shown: the applicant should know who is helping. Protected values are never part of it.
 */
export interface ApplicantReview {
  revision: number;
  formData: CaseFormData;
  attachmentReady: boolean;
}

/** GET /api/my-assistance returns this, or `data: null` when no grant exists. */
export interface MyAssistanceResponse {
  grantId: string;
  state: GrantState;
  claimExpiresAt: string;
  accessExpiresAt: string;
  caseId: string | null;
  receiptNo: string | null;
  /** On the case's current revision; `none` when there is no case or it is submitted. */
  confirmation: ConfirmationStatus;
  /** Present while the confirmation is `pending` or `confirmed`, for the applicant to read. */
  review: ApplicantReview | null;
  /** Newest first. */
  activity: ActivityEvent[];
  serverNow: string;
}

/** POST /api/assistance-grants/redeem */
export interface RedeemResponse {
  grantId: string;
  caseId: string;
  /** `completed` when the same helper re-scans after submitting: go to the result page. */
  state: 'active' | 'completed';
  accessExpiresAt: string;
  serverNow: string;
}

/** POST /api/assistance-grants/:id/revoke */
export interface RevokeResponse {
  grantId: string;
  state: 'revoked';
  serverNow: string;
}

// ---- §10.4–10.6 cases -------------------------------------------------------

export interface AttachmentInfo {
  id: string;
  displayName: string;
  mime: string;
  size: number;
}

export interface Receipt {
  receiptNo: string;
  submittedAt: string;
  isDemo: true;
  message: string;
}

/** GET /api/cases/:id for the bound helper, and the PATCH draft response. */
export interface HelperCaseResponse {
  caseId: string;
  serviceId: typeof SERVICE_ID;
  schemaVersion: number;
  state: CaseState;
  canEdit: boolean;
  revision: number;
  applicantLabel: string;
  protectedDataStatus: 'ready';
  formData: CaseFormData;
  attachment: AttachmentInfo | null;
  receipt: Receipt | null;
  /** On the current revision. Submitting needs `confirmed`. */
  confirmation: ConfirmationStatus;
  accessExpiresAt: string;
  serverNow: string;
}

/** GET /api/cases/:id for the owning applicant: deliberately not the helper's shape. */
export interface ApplicantCaseResponse {
  caseId: string;
  state: CaseState;
  serviceName: string;
  receipt: Receipt | null;
}

/** PATCH /api/cases/:id/draft */
export interface SaveDraftRequest {
  expectedRevision: number;
  formData: CaseFormData;
}

/** POST /api/cases/:id/attachments */
export interface AttachmentUploadResponse {
  attachment: AttachmentInfo;
  revision: number;
}

/** DELETE /api/cases/:id/attachments/:attachmentId */
export interface AttachmentDeleteResponse {
  attachment: null;
  revision: number;
}

/**
 * POST /api/cases/:id/request-confirmation (helper), and POST /api/cases/:id/confirm or
 * /return (applicant). The revision pins what was read, so a decision never lands on a newer draft.
 */
export interface ConfirmationRequest {
  expectedRevision: number;
}

/** POST /api/cases/:id/confirm and /return */
export interface ConfirmationDecisionResponse {
  caseId: string;
  revision: number;
  confirmation: 'confirmed' | 'returned';
  serverNow: string;
}

/** POST /api/cases/:id/submit */
export interface SubmitRequest {
  expectedRevision: number;
  idempotencyKey: string;
}

export interface SubmitResponse {
  caseId: string;
  state: 'submitted';
  revision: number;
  receipt: Receipt;
}
