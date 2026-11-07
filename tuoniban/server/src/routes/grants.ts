import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { TOKEN_PATTERN } from '../../../shared/assistLink.js';
import {
  SCHEMA_VERSION,
  SERVICE_ID,
  type GrantCreatedResponse,
  type GrantState,
  type MyAssistanceResponse,
  type RedeemResponse,
  type RevokeResponse,
} from '../../../shared/contract.js';
import { emptyFormData } from '../../../shared/form.js';
import { auditedTx } from '../audit.js';
import { addMinutes } from '../clock.js';
import { ACCESS_MINUTES, CLAIM_MINUTES, GRANT_SCOPES } from '../constants.js';
import { isUuid } from '../case-view.js';
import type { AppDeps } from '../deps.js';
import { apiError } from '../errors.js';
import { effectiveGrantState, isWithinAccessWindow } from '../grant-rules.js';
import { CreateGrantBody, EmptyBody, parseBody, RedeemBody } from '../http/json-body.js';
import { FixedWindowLimiter } from '../http/rate-limit.js';
import { actorIdOf, requirePersona, requireSession, type SessionRow } from '../session.js';
import type { Sql } from '../storage/db.js';

interface GrantRow {
  id: string;
  subject_id: string;
  state: GrantState;
  claim_expires_at: string;
  access_expires_at: string;
  claimed_helper_id: string | null;
  consent_version: string;
  revoked_at: string | null;
}

interface LatestGrantRow {
  id: string;
  state: GrantState;
  claim_expires_at: string;
  access_expires_at: string;
  case_id: string | null;
  receipt_no: string | null;
}

const GRANT_COLUMNS =
  'id, subject_id, state, claim_expires_at, access_expires_at, claimed_helper_id, consent_version, revoked_at';

/** Only the SHA-256 of a token is stored, so the database alone cannot be used to claim. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Finds a grant owned by this applicant. Unknown and someone else's look the same. */
async function requireOwnGrant(q: Sql, session: SessionRow, grantId: string): Promise<GrantRow> {
  const grant = isUuid(grantId)
    ? await q.get<GrantRow>(`SELECT ${GRANT_COLUMNS} FROM assistance_grants WHERE id = ?`, [grantId])
    : undefined;
  if (!grant || grant.subject_id !== session.subject_id) throw apiError('NOT_FOUND');
  return grant;
}

/** Creates a grant. The token goes back once, in this response, and is never readable again. */
async function issueGrant(
  tx: Sql,
  subjectId: string,
  consentVersion: string,
  now: Date,
): Promise<GrantCreatedResponse> {
  const grantId = randomUUID();
  // 32 random bytes in base64url, the format TOKEN_PATTERN expects.
  const token = randomBytes(32).toString('base64url');
  const claimExpiresAt = addMinutes(now, CLAIM_MINUTES).toISOString();
  const accessExpiresAt = addMinutes(now, ACCESS_MINUTES).toISOString();
  await tx.run(
    `INSERT INTO assistance_grants
       (id, subject_id, service_id, schema_version, issue_seq, token_hash, claim_expires_at, access_expires_at,
        state, consent_version, scopes, created_at)
     VALUES (?, ?, ?, ?,
             (SELECT COALESCE(MAX(issue_seq), 0) + 1 FROM assistance_grants WHERE subject_id = ?),
             ?, ?, ?, 'issued', ?, ?, ?)`,
    [
      grantId,
      subjectId,
      SERVICE_ID,
      SCHEMA_VERSION,
      subjectId,
      hashToken(token),
      claimExpiresAt,
      accessExpiresAt,
      consentVersion,
      JSON.stringify(GRANT_SCOPES),
      now.toISOString(),
    ],
  );
  return { grantId, state: 'issued', token, claimExpiresAt, accessExpiresAt, serverNow: now.toISOString() };
}

