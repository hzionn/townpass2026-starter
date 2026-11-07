import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseCookie, stringifySetCookie } from 'cookie';
import type { Request } from 'express';
import type { Persona } from '../../shared/contract.js';
import type { AppConfig } from './config.js';
import { SESSION_HOURS } from './constants.js';
import { apiError } from './errors.js';
import type { Sql } from './storage/db.js';

const SESSION_COOKIE = 'tuoniban_session';

export interface SessionRow {
  id: string;
  persona: Persona;
  subject_id: string | null;
  helper_id: string | null;
  expires_at: string;
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

function sign(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

/** Cookie value is `random id.HMAC`. The session data itself stays on the server (spec §8). */
export function sessionCookieHeader(sessionId: string, config: Pick<AppConfig, 'sessionSecret' | 'cookieSecure'>): string {
  return stringifySetCookie({
    name: SESSION_COOKIE,
    value: `${sessionId}.${sign(sessionId, config.sessionSecret)}`,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

/** Returns the session id only if the signature checks out, so forged ids never reach the database. */
function readSessionId(req: Request, secret: string): string | null {
  const value = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const sessionId = value.slice(0, separator);
  const given = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(sign(sessionId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? sessionId : null;
}

export async function findSession(q: Sql, req: Request, secret: string, now: Date): Promise<SessionRow | undefined> {
  const sessionId = readSessionId(req, secret);
  if (sessionId === null) return undefined;
  const row = await q.get<SessionRow>(
    'SELECT id, persona, subject_id, helper_id, expires_at FROM demo_sessions WHERE id = ?',
    [sessionId],
  );
  return row && now.toISOString() < row.expires_at ? row : undefined;
}

export async function requireSession(q: Sql, req: Request, secret: string, now: Date): Promise<SessionRow> {
  const session = await findSession(q, req, secret, now);
  if (!session) throw apiError('SESSION_REQUIRED');
  return session;
}

/** Authorisation looks only at the server-side persona, never at anything in the request body. */
export function requirePersona(session: SessionRow, persona: Persona): void {
  if (session.persona !== persona) throw apiError('ACTION_FORBIDDEN');
}

/** Who the audit log records for this session. */
export function actorIdOf(session: SessionRow): string {
  return (session.persona === 'applicant' ? session.subject_id : session.helper_id) ?? 'unknown';
}
