import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Db, Sql, SqlValue } from './db.js';

/**
 * SQLite through the built-in `node:sqlite`.
 *
 * The driver is one synchronous connection. Without a queue, an `await` inside a
 * transaction would let another request's statements run inside that transaction, so
 * every operation, reads included, takes its turn in a single promise queue.
 */
export async function openSqlite(databasePath: string): Promise<Db> {
  // Loaded here rather than at the top of the file so a bundled Postgres deployment
  // never touches node:sqlite.
  const { DatabaseSync } = await import('node:sqlite');

  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(databasePath);
  connection.exec('PRAGMA journal_mode = WAL');
  connection.exec('PRAGMA busy_timeout = 5000');
  connection.exec('PRAGMA foreign_keys = ON');

  const direct: Sql = {
    all: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      connection.prepare(sql).all(...params) as T[],
    get: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      connection.prepare(sql).get(...params) as T | undefined,
    run: async (sql: string, params: readonly SqlValue[] = []) =>
      Number(connection.prepare(sql).run(...params).changes),
  };

  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job);
    tail = result.catch(() => undefined);
    return result;
  }

  return {
    kind: 'sqlite',
    all: (sql, params) => enqueue(() => direct.all(sql, params)),
    get: (sql, params) => enqueue(() => direct.get(sql, params)),
    run: (sql, params) => enqueue(() => direct.run(sql, params)),
    writeTx: (fn) =>
      enqueue(async () => {
        connection.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(direct);
          connection.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            connection.exec('ROLLBACK');
          } catch {
            // SQLite may already have rolled back on its own. Report the original error.
          }
          throw err;
        }
      }),
    describe: () => `sqlite:${databasePath}`,
    close: () => enqueue(async () => connection.close()),
  };
}
