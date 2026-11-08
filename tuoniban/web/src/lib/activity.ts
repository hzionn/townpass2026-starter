import type { ActivityEvent, ActivityKind } from '../../../shared/contract';

const LABELS: Record<ActivityKind, string> = {
  code_issued: '你產生了協助碼',
  claimed: '代辦者領取協助碼，開始協助',
  draft_saved: '代辦者儲存草稿',
  attachment_uploaded: '代辦者上傳練習附件',
  attachment_removed: '代辦者移除練習附件',
  confirmation_requested: '代辦者請你確認內容',
  confirmed: '你確認了內容',
  returned: '你退回內容，請代辦者修改',
  submitted: '代辦者模擬送出',
  stopped: '你停止了協助',
  blocked: '協助結束後代辦者仍嘗試操作，系統已擋下',
};

/** One line of the applicant's activity log, e.g. 代辦者儲存草稿（3 次）. */
export function activityLabel(event: ActivityEvent): string {
  const label = LABELS[event.kind];
  return event.count > 1 ? `${label}（${event.count} 次）` : label;
}

/** Entries that deserve a warning look: someone tried to act after assistance ended. */
export function isWarningActivity(event: ActivityEvent): boolean {
  return event.kind === 'blocked';
}
