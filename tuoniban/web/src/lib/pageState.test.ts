import { describe, expect, it } from 'vitest';
import type { ApiErrorCode } from '../../../shared/contract';
import { ApiError, NetworkError } from '../api/client';
import { S07_COPY, kindFromError } from './pageState';

function apiError(status: number, code: ApiErrorCode): ApiError {
  return new ApiError(status, code, 'message');
}

describe('S07 mapping', () => {
  it.each([
    [400, 'INVALID_LINK', 'invalid'],
    [410, 'INVITATION_EXPIRED', 'expired'],
    [410, 'ACCESS_EXPIRED', 'expired'],
    [409, 'ALREADY_CLAIMED', 'claimed'],
    [403, 'ASSISTANCE_REVOKED', 'revoked'],
    [404, 'NOT_FOUND', 'not_found'],
    [503, 'TEMPORARY_ERROR', 'network'],
    [500, 'TEMPORARY_ERROR', 'network'],
    [429, 'RATE_LIMITED', 'network'],
  ] as const)('%i %s shows %s', (status, code, kind) => {
    expect(kindFromError(apiError(status, code))).toBe(kind);
  });

  it('shows the network state for a failed or timed-out request', () => {
    expect(kindFromError(new NetworkError(false))).toBe('network');
    expect(kindFromError(new NetworkError(true))).toBe('network');
  });

  it('leaves errors the screen handles in place, and lost sessions, to their own code', () => {
    expect(kindFromError(apiError(409, 'VERSION_CONFLICT'))).toBeNull();
    expect(kindFromError(apiError(422, 'VALIDATION_FAILED'))).toBeNull();
    expect(kindFromError(apiError(401, 'SESSION_REQUIRED'))).toBeNull();
    expect(kindFromError(apiError(403, 'ACTION_FORBIDDEN'))).toBeNull();
  });

  it('uses the spec and wireframe copy', () => {
    expect(S07_COPY.revoked.title).toBe('這次協助已停止');
    expect(S07_COPY.invalid).toMatchObject({ title: '這不是可用的協助碼', primary: 'rescan' });
    expect(S07_COPY.expired).toMatchObject({ title: '協助已到期', primary: 'home' });
    expect(S07_COPY.claimed).toMatchObject({ title: '這個協助碼已被領取', primary: 'rescan' });
    expect(S07_COPY.network).toMatchObject({ title: '暫時連不上', primary: 'retry' });
    expect(S07_COPY.not_found).toMatchObject({ title: '找不到可存取的申請', primary: 'rescan' });
  });
});
