import { randomUUID } from 'node:crypto';
import type { Express, Request, RequestHandler } from 'express';
import multer from 'multer';
import { REQUIREMENT_ID, type AttachmentDeleteResponse, type AttachmentUploadResponse } from '../../../shared/contract.js';
import { auditedTx } from '../audit.js';
import { attachmentInfo, isUuid, loadCaseRow, requireDraft, requireHelperCase, requireRevision } from '../case-view.js';
import type { AppDeps } from '../deps.js';
import { apiError, attachmentError } from '../errors.js';
import { DeleteAttachmentBody, parseBody } from '../http/json-body.js';
import { FixedWindowLimiter } from '../http/rate-limit.js';
import { safeErrorFields } from '../logger.js';
import { actorIdOf, requireSession } from '../session.js';
import { newStorageKey } from '../storage/blobs.js';
import { inspectUpload } from '../upload-rules.js';

/** Multipart text fields arrive as strings. */
function parseRevisionField(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,14}$/.test(value)) throw apiError('INVALID_JSON');
  return Number(value);
}

/**
 * Normally the request is piped into the multipart parser. On Vercel with its request
 * helpers active, the body was already read into memory and is replayed only to `data` and
 * `end` listeners, while `pipe` would see an ended stream and parse nothing.
 */
function feedMultipartParser(req: NodeJS.ReadableStream & { readableEnded?: boolean }, parser: NodeJS.WritableStream): void {
  if (!req.readableEnded) {
    req.pipe(parser);
    return;
  }
  req.on('data', (chunk: Buffer) => parser.write(chunk));
  req.on('end', () => parser.end());
}

/**
 * Reads the rest of a rejected upload and throws it away, without keeping it in memory.
 * Answering before the body is read makes many clients report a dropped connection
 * instead of showing our error message.
 */
function discardBody(req: Request): Promise<void> {
  return new Promise((resolve) => {
    if (req.readableEnded || req.destroyed) {
      resolve();
      return;
    }
    req.once('end', resolve);
    req.once('close', resolve);
    req.once('error', () => resolve());
    req.resume();
  });
}