export function registerGrantRoutes(app: Express, deps: AppDeps): void {
  const { config, db, clock } = deps;
  const secret = config.sessionSecret;
  const redeemLimiter = new FixedWindowLimiter(config.rateLimit.redeemMax, config.rateLimit.windowMs, clock);

  /** "Agree and generate a code" (spec §10.3). */
  app.post('/api/assistance-grants', async (req, res) => {
    const data = await auditedTx(deps, 'grant.create', async (tx, audit) => {
      const now = clock.now();
      const session = await requireSession(tx, req, secret, now);
      audit.actorId = actorIdOf(session);
      requirePersona(session, 'applicant');
      const body = parseBody(req, res, CreateGrantBody);
      const subjectId = session.subject_id ?? '';

      // The database may still hold an open grant that has really expired. Settle it first,
      // or it would collide with the "one open grant" unique index.
      const open = await tx.get<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM assistance_grants
          WHERE subject_id = ? AND service_id = ? AND state IN ('issued', 'active')`,
        [subjectId, SERVICE_ID],
      );
      if (open) {
        if (effectiveGrantState(open, now) !== 'expired') throw apiError('ACTIVE_ASSISTANCE_EXISTS');
        await tx.run(`UPDATE assistance_grants SET state = 'expired' WHERE id = ?`, [open.id]);
      }

      const created = await issueGrant(tx, subjectId, body.consentVersion, now);
      audit.grantId = created.grantId;
      return created;
    });
    res.status(201).json({ data });
  });

  /** The applicant's latest grant, without its token (spec §10.4). */
  app.get('/api/my-assistance', async (req, res) => {
    const now = clock.now();
    const session = await requireSession(db, req, secret, now);
    requirePersona(session, 'applicant');
    const row = await db.get<LatestGrantRow>(
      `SELECT g.id, g.state, g.claim_expires_at, g.access_expires_at, c.id AS case_id, s.receipt_no
         FROM assistance_grants g
         LEFT JOIN cases c ON c.grant_id = g.id
         LEFT JOIN submissions s ON s.case_id = c.id
        WHERE g.subject_id = ? AND g.service_id = ?
        ORDER BY g.issue_seq DESC
        LIMIT 1`,
      [session.subject_id, SERVICE_ID],
    );
    const data: MyAssistanceResponse | null = row
      ? {
          grantId: row.id,
          state: effectiveGrantState(row, now),
          claimExpiresAt: row.claim_expires_at,
          accessExpiresAt: row.access_expires_at,
          caseId: row.case_id,
          receiptNo: row.receipt_no,
          serverNow: now.toISOString(),
        }
      : null;
    res.json({ data });
  });

  /** A new code for an unclaimed grant. The old one stops working at once (spec §10.3). */
  app.post('/api/assistance-grants/:id/reissue', async (req, res) => {
    const data = await auditedTx(deps, 'grant.reissue', async (tx, audit) => {
      const now = clock.now();
      const session = await requireSession(tx, req, secret, now);
      audit.actorId = actorIdOf(session);
      requirePersona(session, 'applicant');
      const grant = await requireOwnGrant(tx, session, req.params.id);
      audit.grantId = grant.id;
      parseBody(req, res, EmptyBody);

      switch (effectiveGrantState(grant, now)) {
        case 'issued':
          break;
        case 'active':
          throw apiError('ACTIVE_ASSISTANCE_EXISTS');
        case 'completed':
          throw apiError('ALREADY_SUBMITTED');
        case 'revoked':
          throw apiError('ASSISTANCE_REVOKED');
        case 'expired':
          throw apiError(grant.claimed_helper_id === null ? 'INVITATION_EXPIRED' : 'ACCESS_EXPIRED');
      }

      await tx.run(`UPDATE assistance_grants SET state = 'revoked', revoked_at = ? WHERE id = ?`, [
        now.toISOString(),
        grant.id,
      ]);
      return issueGrant(tx, grant.subject_id, grant.consent_version, now);
    });
    res.status(201).json({ data });
  });

  /**
   * A helper claims a code (spec §10.3). The rows of the redeem table in IMPLEMENTATION.md,
   * in order. A code someone else claimed reveals nothing more, whatever its state.
   */
  app.post('/api/assistance-grants/redeem', async (req, res) => {
    // Checked outside the transaction first, only to key the rate limit by a real session.
    const preCheck = await requireSession(db, req, secret, clock.now());
    requirePersona(preCheck, 'helper');
    if (!redeemLimiter.take(preCheck.id)) throw apiError('RATE_LIMITED');

    const data = await auditedTx(deps, 'grant.redeem', async (tx, audit): Promise<RedeemResponse> => {
      const now = clock.now();
      const session = await requireSession(tx, req, secret, now);
      audit.actorId = actorIdOf(session);
      requirePersona(session, 'helper');
      const { token } = parseBody(req, res, RedeemBody);
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw apiError('INVALID_LINK');

      const grant = await tx.get<GrantRow>(`SELECT ${GRANT_COLUMNS} FROM assistance_grants WHERE token_hash = ?`, [
        hashToken(token),
      ]);
      if (!grant) throw apiError('INVALID_LINK');
      if (grant.claimed_helper_id !== null && grant.claimed_helper_id !== session.helper_id) {
        throw apiError('ALREADY_CLAIMED');
      }
      audit.grantId = grant.id;
      const state = effectiveGrantState(grant, now);

      if (grant.claimed_helper_id !== null) {
        // The same helper scanning again: back to the same case, never a second one.
        if (state === 'revoked') throw apiError('ASSISTANCE_REVOKED');
        if (state === 'expired' || !isWithinAccessWindow(grant.access_expires_at, now)) {
          throw apiError('ACCESS_EXPIRED');
        }
        const existing = await tx.get<{ id: string }>('SELECT id FROM cases WHERE grant_id = ?', [grant.id]);
        if (!existing) throw new Error('A claimed grant has no case');
        audit.caseId = existing.id;
        return {
          grantId: grant.id,
          caseId: existing.id,
          state: state === 'completed' ? 'completed' : 'active',
          accessExpiresAt: grant.access_expires_at,
          serverNow: now.toISOString(),
        };
      }

      if (state === 'expired') throw apiError('INVITATION_EXPIRED');
      if (state !== 'issued') throw apiError('INVALID_LINK');

      // The WHERE clause re-checks the state, so the claim cannot happen twice.
      const claimed = await tx.run(
        `UPDATE assistance_grants SET state = 'active', claimed_helper_id = ?, claimed_at = ?
          WHERE id = ? AND state = 'issued' AND claimed_helper_id IS NULL`,
        [session.helper_id, now.toISOString(), grant.id],
      );
      if (claimed !== 1) throw new Error('Grant changed during redeem');
      const caseId = randomUUID();
      await tx.run(
        `INSERT INTO cases (id, grant_id, schema_version, revision, state, form_data, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'draft', ?, ?, ?)`,
        [caseId, grant.id, SCHEMA_VERSION, JSON.stringify(emptyFormData()), now.toISOString(), now.toISOString()],
      );
      audit.caseId = caseId;
      return {
        grantId: grant.id,
        caseId,
        state: 'active',
        accessExpiresAt: grant.access_expires_at,
        serverNow: now.toISOString(),
      };
    });
    res.json({ data });
  });

  /**
   * "Stop assistance". Works in any state and can be repeated. On a completed grant the
   * receipt stays, and only the helper's read access closes (spec §10.7).
   */
  app.post('/api/assistance-grants/:id/revoke', async (req, res) => {
    const data = await auditedTx(deps, 'grant.revoke', async (tx, audit): Promise<RevokeResponse> => {
      const now = clock.now();
      const session = await requireSession(tx, req, secret, now);
      audit.actorId = actorIdOf(session);
      requirePersona(session, 'applicant');
      const grant = await requireOwnGrant(tx, session, req.params.id);
      audit.grantId = grant.id;
      parseBody(req, res, EmptyBody);
      if (grant.state !== 'revoked') {
        await tx.run(`UPDATE assistance_grants SET state = 'revoked', revoked_at = ? WHERE id = ?`, [
          now.toISOString(),
          grant.id,
        ]);
      }
      return { grantId: grant.id, state: 'revoked', serverNow: now.toISOString() };
    });
    res.json({ data });
  });
}
