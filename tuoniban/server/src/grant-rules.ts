import type { GrantState } from '../../shared/contract.js';
import { apiError } from './errors.js';

/** The grant columns that decide what it allows right now. */
export interface GrantTiming {
  state: GrantState;
  claim_expires_at: string;
  access_expires_at: string;
}

/**
 * Expiry never relies on a scheduled job: every request works it out from the server clock
 * (spec §7.1). The database may still say `issued` or `active` for a grant that has really
 * expired. At the exact expiry instant the grant counts as expired.
 *
 * All timestamps come from toISOString(), so comparing the strings compares the times.
 */
export function effectiveGrantState(grant: GrantTiming, now: Date): GrantState {
  const current = now.toISOString();
  if (grant.state === 'issued' && current >= grant.claim_expires_at) return 'expired';
  if (grant.state === 'active' && current >= grant.access_expires_at) return 'expired';
  return grant.state;
}

export function isWithinAccessWindow(accessExpiresAt: string, now: Date): boolean {
  return now.toISOString() < accessExpiresAt;
}

/**
 * The gate for a helper who is bound to this grant. Revoked is checked first, because
 * "the applicant stopped this" is the more useful answer. A completed grant keeps the
 * receipt readable only until the original access window closes (spec §7.1).
 */
export function assertHelperGrantOpen(grant: GrantTiming, now: Date): void {
  if (grant.state === 'revoked') throw apiError('ASSISTANCE_REVOKED');
  if (effectiveGrantState(grant, now) === 'expired' || !isWithinAccessWindow(grant.access_expires_at, now)) {
    throw apiError('ACCESS_EXPIRED');
  }
}
