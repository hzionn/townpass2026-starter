import { randomUUID } from 'node:crypto';
import type { AppDeps } from './deps.js';
import { ApiError } from './errors.js';
import type { Sql } from './storage/db.js';

/** Filled in as the transaction learns who and what the request is about. */
export interface AuditContext {
  actorId: string;
  grantId: string | null;
  caseId: string | null;
}

async function recordAudit(tx: Sql, at: Date, action: string, context: AuditContext, result: string): Promise<void> {
  await tx.run(
    `INSERT INTO audit_events (id, actor_id, grant_id, case_id, action, result, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), context.actorId, context.grantId, context.caseId, action, result, at.toISOString()],
  );
}

/**
 * Runs one state change in a write transaction and records the outcome (spec §9 AuditEvent).
 * Only ids, the action and the result are stored: no tokens, personal data or file contents.
 *
 * A success is recorded in the same transaction. A refusal rolled the transaction back, so
 * it is recorded in a new one, and a failure to record it must not hide the real answer.
 */
export async function auditedTx<T>(
  deps: Pick<AppDeps, 'db' | 'clock'>,
  action: string,
  fn: (tx: Sql, audit: AuditContext) => Promise<T>,
): Promise<T> {
  const context: AuditContext = { actorId: 'anonymous', grantId: null, caseId: null };
  try {
    return await deps.db.writeTx(async (tx) => {
      const result = await fn(tx, context);
      await recordAudit(tx, deps.clock.now(), action, context, 'ok');
      return result;
    });
  } catch (err) {
    if (err instanceof ApiError) {
      await deps.db.writeTx((tx) => recordAudit(tx, deps.clock.now(), action, context, err.code)).catch(() => undefined);
    }
    throw err;
  }
}
