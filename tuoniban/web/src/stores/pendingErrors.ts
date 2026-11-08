import type { FieldErrors } from '../../../shared/contract';

/** Hands the server's field errors from S05 back to S04, so S04 can show and focus them. */
let pending: { caseId: string; errors: FieldErrors } | null = null;

export function setPendingFieldErrors(caseId: string, errors: FieldErrors): void {
  pending = { caseId, errors };
}

export function takePendingFieldErrors(caseId: string): FieldErrors | null {
  if (pending?.caseId !== caseId) return null;
  const { errors } = pending;
  pending = null;
  return errors;
}

export function clearPendingFieldErrors(): void {
  pending = null;
}
