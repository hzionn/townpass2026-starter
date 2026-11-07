import { APPLICANT_SUBJECT_ID } from './constants.js';
import type { Sql } from './storage/db.js';

/**
 * The one preloaded applicant. Every value is fictional and obviously so (spec §6.1). It
 * exists to prove that protected data stays on the server: no API response ever includes it.
 */
export const PROTECTED_SEED = {
  name: '虛構長者甲',
  idNumber: 'DEMO-ID-0000',
  phone: '0900000001',
} as const;

export const APPLICANT_PUBLIC_LABEL = '申請者 A';

export async function seedDemoData(tx: Sql): Promise<void> {
  await tx.run(
    `INSERT INTO demo_subjects (id, public_label, protected_seed)
     VALUES (?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [APPLICANT_SUBJECT_ID, APPLICANT_PUBLIC_LABEL, JSON.stringify(PROTECTED_SEED)],
  );
}
