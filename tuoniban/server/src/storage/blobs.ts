import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db.js';

/**
 * Where attachment bytes live. Nothing exposes these over HTTP (spec §6.3).
 *
 * Upload writes the blob first and then the metadata; delete does the reverse. Metadata is
 * the source of truth and never points at a blob that was not stored. The worst a crash
 * can leave behind is an orphan blob, which is harmless.
 */
export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

const STORAGE_KEY_PATTERN = /^blob-[0-9a-f]{48}$/;

/** Server-random and never derived from a filename (spec §6.3). */
export function newStorageKey(): string {
  return `blob-${randomBytes(24).toString('hex')}`;
}

export function isStorageKey(name: string): boolean {
  return STORAGE_KEY_PATTERN.test(name);
}

/** SQLite mode: one file per attachment, mode 0600 in a 0700 directory. */
export class FileBlobStore implements BlobStore {
  readonly #dir: string;

  private constructor(dir: string) {
    this.#dir = dir;
  }

  static async open(dir: string): Promise<FileBlobStore> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    return new FileBlobStore(dir);
  }

  #path(key: string): string {
    if (!isStorageKey(key)) throw new Error('Refusing an invalid storage key');
    return join(this.#dir, key);
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await writeFile(this.#path(key), bytes, { mode: 0o600, flag: 'wx' });
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }

  /** Removes only files named like storage keys, so a misconfigured directory survives. */
  async clear(): Promise<void> {
    const names = await readdir(this.#dir);
    await Promise.all(names.filter(isStorageKey).map((name) => rm(join(this.#dir, name), { force: true })));
  }
}

/** Postgres mode: bytes in a private table, because these hosts have no persistent disk. */
export class DatabaseBlobStore implements BlobStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.#db.run('INSERT INTO attachment_blobs (storage_key, bytes) VALUES (?, ?)', [key, bytes]);
  }

  async delete(key: string): Promise<void> {
    await this.#db.run('DELETE FROM attachment_blobs WHERE storage_key = ?', [key]);
  }

  async clear(): Promise<void> {
    await this.#db.run('DELETE FROM attachment_blobs');
  }
}
