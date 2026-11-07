import type { RedeemResponse } from '../../../shared/contract';

export function caseRoute(caseId: string, page: 'edit' | 'review' | 'result'): string {
  return `/cases/${encodeURIComponent(caseId)}/${page}`;
}

/** Spec §5 S03: a fresh or resumed draft goes to the form, a submitted one to its receipt. */
export function routeAfterRedeem(result: RedeemResponse): string {
  return caseRoute(result.caseId, result.state === 'completed' ? 'result' : 'edit');
}
