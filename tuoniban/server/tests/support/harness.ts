import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig, type AppConfig, type StorageConfig } from '../../src/config.js';
import type { AppDeps } from '../../src/deps.js';
import type { LogFields, Logger } from '../../src/logger.js';
import { resetDemoData } from '../../src/reset.js';
import { isStorageKey } from '../../src/storage/blobs.js';
import { openStorage, type Storage } from '../../src/storage/open.js';
import { migrate } from '../../src/storage/schema.js';
import { Browser } from './browser.js';
import { FakeClock } from './clock.js';
import { startTestPostgres, type TestPostgres } from './postgres.js';

export type AdapterName = 'sqlite' | 'postgres';
export const ADAPTERS: AdapterName[] = ['sqlite', 'postgres'];

export const TEST_ORIGIN = 'http://tuoniban.test';
/** 14:00 on 2026-11-07 in Taipei. */
export const START = '2026-11-07T06:00:00.000Z';
export const TEST_SESSION_SECRET = 'test-session-secret-not-for-production';

export interface LogRecord {
  level: 'info' | 'warn' | 'error';
  event: string;
  fields: LogFields | undefined;
}

export interface AppOverrides {
  config?: Partial<AppConfig>;
  deps?: Partial<Pick<AppDeps, 'db' | 'blobs'>>;
}

/**
 * One adapter's test environment. Storage is opened once per suite; every test gets wiped
 * data (through the real reset code), a fresh clock at START and a fresh app.
 */
export class Harness {
  readonly adapter: AdapterName;
  storage!: Storage;
  storageConfig!: StorageConfig;
  config!: AppConfig;
  clock = new FakeClock(START);
  server!: Server;
  /** Every logger call, for the privacy test (spec AT11). */
  logs: LogRecord[] = [];
  /** Every response body any Browser received. */
  responses: string[] = [];
  tempDir = '';
  #postgres: TestPostgres | null = null;
  #app: RequestListener | null = null;

  constructor(adapter: AdapterName) {
    this.adapter = adapter;
  }

  async open(): Promise<void> {
    this.tempDir = await mkdtemp(join(tmpdir(), `tuoniban-${this.adapter}-`));
    if (this.adapter === 'postgres') {
      this.#postgres = await startTestPostgres();
      this.storageConfig = { kind: 'postgres', databaseUrl: this.#postgres.url };
    } else {
      this.storageConfig = {
        kind: 'sqlite',
        databasePath: join(this.tempDir, 'demo.db'),
        uploadDir: join(this.tempDir, 'uploads'),
      };
    }
    this.storage = await openStorage(this.storageConfig, this.logger);
    await migrate(this.storage.db);
    // One listening server per suite. Each test swaps in a fresh app behind it, so browsers
    // created before startApp() keep working afterwards.
    this.server = createServer((req, res) => {
      if (this.#app) this.#app(req, res);
      else res.writeHead(503).end();
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
  }

  async close(): Promise<void> {
    if (this.server?.listening) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
    await this.storage?.db.close();
    await this.#postgres?.stop();
    if (this.tempDir) await rm(this.tempDir, { recursive: true, force: true });
  }

  readonly logger: Logger = {
    info: (event, fields) => this.logs.push({ level: 'info', event, fields }),
    warn: (event, fields) => this.logs.push({ level: 'warn', event, fields }),
    error: (event, fields) => this.logs.push({ level: 'error', event, fields }),
  };

  async resetAndStart(): Promise<void> {
    await resetDemoData(this.storage.db, this.storage.blobs);
    this.clock = new FakeClock(START);
    this.logs = [];
    this.responses = [];
    await this.startApp();
  }

  baseConfig(): AppConfig {
    const config = loadConfig(
      { NODE_ENV: 'test', PUBLIC_ORIGIN: TEST_ORIGIN, SESSION_SECRET: TEST_SESSION_SECRET, DEMO_MODE: 'true' },
      { cwd: this.tempDir },
    );
    return {
      ...config,
      storage: this.storageConfig,
      rateLimit: { windowMs: 60_000, redeemMax: 10_000, uploadMax: 10_000 },
    };
  }

  /** (Re)builds the app, optionally with a changed config or a failing database. */
  async startApp(overrides: AppOverrides = {}): Promise<void> {
    this.config = { ...this.baseConfig(), ...overrides.config };
    this.#app = createApp({
      config: this.config,
      db: overrides.deps?.db ?? this.storage.db,
      blobs: overrides.deps?.blobs ?? this.storage.blobs,
      clock: this.clock,
      logger: this.logger,
    });
  }

  /** Drops kept-alive connections between tests, so no request reaches the next test's app. */
  async stopApp(): Promise<void> {
    this.#app = null;
    this.server?.closeAllConnections();
  }

  browser(): Browser {
    return new Browser(this);
  }

  async count(table: string, where = '1 = 1', params: (string | number)[] = []): Promise<number> {
    const row = await this.storage.db.get<{ n: number }>(
      `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM ${table} WHERE ${where}`,
      params,
    );
    return row?.n ?? 0;
  }

  /** Stored attachment bytes, wherever this adapter keeps them. */
  async countBlobs(): Promise<number> {
    if (this.storageConfig.kind === 'postgres') return this.count('attachment_blobs');
    const names = await readdir(this.storageConfig.uploadDir);
    return names.filter(isStorageKey).length;
  }
}

/** Registers the hooks for one adapter and returns the harness the suites share. */
export function useHarness(adapter: AdapterName): Harness {
  const h = new Harness(adapter);
  beforeAll(() => h.open(), 180_000);
  beforeEach(() => h.resetAndStart());
  afterEach(() => h.stopApp());
  afterAll(() => h.close());
  return h;
}
