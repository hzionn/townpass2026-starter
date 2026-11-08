import { describe, expect, it, vi } from 'vitest';
import type { HelperCaseResponse, SubmitRequest } from '../../../shared/contract';
import { ApiError, NetworkError } from '../api/client';
import { createSubmitFlow } from './submitFlow';

function caseAt(revision: number, state: 'draft' | 'submitted' = 'draft'): HelperCaseResponse {
  return { revision, state, canEdit: state === 'draft' } as HelperCaseResponse;
}

function setup() {
  let keys = 0;
  const submit = vi.fn<(body: SubmitRequest) => Promise<unknown>>();
  const getCase = vi.fn<() => Promise<HelperCaseResponse>>();
  const flow = createSubmitFlow({ submit, getCase, newKey: () => `key-${++keys}` });
  const keysSent = () => submit.mock.calls.map(([body]) => body.idempotencyKey);
  return { flow, submit, getCase, keysSent };
}

describe('S05 submit', () => {
  it('submits once with the current revision', async () => {
    const { flow, submit } = setup();
    submit.mockResolvedValueOnce({});
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'submitted' });
    expect(submit).toHaveBeenCalledWith({ expectedRevision: 3, idempotencyKey: 'key-1' });
  });

  it('after a timeout, asks the server first, then retries with the same key', async () => {
    const { flow, submit, getCase, keysSent } = setup();
    submit.mockRejectedValueOnce(new NetworkError(true));
    getCase.mockResolvedValueOnce(caseAt(3));

    await expect(flow.submit(3)).resolves.toEqual({ kind: 'retry' });
    expect(getCase).toHaveBeenCalledTimes(1);
    expect(flow.phase.value).toBe('retry');

    submit.mockResolvedValueOnce({});
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'submitted' });
    expect(keysSent()).toEqual(['key-1', 'key-1']);
  });

  it('goes to the result when the lost request had in fact succeeded', async () => {
    const { flow, submit, getCase } = setup();
    submit.mockRejectedValueOnce(new NetworkError(false));
    getCase.mockResolvedValueOnce(caseAt(4, 'submitted'));
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'submitted' });
  });

  it('treats a 5xx as an unknown outcome too', async () => {
    const { flow, submit, getCase } = setup();
    submit.mockRejectedValueOnce(new ApiError(502, 'TEMPORARY_ERROR', 'x'));
    getCase.mockResolvedValueOnce(caseAt(3));
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'retry' });
  });

  it('stays unknown when the check fails as well, and keeps the key for later', async () => {
    const { flow, submit, getCase, keysSent } = setup();
    submit.mockRejectedValueOnce(new NetworkError(true));
    getCase.mockRejectedValueOnce(new NetworkError(false));

    await expect(flow.submit(3)).resolves.toEqual({ kind: 'unknown' });
    expect(flow.phase.value).toBe('unknown');

    // Submitting is not offered while the outcome is unknown.
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'retry' });
    expect(submit).toHaveBeenCalledTimes(1);

    getCase.mockResolvedValueOnce(caseAt(3));
    await expect(flow.check()).resolves.toEqual({ kind: 'retry' });
    submit.mockResolvedValueOnce({});
    await flow.submit(3);
    expect(keysSent()).toEqual(['key-1', 'key-1']);
  });

  it('ignores a second press while submitting', async () => {
    const { flow, submit } = setup();
    let finish: (value: unknown) => void = () => {};
    submit.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const first = flow.submit(3);
    await flow.submit(3);
    expect(submit).toHaveBeenCalledTimes(1);
    finish({});
    await expect(first).resolves.toEqual({ kind: 'submitted' });
  });

  it('checks the case on ALREADY_SUBMITTED, then shows the result', async () => {
    const { flow, submit, getCase } = setup();
    submit.mockRejectedValueOnce(new ApiError(409, 'ALREADY_SUBMITTED', 'x'));
    getCase.mockResolvedValueOnce(caseAt(4, 'submitted'));
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'submitted' });
  });

  it('asks for a reload on VERSION_CONFLICT, and only then uses a new key', async () => {
    const { flow, submit, keysSent } = setup();
    submit.mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', 'x'));
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'conflict' });
    expect(flow.phase.value).toBe('conflict');

    flow.reset(); // after the summary was reloaded
    submit.mockResolvedValueOnce({});
    await flow.submit(4);
    expect(keysSent()).toEqual(['key-1', 'key-2']);
  });

  it('treats a draft at a newer revision as a conflict, not a retry', async () => {
    const { flow, submit, getCase } = setup();
    submit.mockRejectedValueOnce(new NetworkError(true));
    getCase.mockResolvedValueOnce(caseAt(5));
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'conflict' });
  });

  it('returns field errors on VALIDATION_FAILED and starts a new attempt afterwards', async () => {
    const { flow, submit, keysSent } = setup();
    const fieldErrors = { preferredDate: '請選擇明日起 30 天內的日期。' };
    submit.mockRejectedValueOnce(new ApiError(422, 'VALIDATION_FAILED', 'x', fieldErrors));
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'validation', fieldErrors });
    submit.mockResolvedValueOnce({});
    await flow.submit(3);
    expect(keysSent()).toEqual(['key-1', 'key-2']);
  });

  it('keeps the key after RATE_LIMITED, since nothing was processed', async () => {
    const { flow, submit, keysSent } = setup();
    submit.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'x'));
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'retry' });
    submit.mockResolvedValueOnce({});
    await flow.submit(3);
    expect(keysSent()).toEqual(['key-1', 'key-1']);
  });

  it('reports revoked or expired access so the page can show S07', async () => {
    const { flow, submit } = setup();
    const revoked = new ApiError(403, 'ASSISTANCE_REVOKED', 'x');
    submit.mockRejectedValueOnce(revoked);
    await expect(flow.submit(3)).resolves.toEqual({ kind: 'blocked', error: revoked });
  });
});
