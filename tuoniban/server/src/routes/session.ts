import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { DemoSessionResponse, Persona, SessionResponse } from '../../../shared/contract.js';
import { APPLICANT_SUBJECT_ID, HELPER_PUBLIC_LABEL, SESSION_HOURS } from '../constants.js';
import type { AppDeps } from '../deps.js';
import { isWithinAccessWindow } from '../grant-rules.js';
import { DemoSessionBody, parseBody } from '../http/json-body.js';
import { findSession, newSessionId, requireSession, sessionCookieHeader } from '../session.js';
import type { Sql } from '../storage/db.js';

async function publicLabelFor(q: Sql, persona: Persona): Promise<string> {
  if (persona === 'helper') return HELPER_PUBLIC_LABEL;
  const subject = await q.get<{ public_label: string }>('SELECT public_label FROM demo_subjects WHERE id = ?', [
    APPLICANT_SUBJECT_ID,
  ]);
  return subject?.public_label ?? '';
}

/**
 * The latest case this browser's helper identity can still open, whatever the current
 * persona (IMPLEMENTATION.md). Grants are issued one at a time, so the newest one is the
 * only candidate: older ones closed earlier.
 */
async function recentCaseIdFor(q: Sql, helperId: string | null, now: Date): Promise<string | null> {
  if (helperId === null) return null;
  const row = await q.get<{ case_id: string; access_expires_at: string }>(
    `SELECT c.id AS case_id, g.access_expires_at
       FROM assistance_grants g
       JOIN cases c ON c.grant_id = g.id
      WHERE g.claimed_helper_id = ? AND g.state IN ('active', 'completed')
      ORDER BY g.issue_seq DESC
      LIMIT 1`,
    [helperId],
  );
  return row && isWithinAccessWindow(row.access_expires_at, now) ? row.case_id : null;
}

export function registerSessionRoutes(app: Express, deps: AppDeps): void {
  const { config, db, clock } = deps;

  /**
   * Creates a demo session, or switches the persona of the existing one. Switching keeps the
   * same row, so this browser's helper identity, and its case, survive (spec §10.2).
   */
  app.post('/api/demo/session', async (req, res) => {
    const { persona } = parseBody(req, res, DemoSessionBody);
    const { sessionId, data } = await db.writeTx(async (tx) => {
      const now = clock.now();
      const existing = await findSession(tx, req, config.sessionSecret, now);
      const sessionId = existing?.id ?? newSessionId();
      const helperId = persona === 'helper' ? (existing?.helper_id ?? randomUUID()) : (existing?.helper_id ?? null);
      const subjectId = persona === 'applicant' ? APPLICANT_SUBJECT_ID : (existing?.subject_id ?? null);
      const nowIso = now.toISOString();
      const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60_000).toISOString();
      await tx.run(
        `INSERT INTO demo_sessions (id, persona, subject_id, helper_id, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           persona = excluded.persona,
           subject_id = excluded.subject_id,
           helper_id = excluded.helper_id,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
        [sessionId, persona, subjectId, helperId, expiresAt, nowIso, nowIso],
      );
      const data: DemoSessionResponse = { persona, publicLabel: await publicLabelFor(tx, persona), serverNow: nowIso };
      return { sessionId, data };
    });
    res.append('Set-Cookie', sessionCookieHeader(sessionId, config));
    res.json({ data });
  });

  app.get('/api/session', async (req, res) => {
    const now = clock.now();
    const session = await requireSession(db, req, config.sessionSecret, now);
    const data: SessionResponse = {
      persona: session.persona,
      publicLabel: await publicLabelFor(db, session.persona),
      recentCaseId: await recentCaseIdFor(db, session.helper_id, now),
      serverNow: now.toISOString(),
    };
    res.json({ data });
  });
}
