import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

export interface TestPostgres {
  url: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * A real Postgres for the tests, on a random port with a throwaway data directory.
 * If it cannot start, the suite fails with the reason; it is never skipped silently.
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const dir = await mkdtemp(join(tmpdir(), 'tuoniban-pg-'));
  const port = await freePort();
  const password = randomBytes(12).toString('hex');
  const stderr: string[] = [];
  const server = new EmbeddedPostgres({
    databaseDir: join(dir, 'data'),
    port,
    user: 'postgres',
    password,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'],
    onLog: () => undefined,
    onError: (message) => stderr.push(String(message)),
  });
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase('tuoniban_test');
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`embedded-postgres did not start: ${String(err)}\n${stderr.join('\n')}`);
  }
  return {
    url: `postgres://postgres:${password}@127.0.0.1:${port}/tuoniban_test`,
    stop: async () => {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
