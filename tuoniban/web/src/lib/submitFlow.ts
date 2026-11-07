/**
 * The S05 submit, whose rule is: while the outcome is unknown, never make up a new
 * idempotency key, and never claim success or failure (spec §4.2, §10.6).
 *
 * The key is created once per attempt and thrown away only when the server has told us the
 * attempt did not happen. If the request times out, we ask the server (GET) before anything else.
 */
import { ref } from 'vue';
import type { FieldErrors, HelperCaseResponse, SubmitRequest } from '../../../shared/contract';
import { ApiError, isOutcomeUnknown } from '../api/client';

export type SubmitPhase =
  /** Ready to submit. */
  | 'idle'
  | 'submitting'
  /** 正在確認送出結果: asking the server what happened. */
  | 'checking'
  /** The case is confirmed still a draft: retry with the same key. */
  | 'retry'
  /** The check failed too: stay here with a check-again button. */
  | 'unknown'
  /** The case changed underneath us: the summary must be reloaded first. */
  | 'conflict';

export type SubmitOutcome =
  | { kind: 'submitted' }
  | { kind: 'validation'; fieldErrors: FieldErrors }
  | { kind: 'conflict' }
  | { kind: 'retry' }
  | { kind: 'unknown' }
  /** Stopped, expired, gone, or anything else the screen must show instead of the form. */
  | { kind: 'blocked'; error: unknown };

export interface SubmitFlowDeps {
  submit: (body: SubmitRequest) => Promise<unknown>;
  getCase: () => Promise<HelperCaseResponse>;
  newKey: () => string;
}

export function createSubmitFlow(deps: SubmitFlowDeps) {
  const phase = ref<SubmitPhase>('idle');
  let key: string | null = null;
  let revisionSent: number | null = null;

  async function check(): Promise<SubmitOutcome> {
    phase.value = 'checking';
    try {
      const data = await deps.getCase();
      if (data.state === 'submitted') return { kind: 'submitted' };
      if (data.revision !== revisionSent) {
        // Another tab moved the draft on, so our attempt can no longer succeed: it is safe to drop the key.
        key = null;
        phase.value = 'conflict';
        return { kind: 'conflict' };
      }
      phase.value = 'retry';
      return { kind: 'retry' };
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        phase.value = 'unknown';
        return { kind: 'unknown' };
      }
      return { kind: 'blocked', error };
    }
  }

  async function submit(revision: number): Promise<SubmitOutcome> {
    if (phase.value !== 'idle' && phase.value !== 'retry') return { kind: 'retry' };

    key ??= deps.newKey();
    revisionSent = revision;
    phase.value = 'submitting';
    try {
      await deps.submit({ expectedRevision: revision, idempotencyKey: key });
      return { kind: 'submitted' };
    } catch (error) {
      if (isOutcomeUnknown(error)) return await check();
      if (error instanceof ApiError) {
        switch (error.code) {
          case 'ALREADY_SUBMITTED':
          case 'IDEMPOTENCY_CONFLICT':
            return await check();
          case 'VERSION_CONFLICT':
            key = null;
            phase.value = 'conflict';
            return { kind: 'conflict' };
          case 'VALIDATION_FAILED':
            key = null;
            phase.value = 'idle';
            return { kind: 'validation', fieldErrors: error.fieldErrors };
          case 'RATE_LIMITED':
            // Refused before processing, so the same key is still right for the retry.
            phase.value = 'retry';
            return { kind: 'retry' };
          default:
        }
      }
      return { kind: 'blocked', error };
    }
  }

  /** After the summary was reloaded from the server: the old attempt no longer matters. */
  function reset(): void {
    key = null;
    revisionSent = null;
    phase.value = 'idle';
  }

  return { phase, submit, check, reset };
}