export function registerAttachmentRoutes(app: Express, deps: AppDeps): void {
  const { config, db, blobs, clock, logger } = deps;
  const secret = config.sessionSecret;
  const uploadLimiter = new FixedWindowLimiter(config.rateLimit.uploadMax, config.rateLimit.windowMs, clock);

  // streamHandler exists in multer 2.5 but not yet in @types/multer.
  const multerOptions: multer.Options & { streamHandler: typeof feedMultipartParser } = {
    storage: multer.memoryStorage(),
    // fileSize is inclusive in multer 2: a file of exactly maxUploadBytes is accepted.
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5, parts: 6, fieldSize: 1024 },
    streamHandler: feedMultipartParser,
  };
  const parseMultipart = multer(multerOptions).single('file');

  /**
   * Runs before any file byte is buffered, so a stranger cannot make the server hold
   * megabytes in memory. Everything here is checked again inside the transaction.
   */
  const checkBeforeBuffering: RequestHandler<{ id: string }> = async (req, _res, next) => {
    try {
      const now = clock.now();
      const session = await requireSession(db, req, secret, now);
      const row = await requireHelperCase(db, session, req.params.id, now);
      requireDraft(row);
      if (!uploadLimiter.take(session.id)) throw apiError('RATE_LIMITED');
    } catch (err) {
      await discardBody(req);
      throw err;
    }
    next();
  };

  /** Holds a parser error until the documented check order reaches "the file itself". */
  const bufferUpload: RequestHandler = (req, res, next) => {
    parseMultipart(req, res, (err?: unknown) => {
      res.locals.uploadError = err ?? null;
      next();
    });
  };

  /**
   * Order (IMPLEMENTATION.md): common checks, already submitted, requirementId, attachment
   * exists, revision, the file itself. "Already uploaded" comes before "wrong revision"
   * because that is the useful answer when a response was lost and the client retries.
   */
  app.post('/api/cases/:id/attachments', checkBeforeBuffering, bufferUpload, async (req, res) => {
    const uploadError: unknown = res.locals.uploadError;
    const verdict = inspectUpload(req.file, uploadError, config.maxUploadBytes);
    const fields = (req.body ?? {}) as Record<string, unknown>;
    // If parsing stopped early, fields sent after the file never arrived: skip judging them.
    const fieldsComplete = !uploadError;

    // Bytes first, then metadata, so committed metadata always has its bytes (see blobs.ts).
    const storageKey = verdict.ok ? newStorageKey() : null;
    if (verdict.ok && storageKey) await blobs.put(storageKey, verdict.bytes);

    try {
      const data = await auditedTx(deps, 'attachment.upload', async (tx, audit): Promise<AttachmentUploadResponse> => {
        const now = clock.now();
        const session = await requireSession(tx, req, secret, now);
        audit.actorId = actorIdOf(session);
        const row = await requireHelperCase(tx, session, req.params.id, now, audit);
        requireDraft(row);
        if (fieldsComplete && fields.requirementId !== REQUIREMENT_ID) {
          throw attachmentError('VALIDATION_FAILED', '附件欄位不正確，請重新整理後再試。');
        }
        if (row.attachment_id !== null) throw apiError('ATTACHMENT_EXISTS');
        if (fieldsComplete) requireRevision(row, parseRevisionField(fields.expectedRevision));
        if (!verdict.ok) throw verdict.error;

        await tx.run(
          `INSERT INTO attachments (id, case_id, requirement_id, storage_key, mime, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), row.case_id, REQUIREMENT_ID, storageKey, verdict.mime, verdict.size, now.toISOString()],
        );
        await tx.run('UPDATE cases SET revision = revision + 1, updated_at = ? WHERE id = ?', [
          now.toISOString(),
          row.case_id,
        ]);
        const saved = await loadCaseRow(tx, row.case_id);
        const attachment = saved && attachmentInfo(saved);
        if (!saved || !attachment) throw new Error('Attachment missing after upload');
        return { attachment, revision: saved.revision };
      });
      res.status(201).json({ data });
    } catch (err) {
      if (storageKey) {
        await blobs.delete(storageKey).catch((deleteErr: unknown) => {
          logger.warn('orphan_blob_left', safeErrorFields(deleteErr));
        });
      }
      throw err;
    }
  });

  /** Order: common checks, already submitted, JSON structure, attachment belongs to case, revision. */
  app.delete('/api/cases/:id/attachments/:attachmentId', async (req, res) => {
    let removedKey: string | null = null;
    const data = await auditedTx(deps, 'attachment.delete', async (tx, audit): Promise<AttachmentDeleteResponse> => {
      const now = clock.now();
      const session = await requireSession(tx, req, secret, now);
      audit.actorId = actorIdOf(session);
      const row = await requireHelperCase(tx, session, req.params.id, now, audit);
      requireDraft(row);
      const body = parseBody(req, res, DeleteAttachmentBody);
      const attachmentId = req.params.attachmentId;
      if (!isUuid(attachmentId) || row.attachment_id !== attachmentId) throw apiError('NOT_FOUND');
      requireRevision(row, body.expectedRevision);

      await tx.run('DELETE FROM attachments WHERE id = ?', [attachmentId]);
      await tx.run('UPDATE cases SET revision = revision + 1, updated_at = ? WHERE id = ?', [
        now.toISOString(),
        row.case_id,
      ]);
      removedKey = row.attachment_storage_key;
      return { attachment: null, revision: row.revision + 1 };
    });
    // Metadata is gone, so the case no longer refers to the bytes. A failure here only
    // leaves an orphan.
    if (removedKey) {
      await blobs.delete(removedKey).catch((err: unknown) => logger.warn('orphan_blob_left', safeErrorFields(err)));
    }
    res.json({ data });
  });
}
