/**
 * Thin fetch wrapper around the same-origin API (spec §10).
 *
 * Every failure becomes exactly one of two errors, so screens never have to guess:
 * - ApiError: the server, or a proxy in front of it, answered.
 * - NetworkError: no answer arrived, so a write may or may not have happened.
 */
import {
  API_ERROR_CODES,
  CONSENT_VERSION,
  REQUIREMENT_ID,
  SERVICE_ID,
  type ApiErrorCode,
  type ApplicantCaseResponse,
  type AttachmentDeleteResponse,
  type AttachmentUploadResponse,
  type ConfirmationDecisionResponse,
  type DemoSessionResponse,
  type FieldErrors,
  type GrantCreatedResponse,
  type HelperCaseResponse,
  type MyAssistanceResponse,
  type Persona,
  type RedeemResponse,
  type RevokeResponse,
  type SaveDraftRequest,
  type ServiceConfigResponse,
  type SessionResponse,
  type SubmitRequest,
  type SubmitResponse,
} from '../../../shared/contract';

export const DEFAULT_TIMEOUT_MS = 15_000;
/** A 5 MiB file over venue Wi-Fi can legitimately take a while. */
const UPLOAD_TIMEOUT_MS = 60_000;
const GENERIC_MESSAGE = '服務暫時無法回應，請稍後再試。';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut ? '連線逾時' : '連線失敗');
    this.name = 'NetworkError';
  }
}

/** True when a write might have reached the server even though we saw no success. */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}

/** True when the session is gone or has the wrong persona. The client has already gone home. */
export function isAccessLost(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'ACTION_FORBIDDEN');
}

let accessLostHandler: () => void = () => {};

/** Wired up in main.ts: "any 401 goes home" lives in one place instead of on every screen. */
export function setAccessLostHandler(handler: () => void): void {
  accessLostHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  json?: unknown;
  form?: FormData;
  timeoutMs?: number;
  /** For GET /api/session, where a 401 just means "no session yet". */
  expectUnauthorized?: boolean;
}

/** Only ever parses JSON responses: proxies and hosts answer errors with HTML pages. */
function parseJsonBody(response: Response, text: string): unknown {
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** For non-JSON errors from something in front of our server, such as a host's upload cap. */
function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return 'SESSION_REQUIRED';
  if (status === 413) return 'FILE_TOO_LARGE';
  if (status === 415) return 'FILE_TYPE_NOT_ALLOWED';
  if (status === 429) return 'RATE_LIMITED';
  return 'TEMPORARY_ERROR';
}

function toApiError(status: number, body: unknown): ApiError {
  const candidate = (body as { error?: { code?: unknown; message?: unknown; fieldErrors?: unknown } } | undefined)?.error;
  if (candidate && API_ERROR_CODES.includes(candidate.code as ApiErrorCode)) {
    return new ApiError(
      status,
      candidate.code as ApiErrorCode,
      typeof candidate.message === 'string' ? candidate.message : GENERIC_MESSAGE,
      (candidate.fieldErrors as FieldErrors | undefined) ?? {},
    );
  }
  return new ApiError(status, codeFromStatus(status), GENERIC_MESSAGE);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  let text: string;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: options.json === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.form ?? (options.json === undefined ? undefined : JSON.stringify(options.json)),
    });
    text = await response.text();
  } catch {
    throw new NetworkError(controller.signal.aborted);
  } finally {
    clearTimeout(timer);
  }

  const body = parseJsonBody(response, text);
  if (response.ok) {
    // A 200 without our envelope is a tunnel interstitial or SPA fallback, not our API.
    if (body !== null && typeof body === 'object' && 'data' in body) return (body as { data: T }).data;
    throw new ApiError(502, 'TEMPORARY_ERROR', GENERIC_MESSAGE);
  }

  const error = toApiError(response.status, body);
  if (isAccessLost(error) && !options.expectUnauthorized) accessLostHandler();
  throw error;
}

export function isHelperCase(data: HelperCaseResponse | ApplicantCaseResponse): data is HelperCaseResponse {
  return 'formData' in data;
}

export const api = {
  createDemoSession: (persona: Persona) =>
    request<DemoSessionResponse>('/demo/session', { method: 'POST', json: { persona }, expectUnauthorized: true }),

  getSession: () => request<SessionResponse>('/session', { expectUnauthorized: true }),

  getService: () => request<ServiceConfigResponse>(`/services/${SERVICE_ID}`),

  getMyAssistance: () => request<MyAssistanceResponse | null>('/my-assistance'),

  createGrant: (consentVersion: string = CONSENT_VERSION) =>
    request<GrantCreatedResponse>('/assistance-grants', {
      method: 'POST',
      json: { serviceId: SERVICE_ID, consentVersion },
    }),

  reissueGrant: (grantId: string) =>
    request<GrantCreatedResponse>(`/assistance-grants/${encodeURIComponent(grantId)}/reissue`, {
      method: 'POST',
      json: {},
    }),

  redeem: (token: string) =>
    request<RedeemResponse>('/assistance-grants/redeem', { method: 'POST', json: { token } }),

  revokeGrant: (grantId: string) =>
    request<RevokeResponse>(`/assistance-grants/${encodeURIComponent(grantId)}/revoke`, {
      method: 'POST',
      json: {},
    }),

  /** S02 only: the applicant's safe view of a case. */
  getApplicantCase: (caseId: string) =>
    request<ApplicantCaseResponse>(`/cases/${encodeURIComponent(caseId)}`),

  /** S04–S06. A case page must never render the helper form from an applicant response. */
  getHelperCase: async (caseId: string): Promise<HelperCaseResponse> => {
    const data = await request<HelperCaseResponse | ApplicantCaseResponse>(`/cases/${encodeURIComponent(caseId)}`);
    if (isHelperCase(data)) return data;
    accessLostHandler();
    throw new ApiError(403, 'ACTION_FORBIDDEN', GENERIC_MESSAGE);
  },

  saveDraft: (caseId: string, body: SaveDraftRequest) =>
    request<HelperCaseResponse>(`/cases/${encodeURIComponent(caseId)}/draft`, { method: 'PATCH', json: body }),

  uploadAttachment: (caseId: string, file: File, expectedRevision: number) => {
    // Text fields first: multipart parsers see fields in order, so they are known before the file.
    const form = new FormData();
    form.append('requirementId', REQUIREMENT_ID);
    form.append('expectedRevision', String(expectedRevision));
    form.append('file', file);
    return request<AttachmentUploadResponse>(`/cases/${encodeURIComponent(caseId)}/attachments`, {
      method: 'POST',
      form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },

  deleteAttachment: (caseId: string, attachmentId: string, expectedRevision: number) =>
    request<AttachmentDeleteResponse>(
      `/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: 'DELETE', json: { expectedRevision } },
    ),

  /** S05: the helper asks the applicant to confirm this revision. */
  requestConfirmation: (caseId: string, expectedRevision: number) =>
    request<HelperCaseResponse>(`/cases/${encodeURIComponent(caseId)}/request-confirmation`, {
      method: 'POST',
      json: { expectedRevision },
    }),

  /** S02: the applicant's answer on exactly the revision they read. */
  decideConfirmation: (caseId: string, decision: 'confirm' | 'return', expectedRevision: number) =>
    request<ConfirmationDecisionResponse>(`/cases/${encodeURIComponent(caseId)}/${decision}`, {
      method: 'POST',
      json: { expectedRevision },
    }),

  submit: (caseId: string, body: SubmitRequest) =>
    request<SubmitResponse>(`/cases/${encodeURIComponent(caseId)}/submit`, {
      method: 'POST',
      json: body,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }),
};
