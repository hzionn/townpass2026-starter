import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api, isAccessLost, isOutcomeUnknown, setAccessLostHandler } from './client';

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function html(status: number): Response {
  return new Response('<!doctype html><title>502 Bad Gateway</title>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the request to fail');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchMock.mockReset();
  setAccessLostHandler(() => {});
});

describe('api client', () => {
  it('unwraps { data } and keeps data: null as a real answer', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: null }));
    await expect(api.getMyAssistance()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/my-assistance', expect.objectContaining({ method: 'GET' }));
  });

  it('sends JSON bodies with a content type, same-origin', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { persona: 'helper' } }));
    await api.createDemoSession('helper');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.body).toBe('{"persona":"helper"}');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.credentials).toBe('same-origin');
  });

  it('turns the error envelope into an ApiError with code, message and field errors', async () => {
    fetchMock.mockResolvedValueOnce(
      json(422, {
        error: {
          code: 'VALIDATION_FAILED',
          message: '請確認必填內容與練習附件。',
          fieldErrors: { preferredDate: '請選擇明日起 30 天內的日期。' },
        },
      }),
    );
    const error = await caught(api.saveDraft('case-1', { expectedRevision: 1, formData: {} as never }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: '請確認必填內容與練習附件。',
      fieldErrors: { preferredDate: '請選擇明日起 30 天內的日期。' },
    });
  });

  it('never parses an HTML error page as JSON', async () => {
    fetchMock.mockResolvedValueOnce(html(502));
    const error = await caught(api.getMyAssistance());
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'TEMPORARY_ERROR' });
    expect(isOutcomeUnknown(error)).toBe(true);
  });

  it('maps a host-level HTML 413 to FILE_TOO_LARGE', async () => {
    fetchMock.mockResolvedValueOnce(html(413));
    const error = await caught(api.uploadAttachment('case-1', new File(['x'], 'a.pdf'), 3));
    expect(error).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
  });

  it('treats a 200 without our envelope as not our API', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>tunnel warning</html>', { status: 200 }));
    expect(await caught(api.getMyAssistance())).toMatchObject({ code: 'TEMPORARY_ERROR' });
  });

  it('treats invalid JSON under a JSON content type as a temporary error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"data":', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(await caught(api.getMyAssistance())).toMatchObject({ code: 'TEMPORARY_ERROR' });
  });

  it('reports a failed fetch as a NetworkError, distinct from ApiError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await caught(api.getMyAssistance());
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ timedOut: false });
    expect(isOutcomeUnknown(error)).toBe(true);
  });

  it('aborts after the timeout and reports it as a NetworkError', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = caught(api.submit('case-1', { expectedRevision: 3, idempotencyKey: 'k' }));
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await pending;
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ timedOut: true });
  });

  it('sends the upload as multipart with the fields before the file', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { attachment: null, revision: 4 } }));
    await api.uploadAttachment('case-1', new File(['%PDF'], 'x.pdf', { type: 'application/pdf' }), 3);
    const body = fetchMock.mock.calls[0]![1]?.body as FormData;
    expect([...body.keys()]).toEqual(['requirementId', 'expectedRevision', 'file']);
    expect(body.get('expectedRevision')).toBe('3');
  });

  it('calls the access-lost handler on 401, except for GET /api/session', async () => {
    const handler = vi.fn();
    setAccessLostHandler(handler);

    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'SESSION_REQUIRED', message: '請重新進入' } }));
    const quiet = await caught(api.getSession());
    expect(isAccessLost(quiet)).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'SESSION_REQUIRED', message: '請重新進入' } }));
    await caught(api.getMyAssistance());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('refuses to hand an applicant-shaped case to a helper page', async () => {
    const handler = vi.fn();
    setAccessLostHandler(handler);
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { caseId: 'case-1', state: 'draft', serviceName: 'x', receipt: null } }),
    );
    const error = await caught(api.getHelperCase('case-1'));
    expect(error).toMatchObject({ code: 'ACTION_FORBIDDEN' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('encodes ids in paths', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { grantId: 'a/b', state: 'revoked', serverNow: '' } }));
    await api.revokeGrant('a/b');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/assistance-grants/a%2Fb/revoke');
  });
});
