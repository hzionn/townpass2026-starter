import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/tests/**/*.test.ts', 'shared/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        plugins: [vue()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/src/**/*.test.ts'],
        },
      },
    ],
  },
});
