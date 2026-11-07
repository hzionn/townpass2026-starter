import { shallowRef } from 'vue';
import type { Persona, SessionResponse } from '../../../shared/contract';
import { ApiError, api } from '../api/client';
import { clearIssuedToken } from './issuedToken';
import { clearPendingFieldErrors } from './pendingErrors';
import { clearService } from './service';

/** What the server last told us about this browser's demo session. The server stays the authority. */
export const session = shallowRef<SessionResponse | null>(null);

function clearClientCaches(): void {
  clearIssuedToken();
  clearService();
  clearPendingFieldErrors();
}

/** A 401 is a normal answer here: this browser has not chosen a demo role yet. */
export async function refreshSession(): Promise<SessionResponse | null> {
  try {
    session.value = await api.getSession();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
    session.value = null;
  }
  return session.value;
}

/** Creates or switches the demo session (spec §10.2). */
export async function enterAs(persona: Persona): Promise<void> {
  const previous = session.value;
  const created = await api.createDemoSession(persona);
  if (previous?.persona !== persona) clearClientCaches();
  session.value = { ...created, recentCaseId: previous?.recentCaseId ?? null };
}

/** The session is gone or has the wrong persona: forget it, and everything derived from it. */
export function forgetSession(): void {
  session.value = null;
  clearClientCaches();
}
