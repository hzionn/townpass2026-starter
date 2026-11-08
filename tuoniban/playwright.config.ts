import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// End-to-end tests run the real built server (npm run build first) on a throwaway SQLite.
const PORT = 4173;
// Workers load this file again, so the directory is made once and handed down through the env.
const dataDir = (process.env.TUONIBAN_E2E_DIR ??= mkdtempSync(join(tmpdir(), 'tuoniban-e2e-')));
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-TW' };

export default defineConfig({
  testDir: 'e2e',
  // One shared backend and one demo applicant: tests must not run in parallel.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'android-chromium', use: { browserName: 'chromium', ...phone } },
    { name: 'iphone-webkit', use: { browserName: 'webkit', ...phone } },
  ],
  webServer: {
    command: 'node dist-server/main.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      PUBLIC_ORIGIN: `http://localhost:${PORT}`,
      DATABASE_PATH: join(dataDir, 'e2e.db'),
      PRIVATE_UPLOAD_DIR: join(dataDir, 'uploads'),
      SESSION_SECRET: 'e2e-only-not-a-real-secret-0123456789',
      DEMO_MODE: 'true',
    },
  },
});
