import type { ErrorRequestHandler, Request, Response } from 'express';
import { REQUIREMENT_ID, type ApiErrorBody, type ApiErrorCode, type FieldErrors } from '../../shared/contract.js';
import { safeErrorFields, type Logger } from './logger.js';

/** HTTP status and default wording for each code in spec §10.1. Messages never echo input. */
const ERROR_CATALOG: Record<ApiErrorCode, { status: number; message: string }> = {
  INVALID_LINK: { status: 400, message: '這不是可用的協助碼，請使用本人提供的託你辦連結。' },
  INVALID_JSON: { status: 400, message: '送出的資料格式不正確。' },
  SESSION_REQUIRED: { status: 401, message: '請回到首頁重新選擇情境。' },
  ASSISTANCE_REVOKED: { status: 403, message: '本人已停止這次協助，目前不能繼續操作。' },
  ACTION_FORBIDDEN: { status: 403, message: '目前的身分不能進行這個操作。' },
  NOT_FOUND: { status: 404, message: '找不到可存取的資料。' },
  ALREADY_CLAIMED: { status: 409, message: '這個協助碼已被領取，無法從這台裝置接續。' },
  VERSION_CONFLICT: { status: 409, message: '內容已在其他地方更新，請重新載入。' },
  ALREADY_SUBMITTED: { status: 409, message: '這份申請已送出，不能再修改。' },
  ATTACHMENT_EXISTS: { status: 409, message: '已有一份附件，請先刪除再上傳。' },
  CONFIRMATION_REQUIRED: { status: 409, message: '本人還沒確認這個版本的內容，請先送交本人確認。' },
  IDEMPOTENCY_CONFLICT: { status: 409, message: '這次送出的內容和先前不同，請重新載入後再確認。' },
  ACTIVE_ASSISTANCE_EXISTS: { status: 409, message: '已有進行中的協助，請先查看目前狀態。' },
  INVITATION_EXPIRED: { status: 410, message: '協助碼已到期，請本人重新產生。' },
  ACCESS_EXPIRED: { status: 410, message: '協助已到期，請本人重新產生協助碼。' },
  FILE_TOO_LARGE: { status: 413, message: '檔案太大。' },
  FILE_TYPE_NOT_ALLOWED: { status: 415, message: '只接受內容和副檔名相符的 PDF、PNG、JPEG。' },
  VALIDATION_FAILED: { status: 422, message: '請確認必填內容與練習附件。' },
  RATE_LIMITED: { status: 429, message: '操作太頻繁，請稍後再試。' },
  TEMPORARY_ERROR: { status: 500, message: '系統暫時無法處理，請再試一次。' },
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors: FieldErrors | undefined;

  constructor(code: ApiErrorCode, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = 'ApiError';
    this.status = ERROR_CATALOG[code].status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function apiError(code: ApiErrorCode, fieldErrors?: FieldErrors): ApiError {
  return new ApiError(code, ERROR_CATALOG[code].message, fieldErrors);
}

/** Attachment problems are marked on the attachment field (IMPLEMENTATION.md). */
export function attachmentError(code: ApiErrorCode, fieldMessage: string): ApiError {
  return new ApiError(code, fieldMessage, { [REQUIREMENT_ID]: fieldMessage });
}

function sendError(res: Response, error: ApiError): void {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
  if (error.fieldErrors) body.error.fieldErrors = error.fieldErrors;
  res.status(error.status).json(body);
}

/** The route pattern, never the raw URL, so ids and paths stay out of the logs. */
export function routeLabel(req: Request): string {
  const pattern: unknown = req.route?.path;
  if (typeof pattern === 'string') return pattern;
  return req.originalUrl.startsWith('/api') ? '/api/(unmatched)' : '(site)';
}

export function errorHandler(logger: Logger, debugErrors: boolean): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    // Already streaming a response: all that is left is to drop the connection.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    // A path segment with broken percent-encoding cannot name anything we have.
    if (err instanceof URIError) {
      sendError(res, apiError('NOT_FOUND'));
      return;
    }
    logger.error('request_failed', {
      method: req.method,
      route: routeLabel(req),
      ...safeErrorFields(err),
      ...(debugErrors && err instanceof Error ? { debugMessage: err.message } : {}),
    });
    sendError(res, apiError('TEMPORARY_ERROR'));
  };
}
