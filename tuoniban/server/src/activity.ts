import type { ActivityEvent, ActivityKind } from '../../shared/contract.js';
import type { Sql } from './storage/db.js';

/** At most this many entries go back; a demo grant lasts an hour, so this is plenty. */
export const MAX_ACTIVITY = 30;

/** Successful audit actions the applicant is shown. grant.create comes from the grant row instead. */
const OK_KINDS: Partial<Record<string, ActivityKind>> = {
  'grant.redeem': 'claimed',
  'case.save_draft': 'draft_saved',
  'attachment.upload': 'attachment_uploaded',
  'attachment.delete': 'attachment_removed',
  'case.submit': 'submitted',
  'grant.revoke': 'stopped',
};

/** Helper actions that, when refused because assistance ended, show as `blocked`. */
const HELPER_ACTIONS = new Set(['grant.redeem', 'case.save_draft', 'attachment.upload', 'attachment.delete', 'case.submit']);
const ENDED_CODES = new Set(['ASSISTANCE_REVOKED', 'ACCESS_EXPIRED']);

/** Happen once per grant: a re-scan, an idempotent re-submit or a repeated stop is not news. */
const ONCE_ONLY = new Set<ActivityKind>(['claimed', 'submitted', 'stopped']);

export interface AuditRow {
  action: string;
  result: string;
  at: string;
}

function kindOf(row: AuditRow): ActivityKind | null {
  if (row.result === 'ok') return OK_KINDS[row.action] ?? null;
  if (HELPER_ACTIONS.has(row.action) && ENDED_CODES.has(row.result)) return 'blocked';
  return null;
}

/**
 * Turns one grant's audit rows (oldest first) into the applicant's timeline, newest first.
 * Only kinds and times leave this function: no actor ids, case ids or error details.
 */
export function buildActivity(grantCreatedAt: string, rows: readonly AuditRow[]): ActivityEvent[] {
  const timeline: ActivityEvent[] = [{ kind: 'code_issued', at: grantCreatedAt, count: 1 }];
  const seen = new Set<ActivityKind>();
  for (const row of rows) {
    const kind = kindOf(row);
    if (!kind) continue;
    if (ONCE_ONLY.has(kind)) {
      if (seen.has(kind)) continue;
      seen.add(kind);
    }
    const last = timeline[timeline.length - 1]!;
    if (last.kind === kind) {
      last.at = row.at;
      last.count += 1;
    } else {
      timeline.push({ kind, at: row.at, count: 1 });
    }
  }
  return timeline.reverse().slice(0, MAX_ACTIVITY);
}

export async function loadActivity(q: Sql, grantId: string, grantCreatedAt: string): Promise<ActivityEvent[]> {
  const rows = await q.all<AuditRow>(
    `SELECT action, result, at FROM audit_events WHERE grant_id = ? ORDER BY at, id`,
    [grantId],
  );
  return buildActivity(grantCreatedAt, rows);
}
