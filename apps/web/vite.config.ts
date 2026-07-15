import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@kaoyan408/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
