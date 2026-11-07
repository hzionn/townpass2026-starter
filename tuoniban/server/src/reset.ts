import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { seedDemoData } from './seed.js';
import type { BlobStore } from './storage/blobs.js';
import type { Db } from './storage/db.js';

/** Children before parents, so foreign keys never block a delete. */
const TABLES_IN_DELETE_ORDER = [
  'audit_events',
  'submissions',
  'attachments',
  'case_confirmations',
  'cases',
  'assistance_grants',
  'demo_sessions',
  'receipt_counters',
  'demo_subjects',
];

/** Empties every table, seeds the applicant again and removes stored attachment bytes. */
export async function resetDemoData(db: Db, blobs: BlobStore): Promise<void> {
  await db.writeTx(async (tx) => {
    for (const table of TABLES_IN_DELETE_ORDER) await tx.run(`DELETE FROM ${table}`);
    await seedDemoData(tx);
  });
  await blobs.clear();
}

/** Resolves symlinks for the part of the path that exists, so a link cannot sneak past. */
function canonical(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(existing), ...missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(path);
      missing.unshift(relative(parent, existing));
      existing = parent;
    }
  }
}

function isSameOrAncestor(candidate: string, of: string): boolean {
  const path = relative(candidate, of);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/**
 * The reset only deletes files named like storage keys, but a wrong PRIVATE_UPLOAD_DIR is
 * still refused outright: the filesystem root, the home directory, the project root, or any
 * directory containing one of them.
 */
export function assertSafeUploadDir(uploadDir: string, protectedDirs: { home: string; projectRoot: string }): void {
  const dir = canonical(uploadDir);
  const forbidden = ['/', protectedDirs.home, protectedDirs.projectRoot].map(canonical);
  if (forbidden.some((protectedDir) => isSameOrAncestor(dir, protectedDir))) {
    throw new Error(`Refusing to reset: PRIVATE_UPLOAD_DIR points at a protected directory (${dir}).`);
  }
}
