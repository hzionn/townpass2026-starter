import { createHash, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { SCHEMA_VERSION, type CaseFormData, type SubmitResponse } from '../../../shared/contract.js';
import { taipeiDateString } from '../../../shared/form.js';
import { auditedTx } from '../audit.js';
import {
  attachmentInfo,
  confirmationOf,
  loadCaseRow,
  readinessErrors,
  receiptOf,
  requireHelperCase,
  requireRevision,
  type CaseRow,
  type SubmissionSnapshot,
} from '../case-view.js';
import type { AppDeps } from '../deps.js';
import { apiError } from '../errors.js';
import { parseBody, SubmitBody } from '../http/json-body.js';
import { actorIdOf, requireSession } from '../session.js';
import type { Sql } from '../storage/db.js';

/** Identifies "the same request" for idempotency (IMPLEMENTATION.md). */
function requestFingerprint(caseId: string, expectedRevision: number): string {
  return createHash('sha256').update(`${caseId}:${expectedRevision}`).digest('hex');
}

/** DEMO-YYYYMMDD-NNNN on the Taipei calendar. The counter row makes the number unique. */
async function nextReceiptNo(tx: Sql, now: Date): Promise<string> {
  const day = taipeiDateString(now).replaceAll('-', '');
  const counter = await tx.get<{ last_seq: number }>(
    `INSERT INTO receipt_counters (day, last_seq) VALUES (?, 1)
     ON CONFLICT (day) DO UPDATE SET last_seq = receipt_counters.last_seq + 1
     RETURNING last_seq`,
    [day],
  );
  if (!counter) throw new Error('Receipt counter did not return a value');
  return `DEMO-${day}-${String(counter.last_seq).padStart(4, '0')}`;
}

function toSubmitResponse(row: CaseRow): SubmitResponse {
  const receipt = receiptOf(row);
  if (!receipt) throw new Error('Submitted case has no receipt');
  return { caseId: row.case_id, state: 'submitted', revision: row.revision, receipt };
}

export function registerSubmitRoutes(app: Express, deps: AppDeps): void {
  const { config, clock } = deps;

  /**
   * Simulated submission (spec §10.6). Order (IMPLEMENTATION.md): common checks, JSON
   * structure, an existing submission, revision, full validation, then snapshot, receipt and
   * state changes in this one transaction. Because every write transaction is queued, a
   * revoke lands either wholly before this or wholly after it (spec §10.7).
   */
  app.post('/api/cases/:id/submit', async (req, res) => {
    const data = await auditedTx(deps, 'case.submit', async (tx, audit): Promise<SubmitResponse> => {
      const now = clock.now();
      const session = await requireSession(tx, req, config.sessionSecret, now);
      audit.actorId = actorIdOf(session);
      const row = await requireHelperCase(tx, session, req.params.id, now, audit);
      const body = parseBody(req, res, SubmitBody);
      const idempotencyKey = body.idempotencyKey.toLowerCase();
      const fingerprint = requestFingerprint(row.case_id, body.expectedRevision);

      if (row.receipt_no !== null) {
        if (row.idempotency_key !== idempotencyKey) throw apiError('ALREADY_SUBMITTED');
        if (row.request_fingerprint !== fingerprint) throw apiError('IDEMPOTENCY_CONFLICT');
        // A retry of the same request, e.g. after a lost response: the original result.
        return toSubmitResponse(row);
      }

      requireRevision(row, body.expectedRevision);
      // The applicant must have confirmed exactly this revision (info.md F09, E03).
      if (confirmationOf(row) !== 'confirmed') throw apiError('CONFIRMATION_REQUIRED');
      const form = JSON.parse(row.form_data) as CaseFormData;
      const fieldErrors = readinessErrors(row, now);
      const attachment = attachmentInfo(row);
      if (row.schema_version !== SCHEMA_VERSION || Object.keys(fieldErrors).length > 0 || !attachment) {
        throw apiError('VALIDATION_FAILED', fieldErrors);
      }

      const snapshot: SubmissionSnapshot = { schemaVersion: row.schema_version, formData: form, attachment };
      await tx.run(
        `INSERT INTO submissions (id, case_id, receipt_no, idempotency_key, request_fingerprint, snapshot, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          row.case_id,
          await nextReceiptNo(tx, now),
          idempotencyKey,
          fingerprint,
          JSON.stringify(snapshot),
          now.toISOString(),
        ],
      );
      await tx.run(`UPDATE cases SET state = 'submitted', revision = revision + 1, updated_at = ? WHERE id = ?`, [
        now.toISOString(),
        row.case_id,
      ]);
      const completed = await tx.run(`UPDATE assistance_grants SET state = 'completed' WHERE id = ? AND state = 'active'`, [
        row.grant_id,
      ]);
      if (completed !== 1) throw new Error('Grant was not active at submit');

      const saved = await loadCaseRow(tx, row.case_id);
      if (!saved) throw new Error('Case disappeared during submit');
      return toSubmitResponse(saved);
    });
    res.json({ data });
  });
}
