import { seedDemoData } from '../seed.js';
import type { Db } from './db.js';

/**
 * The data model from spec §9. Written so the same text runs on SQLite and Postgres.
 * Timestamps are TEXT from toISOString(), always the same format. JSON is TEXT, not JSONB,
 * so an escaped \u0000 stays an inert string. Numbers are INTEGER, because Postgres returns
 * BIGINT as a string.
 */
const SHARED_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS demo_subjects (
    id TEXT PRIMARY KEY,
    public_label TEXT NOT NULL,
    protected_seed TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS demo_sessions (
    id TEXT PRIMARY KEY,
    persona TEXT NOT NULL CHECK (persona IN ('applicant', 'helper')),
    subject_id TEXT REFERENCES demo_subjects (id),
    helper_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assistance_grants (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES demo_subjects (id),
    service_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    issue_seq INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    claim_expires_at TEXT NOT NULL,
    access_expires_at TEXT NOT NULL,
    claimed_helper_id TEXT,
    claimed_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('issued', 'active', 'completed', 'revoked', 'expired')),
    consent_version TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE (subject_id, issue_seq)
  )`,
  // "One person and service have at most one open grant" (spec §9), enforced by the database.
  `CREATE UNIQUE INDEX IF NOT EXISTS one_open_grant
    ON assistance_grants (subject_id, service_id)
    WHERE state IN ('issued', 'active')`,
  // The spec's "Application" entity. The API calls it a case.
  `CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL UNIQUE REFERENCES assistance_grants (id),
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('draft', 'submitted')),
    form_data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL UNIQUE REFERENCES cases (id),
    requirement_id TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL UNIQUE REFERENCES cases (id),
    receipt_no TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    submitted_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS receipt_counters (
    day TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    grant_id TEXT,
    case_id TEXT,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
];

const POSTGRES_ONLY_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS attachment_blobs (
    storage_key TEXT PRIMARY KEY,
    bytes BYTEA NOT NULL
  )`,
];

/** Safe to run on every start. On Postgres the write lock also guards concurrent cold starts. */
export async function migrate(db: Db): Promise<void> {
  await db.writeTx(async (tx) => {
    for (const statement of SHARED_STATEMENTS) await tx.run(statement);
    if (db.kind === 'postgres') {
      for (const statement of POSTGRES_ONLY_STATEMENTS) await tx.run(statement);
    }
    await seedDemoData(tx);
  });
}
