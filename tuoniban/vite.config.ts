import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Phones cannot reach a laptop's localhost, so same-origin is preserved in dev by proxying /api to the API process.
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
});
