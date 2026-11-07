import type { Pool, PoolClient, QueryConfigValues } from 'pg';
import { safeErrorFields, type Logger } from '../logger.js';
import type { Db, Sql, SqlValue } from './db.js';

/** Any fixed number works, as long as every writer uses the same one. */
const WRITE_LOCK_ID = 20261107;

/** Translates `?` to `$1`, `$2`, … leaving quoted SQL strings alone. */
export function toPgPlaceholders(sql: string): string {
  let index = 0;
  let inString = false;
  let out = '';
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    out += ch === '?' && !inString ? `$${++index}` : ch;
  }
  return out;
}

function sqlOn(target: Pool | PoolClient): Sql {
  const query = async (sql: string, params: readonly SqlValue[] = []) =>
    target.query(toPgPlaceholders(sql), params as QueryConfigValues<unknown[]>);
  return {
    all: async <T>(sql: string, params?: readonly SqlValue[]) => (await query(sql, params)).rows as T[],
    get: async <T>(sql: string, params?: readonly SqlValue[]) => (await query(sql, params)).rows[0] as T | undefined,
    run: async (sql: string, params?: readonly SqlValue[]) => (await query(sql, params)).rowCount ?? 0,
  };
}

/** host:port/database only. The connection string itself holds the password. */
function describeTarget(databaseUrl: string): string {
  try {
    const { hostname, port, pathname } = new URL(databaseUrl);
    return `postgres:${hostname}${port ? `:${port}` : ''}${pathname}`;
  } catch {
    return 'postgres:(unparsable URL)';
  }
}

/**
 * Postgres for hosts without a persistent disk. The pool is small because serverless
 * platforms run many instances and hosted databases cap connections.
 *
 * Writes are serialised with a transaction-scoped advisory lock: Postgres releases it on
 * commit, rollback or a dropped connection, so a crash cannot leave it stuck.
 */
export async function openPostgres(databaseUrl: string, logger: Logger): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  // Without these listeners, a dropped connection would crash the whole process.
  const onConnectionError = (err: Error) => logger.error('postgres_connection_error', safeErrorFields(err));
  pool.on('error', onConnectionError);

  const direct = sqlOn(pool);

  return {
    kind: 'postgres',
    ...direct,
    writeTx: async (fn) => {
      const client = await pool.connect();
      client.on('error', onConnectionError);
      let rollbackFailure: Error | undefined;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK_ID]);
        const result = await fn(sqlOn(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          rollbackFailure = rollbackErr as Error;
        }
        throw err;
      } finally {
        client.removeListener('error', onConnectionError);
        // Passing an error makes the pool discard this connection instead of reusing it.
        client.release(rollbackFailure);
      }
    },
    describe: () => describeTarget(databaseUrl),
    close: () => pool.end(),
  };
}
