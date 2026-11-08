/**
 * The storage boundary. Business logic writes one SQL dialect against this interface:
 * `?` placeholders, TEXT timestamps, TEXT JSON, INTEGER numbers. SQLite and Postgres
 * differ only in the adapter behind it.
 */
export type SqlValue = string | number | null | Uint8Array;

export interface Sql {
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  /** Returns the number of affected rows. */
  run(sql: string, params?: readonly SqlValue[]): Promise<number>;
}

export interface Db extends Sql {
  readonly kind: 'sqlite' | 'postgres';
  /**
   * Runs `fn` in a transaction, with every write transaction in the system queued one at
   * a time, so "submit" and "revoke" can never interleave (spec §10.7).
   *
   * Inside `fn`, use only the `tx` argument. Calling back into the `Db` would wait for a
   * queue slot or pool client that this transaction is holding.
   */
  writeTx<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  /** Which database this is, for operators. Never includes a password. */
  describe(): string;
  close(): Promise<void>;
}
