import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.JARJAR_BACKEND ?? 'http://localhost:3000';

export default defineConfig({
  root: 'src/dashboard',
  plugins: [react()],
  build: {
    outDir: '../../dist/dashboard',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/i': backend,
      '/t.js': backend,
      '/demo': backend,
    },
  },
});
