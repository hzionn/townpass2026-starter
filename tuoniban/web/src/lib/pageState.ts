/** S07: the shared full-page states (spec §5 S07), and which errors lead to which state. */
import { ApiError } from '../api/client';

export type S07Kind = 'invalid' | 'expired' | 'claimed' | 'revoked' | 'network' | 'not_found';

export type S07Action = 'retry' | 'rescan' | 'home';

export interface S07Copy {
  title: string;
  statement: string;
  detail?: string;
  primary: S07Action;
  secondary?: S07Action;
}

export const S07_COPY: Record<S07Kind, S07Copy> = {
  invalid: {
    title: '這不是可用的協助碼',
    statement: '請使用本人提供的託你辦連結。',
    primary: 'rescan',
    secondary: 'home',
  },
  expired: {
    title: '協助已到期',
    statement: '請本人重新產生協助碼。',
    primary: 'home',
    secondary: 'rescan',
  },
  claimed: {
    title: '這個協助碼已被領取',
    statement: '無法從這台裝置接續。',
    detail: '若要換人協助，請本人停止原協助後另產協助碼。',
    primary: 'rescan',
    secondary: 'home',
  },
  revoked: {
    title: '這次協助已停止',
    statement: '本人已停止這次協助，目前不能繼續操作。',
    detail: '已送出的內容不會自動撤回。若仍需要協助，請本人另產協助碼。',
    primary: 'home',
  },
  network: {
    title: '暫時連不上',
    statement: '已儲存的草稿仍保留。',
    detail: '請確認網路後再試一次。',
    primary: 'retry',
    secondary: 'home',
  },
  not_found: {
    title: '找不到可存取的申請',
    statement: '請重新開啟協助。',
    primary: 'rescan',
    secondary: 'home',
  },
};

export const S07_ACTION_LABEL: Record<S07Action, string> = {
  retry: '重試',
  rescan: '重新掃碼',
  home: '返回首頁',
};

/**
 * Which S07 state an error should show. Returns null when it is not a page-level state:
 * either the screen handles it in place (VERSION_CONFLICT, VALIDATION_FAILED…), or the
 * client is already on its way home (401, wrong persona).
 */
export function kindFromError(error: unknown): S07Kind | null {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case 'INVALID_LINK':
      return 'invalid';
    case 'INVITATION_EXPIRED':
    case 'ACCESS_EXPIRED':
      return 'expired';
    case 'ALREADY_CLAIMED':
      return 'claimed';
    case 'ASSISTANCE_REVOKED':
      return 'revoked';
    case 'NOT_FOUND':
      return 'not_found';
    case 'TEMPORARY_ERROR':
    case 'RATE_LIMITED':
      return 'network';
    default:
      return error.status >= 500 ? 'network' : null;
  }
}
