import type { Express } from 'express';
import { validateDraft } from '../../../shared/form.js';
import { auditedTx } from '../audit.js';
import {
  isUuid,
  loadCaseRow,
  requireDraft,
  requireHelperCase,
  requireRevision,
  toApplicantCaseResponse,
  toHelperCaseResponse,
} from '../case-view.js';
import type { AppDeps } from '../deps.js';
import { apiError } from '../errors.js';
import { parseBody, SaveDraftBody } from '../http/json-body.js';
import { FORM_RULES } from '../service-config.js';
import { actorIdOf, requireSession } from '../session.js';

export function registerCaseRoutes(app: Express, deps: AppDeps): void {
  const { config, db, clock } = deps;
  const secret = config.sessionSecret;

  /**
   * The applicant gets a status summary of their own case, whatever the grant state. The
   * bound helper gets the form while access lasts (spec §7.3, §10.4).
   */
  app.get('/api/cases/:id', async (req, res) => {
    const now = clock.now();
    const session = await requireSession(db, req, secret, now);
    if (session.persona === 'applicant') {
      const row = isUuid(req.params.id) ? await loadCaseRow(db, req.params.id) : undefined;
      if (!row || row.subject_id !== session.subject_id) throw apiError('NOT_FOUND');
      res.json({ data: toApplicantCaseResponse(row) });
      return;
    }
    const row = await requireHelperCase(db, session, req.params.id, now);
    res.json({ data: toHelperCaseResponse(row, now) });
  });

  /**
   * Save draft. Order (IMPLEMENTATION.md): common checks, already submitted, JSON structure,
   * revision, field content. A stale revision never overwrites anything (spec AT13).
   */
  app.patch('/api/cases/:id/draft', async (req, res) => {
    const data = await auditedTx(deps, 'case.save_draft', async (tx, audit) => {
      const now = clock.now();
      const session = await requireSession(tx, req, secret, now);
      audit.actorId = actorIdOf(session);
      const row = await requireHelperCase(tx, session, req.params.id, now, audit);
      requireDraft(row);
      const body = parseBody(req, res, SaveDraftBody);
      requireRevision(row, body.expectedRevision);

      // Draft rules: anything may be empty, but what is there must be well-formed.
      const { form, fieldErrors } = validateDraft(body.formData, now, FORM_RULES);
      if (Object.keys(fieldErrors).length > 0) throw apiError('VALIDATION_FAILED', fieldErrors);

      await tx.run('UPDATE cases SET form_data = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [
        JSON.stringify(form),
        now.toISOString(),
        row.case_id,
      ]);
      const saved = await loadCaseRow(tx, row.case_id);
      if (!saved) throw new Error('Case disappeared during save');
      return toHelperCaseResponse(saved, now);
    });
    res.json({ data });
  });
}
