import type { Express, Request, Response } from 'express';
import type { ConfirmationDecisionResponse, HelperCaseResponse } from '../../../shared/contract.js';
import { auditedTx, type AuditContext } from '../audit.js';
import {
  confirmationOf,
  isUuid,
  loadCaseRow,
  readinessErrors,
  requireDraft,
  requireHelperCase,
  requireRevision,
  toHelperCaseResponse,
  type CaseRow,
} from '../case-view.js';
import type { AppDeps } from '../deps.js';
import { apiError } from '../errors.js';
import { assertHelperGrantOpen } from '../grant-rules.js';
import { ConfirmationBody, parseBody } from '../http/json-body.js';
import { actorIdOf, requirePersona, requireSession, type SessionRow } from '../session.js';
import type { Sql } from '../storage/db.js';

/**
 * The applicant's side of a case they own. Same order as the helper checks: persona, then
 * "exists and is yours" (unknown and not-yours are the same 404), then stopped, then expired.
 */
async function requireApplicantCase(
  q: Sql,
  session: SessionRow,
  caseId: string,
  now: Date,
  audit: AuditContext,
): Promise<CaseRow> {
  requirePersona(session, 'applicant');
  const row = isUuid(caseId) ? await loadCaseRow(q, caseId) : undefined;
  if (!row || row.subject_id !== session.subject_id) throw apiError('NOT_FOUND');
  audit.caseId = row.case_id;
  audit.grantId = row.grant_id;
  assertHelperGrantOpen(row, now);
  return row;
}

/**
 * The applicant confirms, or sends back, what the helper prepared (info.md F09, E03).
 * Nothing is submitted here: the helper still presses submit, and only on this revision.
 */
export function registerConfirmationRoutes(app: Express, deps: AppDeps): void {
  const { config, clock } = deps;
  const secret = config.sessionSecret;

  /**
   * The helper asks the applicant to confirm. Order: common checks, already submitted, JSON
   * structure, revision, then the full submit rules, so the applicant never confirms
   * something that cannot be sent. Asking again replaces an earlier request.
   */
  app.post('/api/cases/:id/request-confirmation', async (req, res) => {
    const data = await auditedTx(deps, 'case.request_confirmation', async (tx, audit): Promise<HelperCaseResponse> => {
      const now = clock.now();
      const session = await requireSession(tx, req, secret, now);
      audit.actorId = actorIdOf(session);
      const row = await requireHelperCase(tx, session, req.params.id, now, audit);
      requireDraft(row);
      const body = parseBody(req, res, ConfirmationBody);
      requireRevision(row, body.expectedRevision);
      const fieldErrors = readinessErrors(row, now);
      if (Object.keys(fieldErrors).length > 0) throw apiError('VALIDATION_FAILED', fieldErrors);

      // Already waiting or already confirmed on this revision: nothing to ask again.
      const current = confirmationOf(row);
      if (current !== 'pending' && current !== 'confirmed') {
        await tx.run(
          `INSERT INTO case_confirmations (case_id, revision, decision, requested_at, decided_at)
           VALUES (?, ?, 'pending', ?, NULL)
           ON CONFLICT (case_id) DO UPDATE
             SET revision = excluded.revision, decision = 'pending',
                 requested_at = excluded.requested_at, decided_at = NULL`,
          [row.case_id, row.revision, now.toISOString()],
        );
      }
      const saved = await loadCaseRow(tx, row.case_id);
      if (!saved) throw new Error('Case disappeared during confirmation request');
      return toHelperCaseResponse(saved, now);
    });
    res.json({ data });
  });

  /**
   * One handler for both answers. Order: applicant checks, already submitted, JSON
   * structure, then "is there a pending request on exactly this revision". A stale page,
   * or a draft the helper changed since, gets VERSION_CONFLICT and must re-read first.
   */
  function decide(decision: 'confirmed' | 'returned') {
    return async (req: Request<{ id: string }>, res: Response) => {
      const action = decision === 'confirmed' ? 'case.confirm' : 'case.return';
      const data = await auditedTx(deps, action, async (tx, audit): Promise<ConfirmationDecisionResponse> => {
        const now = clock.now();
        const session = await requireSession(tx, req, secret, now);
        audit.actorId = actorIdOf(session);
        const row = await requireApplicantCase(tx, session, req.params.id, now, audit);
        requireDraft(row);
        const body = parseBody(req, res, ConfirmationBody);
        requireRevision(row, body.expectedRevision);
        const current = confirmationOf(row);
        // Pressing the same answer twice, e.g. after a lost response, gives the same result.
        if (current !== decision) {
          if (current !== 'pending') throw apiError('VERSION_CONFLICT');
          await tx.run(
            `UPDATE case_confirmations SET decision = ?, decided_at = ? WHERE case_id = ? AND revision = ?`,
            [decision, now.toISOString(), row.case_id, row.revision],
          );
        }
        return { caseId: row.case_id, revision: row.revision, confirmation: decision, serverNow: now.toISOString() };
      });
      res.json({ data });
    };
  }

  app.post('/api/cases/:id/confirm', decide('confirmed'));
  app.post('/api/cases/:id/return', decide('returned'));
}
