import { DISTRICTS, type Plan } from '../domain/models.ts';
import { evaluateGuidance } from '../domain/guidance.ts';

export const PLAN_KEY = 'carepass.plan.v1';
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type Restore = { plan: Plan | null; issue: 'unavailable' | 'invalid' | null };

export function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Plan;
  if (p.schemaVersion !== 1 || typeof p.ruleVersion !== 'string' || typeof p.dataVersion !== 'string' || typeof p.summary !== 'string' || typeof p.updatedAt !== 'string' || !Number.isFinite(Date.parse(p.updatedAt))) return false;
  const a = p.answers;
  if (!a || ![...DISTRICTS, 'other', 'unknown'].includes(a.district) || !['home', 'other', 'unknown'].includes(a.need) || !['yes', 'no', 'unknown'].includes(a.hasCare) || !['', 'yes', 'no', 'unknown'].includes(a.hasManager) || typeof a.preferredTime !== 'string' || a.preferredTime.length > 120) return false;
  try { if (evaluateGuidance(a).id !== p.ruleId) return false; } catch { return false; }
  if (!Array.isArray(p.tasks) || p.tasks.length !== 4 || new Set(p.tasks.map(t => t?.id)).size !== p.tasks.length || !p.tasks.every(t => t && typeof t.id === 'string' && typeof t.title === 'string' && ['todo', 'waiting', 'done'].includes(t.status))) return false;
  if (p.provider !== null && (!p.provider || !['id', 'name', 'phone', 'extension'].every(k => typeof p.provider?.[k as keyof NonNullable<Plan['provider']>] === 'string'))) return false;
  return true;
}

export function restorePlan(storage: StoragePort): Restore {
  try {
    const raw = storage.getItem(PLAN_KEY);
    if (!raw) return { plan: null, issue: null };
    const value: unknown = JSON.parse(raw);
    return isPlan(value) ? { plan: value, issue: null } : { plan: null, issue: 'invalid' };
  } catch (error) {
    return { plan: null, issue: error instanceof SyntaxError ? 'invalid' : 'unavailable' };
  }
}
export function savePlan(storage: StoragePort, plan: Plan): boolean {
  try { storage.setItem(PLAN_KEY, JSON.stringify(plan)); return true; } catch { return false; }
}
export function clearPlan(storage: StoragePort): boolean {
  try { storage.removeItem(PLAN_KEY); return true; } catch { return false; }
}
